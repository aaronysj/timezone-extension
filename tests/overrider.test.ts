import { afterEach, expect, it, vi } from 'vitest';
import vm from 'node:vm';
import { Overrider } from '../src/background/overrider';
import { installTimezone, restoreNative } from '../src/content/timezone';
import type { Config } from '../src/shared/config';

afterEach(() => vi.unstubAllGlobals());

function stubChrome(scripts: { id: string }[] = [], failIds: string[] = []) {
  const executed: { func: unknown; args?: unknown[] }[] = [];
  const registered: string[] = [];
  vi.stubGlobal('chrome', {
    scripting: {
      getRegisteredContentScripts: async () => scripts,
      registerContentScripts: async (list: { id: string }[]) => {
        if (list.some((s) => failIds.includes(s.id))) throw new Error(`bad ${list[0]!.id}`);
        registered.push(...list.map((s) => s.id));
      },
      updateContentScripts: async () => {},
      unregisterContentScripts: async () => {},
      executeScript: async (injection: { func: unknown; args?: unknown[] }) => { executed.push(injection); return []; },
    },
    tabs: { query: async () => [{ id: 1 }] },
    webNavigation: { getAllFrames: async () => [{ frameId: 0, parentFrameId: -1, url: 'https://example.com/', documentId: 'd' }] },
  });
  return { executed, registered };
}

it('never installs the shim into pages that resolve to no timezone; only restores an existing controller', async () => {
  const { executed } = stubChrome();
  const off: Config = { mode: 'off', timezone: 'Asia/Tokyo', rules: [] };
  await new Overrider().apply(1, off);
  expect(executed.map((e) => e.func)).toEqual([restoreNative]);
  await new Overrider().apply(1, { ...off, mode: 'global' });
  expect(executed[1]!.func).toBe(installTimezone);
});

it('restoreNative is a no-op without a controller and restores native behavior with one', () => {
  const context = vm.createContext({});
  vm.runInContext(`(${restoreNative.toString()})()`, context);
  expect(vm.runInContext('Date.toString().includes("[native code]") && !Object.getOwnPropertySymbols(globalThis).length', context)).toBe(true);
  vm.runInContext(`(${installTimezone.toString()})('Asia/Tokyo')`, context);
  vm.runInContext(`(${restoreNative.toString()})()`, context);
  expect(vm.runInContext('Intl.DateTimeFormat().resolvedOptions().timeZone', context)).toBe(new Intl.DateTimeFormat().resolvedOptions().timeZone);
});

it('one failing script registration does not prevent the others', async () => {
  const { registered } = stubChrome([], ['timezone-rule-0']);
  const config: Config = { mode: 'rules', timezone: 'UTC', rules: [
    { id: 'a', enabled: true, action: 'include', match: 'exact', pattern: 'a.com', timezone: 'Asia/Tokyo' },
    { id: 'b', enabled: true, action: 'include', match: 'exact', pattern: 'bb.com', timezone: 'Europe/London' },
  ] };
  await expect(new Overrider().configure(config)).rejects.toThrow('bad');
  expect(registered.length).toBe(1);
});

it('reports a zone missing from the shipped list before registering, and still registers the rest', async () => {
  const { registered } = stubChrome();
  vi.stubGlobal('chrome', { ...(globalThis as any).chrome, runtime: { getURL: (p: string) => p } });
  vi.stubGlobal('fetch', async () => ({ json: async () => ['Asia_Tokyo.js'] }));
  const config: Config = { mode: 'rules', timezone: 'UTC', rules: [
    { id: 'a', enabled: true, action: 'include', match: 'exact', pattern: 'a.com', timezone: 'Asia/Tokyo' },
    { id: 'b', enabled: true, action: 'include', match: 'exact', pattern: 'bb.com', timezone: 'Europe/London' },
  ] };
  await expect(new Overrider().configure(config)).rejects.toThrow('Europe_London.js');
  expect(registered.length).toBe(1);
});

it('configure never unregisters the temporary script, but still drops stale timezone- scripts', async () => {
  const unregistered: string[][] = [];
  stubChrome([{ id: 'temporary-timezone' }, { id: 'timezone-global' }]);
  (globalThis as any).chrome.scripting.unregisterContentScripts = async ({ ids }: { ids: string[] }) => { unregistered.push(ids); };
  await new Overrider().configure({ mode: 'off', timezone: 'Asia/Tokyo', rules: [] });
  expect(unregistered).toEqual([['timezone-global']]);
});

it('apply gives the tab\'s temporary zone to the marked origin only, over config, and restores native elsewhere', async () => {
  const { executed } = stubChrome();
  (globalThis as any).chrome.webNavigation.getAllFrames = async () => [
    { frameId: 0, parentFrameId: -1, url: 'https://example.com/', documentId: 'top' },
    { frameId: 1, parentFrameId: 0, url: 'about:blank', documentId: 'inherited' },
    { frameId: 2, parentFrameId: 0, url: 'https://example.com/embed', documentId: 'same-origin' },
    { frameId: 3, parentFrameId: 0, url: 'https://example.com:8443/', documentId: 'other-port' },
    { frameId: 4, parentFrameId: 0, url: 'https://other.com/', documentId: 'cross-origin' },
  ];
  const off: Config = { mode: 'off', timezone: 'Europe/London', rules: [] };
  const entry = { host: 'example.com', timezone: 'Asia/Tokyo' };
  await new Overrider(async () => entry).apply(1, off);
  const by = (id: string) => executed.find((e) => (e as any).target.documentIds[0] === id)!;
  for (const id of ['top', 'inherited', 'same-origin']) expect([by(id).func, by(id).args]).toEqual([installTimezone, ['Asia/Tokyo']]);
  for (const id of ['other-port', 'cross-origin']) expect(by(id).func).toBe(restoreNative);
  executed.length = 0;
  await new Overrider(async () => entry).apply(1, { ...off, mode: 'global' });
  expect(by('top').args).toEqual(['Asia/Tokyo']);
  expect(by('cross-origin').args).toEqual(['Europe/London']);
});

it('apply ignores an entry for another host, so a tab that moved on follows config', async () => {
  const { executed } = stubChrome();
  await new Overrider(async () => ({ host: 'a.com', timezone: 'Asia/Tokyo' })).apply(1, { mode: 'global', timezone: 'Europe/London', rules: [] });
  expect(executed.map((e) => [e.func, e.args])).toEqual([[installTimezone, ['Europe/London']]]);
});

it('status only reports the applied zone; a page marker is not consulted', async () => {
  stubChrome();
  (globalThis as any).chrome.scripting.executeScript = async ({ func }: { func: () => unknown }) => {
    const context = vm.createContext({ sessionStorage: { getItem: () => 'Asia/Tokyo' } });
    return [{ documentId: 'd', result: vm.runInContext(`(${func.toString()})()`, context) }];
  };
  expect(await new Overrider().status(1)).toEqual({ applied: null });
});
