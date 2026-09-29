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
