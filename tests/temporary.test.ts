import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import vm from 'node:vm';
import { TEMPORARY_SCRIPT_ID, TemporaryTabs, setMarker, temporaryHost, writeMarker } from '../src/background/temporary';
import { tabStatus } from '../src/background/status';
import type { Config } from '../src/shared/config';

let session: Record<string, unknown>;
let scripts: Map<string, chrome.scripting.RegisteredContentScript>;
let calls: string[];

beforeEach(() => {
  session = {};
  scripts = new Map();
  calls = [];
  vi.stubGlobal('chrome', {
    storage: { session: {
      get: async (key: string) => ({ [key]: structuredClone(session[key]) }),
      set: async (items: Record<string, unknown>) => { Object.assign(session, structuredClone(items)); },
    } },
    scripting: {
      getRegisteredContentScripts: async ({ ids }: { ids: string[] }) => ids.filter((id) => scripts.has(id)).map((id) => scripts.get(id)!),
      registerContentScripts: async ([script]: chrome.scripting.RegisteredContentScript[]) => {
        calls.push('register');
        await Promise.resolve();
        if (scripts.has(script!.id)) throw new Error('Duplicate script ID');
        scripts.set(script!.id, script!);
      },
      updateContentScripts: async ([script]: chrome.scripting.RegisteredContentScript[]) => { calls.push('update'); scripts.set(script!.id, script!); },
      unregisterContentScripts: async ({ ids }: { ids: string[] }) => {
        calls.push('unregister');
        for (const id of ids) { if (!scripts.delete(id)) throw new Error(`Nonexistent script ID '${id}'`); }
      },
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('temporary registration', () => {
  it('registers one script for the deduplicated hosts, with an id Overrider.configure does not own', async () => {
    const tabs = new TemporaryTabs();
    await tabs.update(1, 'example.com');
    await tabs.update(2, 'example.com');
    await tabs.update(3, '[::1]');
    expect(TEMPORARY_SCRIPT_ID.startsWith('timezone-')).toBe(false);
    const script = scripts.get(TEMPORARY_SCRIPT_ID)!;
    expect(scripts.size).toBe(1);
    expect(script.matches).toEqual(['*://[::1]/*', '*://example.com/*', '*://example.com./*']);
    expect(script).toMatchObject({ js: ['timezone-content.js'], world: 'MAIN', runAt: 'document_start', allFrames: true, matchOriginAsFallback: true, persistAcrossSessions: false });
    expect(script.excludeMatches).toBeUndefined();
  });
  it('keeps the host while any tab still uses it and unregisters when the set empties', async () => {
    const tabs = new TemporaryTabs();
    await tabs.update(1, 'example.com');
    await tabs.update(2, 'example.com');
    await tabs.update(1, null);
    expect(scripts.get(TEMPORARY_SCRIPT_ID)!.matches).toContain('*://example.com/*');
    await tabs.update(2, null);
    expect(scripts.size).toBe(0);
    await tabs.update(2, null); // closing a tab that never had an override touches nothing
    expect(calls.filter((c) => c === 'unregister')).toHaveLength(1);
  });
  it('moves a tab to another host and survives a worker restart via storage.session', async () => {
    await new TemporaryTabs().update(1, 'a.com');
    const restarted = new TemporaryTabs();
    await restarted.update(2, 'b.com');
    expect(scripts.get(TEMPORARY_SCRIPT_ID)!.matches).toEqual(['*://a.com/*', '*://a.com./*', '*://b.com/*', '*://b.com./*']);
    await restarted.update(1, 'c.com');
    expect(scripts.get(TEMPORARY_SCRIPT_ID)!.matches).toEqual(['*://b.com/*', '*://b.com./*', '*://c.com/*', '*://c.com./*']);
  });
  it('serializes concurrent updates so only the first one registers', async () => {
    const tabs = new TemporaryTabs();
    await Promise.all([tabs.update(1, 'a.com'), tabs.update(2, 'b.com'), tabs.update(3, 'c.com'), tabs.update(1, null)]);
    expect(calls).toEqual(['register', 'update', 'update', 'update']);
    expect(scripts.get(TEMPORARY_SCRIPT_ID)!.matches!.filter((m) => !m.includes('./'))).toEqual(['*://b.com/*', '*://c.com/*']);
  });
  it('retries registration after a failure instead of treating the stored entry as done', async () => {
    const tabs = new TemporaryTabs();
    const original = (chrome as any).scripting.registerContentScripts;
    (chrome as any).scripting.registerContentScripts = async () => { throw new Error('boom'); };
    await expect(tabs.update(1, 'a.com')).rejects.toThrow('boom');
    (chrome as any).scripting.registerContentScripts = original;
    await tabs.update(1, 'a.com');
    expect(scripts.has(TEMPORARY_SCRIPT_ID)).toBe(true);
  });
});

describe('temporaryHost', () => {
  it.each([['https://Example.com:8080/x', 'example.com'], ['http://example.com./', 'example.com'], ['http://[::1]:3000/', '[::1]'], ['http://localhost/', 'localhost']])('%s -> %s', (url, host) => {
    expect(temporaryHost(url)).toBe(host);
  });
  it.each([['chrome://settings'], ['file:///tmp/a.html'], ['about:blank'], ['https://my_host.test/'], [undefined]])('rejects %s', (url) => {
    expect(temporaryHost(url)).toBeNull();
  });
});

describe('page marker', () => {
  it('writes and removes the sessionStorage entry, and reports unusable storage', () => {
    const store = new Map<string, string>();
    const context = vm.createContext({ sessionStorage: { setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) } });
    const run = (zone: string | null) => vm.runInContext(`(${writeMarker.toString()})(${JSON.stringify(zone)})`, context);
    expect(run('Asia/Tokyo')).toBe(true);
    expect(store.get('timezone-override.temporary')).toBe('Asia/Tokyo');
    expect(run(null)).toBe(true);
    expect(store.size).toBe(0);
    expect(vm.runInContext(`(${writeMarker.toString()})('Asia/Tokyo')`, vm.createContext({}))).toBe(false);
  });
  it('targets only the top frame and fails loudly when the page refuses', async () => {
    const executeScript = vi.fn(async () => [{ result: false }]);
    (chrome as any).scripting.executeScript = executeScript;
    await expect(setMarker(5, 'Asia/Tokyo')).rejects.toThrow('storage');
    expect(executeScript).toHaveBeenCalledWith(expect.objectContaining({ target: { tabId: 5, frameIds: [0] }, world: 'MAIN', func: writeMarker, args: ['Asia/Tokyo'] }));
  });
});

describe('tab status', () => {
  const off: Config = { mode: 'off', timezone: 'Europe/London', rules: [] };
  it('reports the temporary override even when config is off', () => {
    expect(tabStatus('https://example.com/', off, { applied: 'Asia/Tokyo', temporary: 'Asia/Tokyo' })).toEqual({
      desired: { timezone: 'Asia/Tokyo', temporary: true }, applied: 'Asia/Tokyo', temporary: 'Asia/Tokyo' });
  });
  it('outranks config and normalizes aliases of the applied zone', () => {
    const status = tabStatus('https://example.com/', { ...off, mode: 'global' }, { applied: 'Asia/Calcutta', temporary: 'Asia/Kolkata' });
    expect(status.desired).toEqual({ timezone: 'Asia/Kolkata', temporary: true });
    expect(status.applied).toBe('Asia/Kolkata');
  });
  it('falls back to config without a marker, and keeps configuration errors', () => {
    const global: Config = { ...off, mode: 'global', timezone: 'Asia/Tokyo' };
    expect(tabStatus('https://example.com/', global, { applied: null, temporary: null }, 'bad zone')).toEqual({
      desired: { timezone: 'Asia/Tokyo' }, applied: null, temporary: null, error: 'bad zone' });
    expect(tabStatus('https://example.com/', off, { applied: 'Asia/Tokyo', temporary: null })).toEqual({ desired: null, applied: null, temporary: null });
  });
});
