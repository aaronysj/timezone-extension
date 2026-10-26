import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import vm from 'node:vm';
import { TEMPORARY_SCRIPT_ID, TemporaryTabs, setMarker, writeMarker } from '../src/background/temporary';
import { needsProbe, tabStatus } from '../src/background/status';
import type { Config } from '../src/shared/config';
import { temporaryHost, temporaryOrigin, temporaryZone } from '../src/shared/temporary';
import { TEMPORARY_MARKER_KEY } from '../src/content/timezone';
import { chineseI18n } from './i18n-mock';

const on = (host: string, timezone = 'Asia/Tokyo') => ({ origin: `https://${host}`, timezone });

let session: Record<string, unknown>;
let scripts: Map<string, chrome.scripting.RegisteredContentScript>;
let calls: string[];
let openTabs: number[];

beforeEach(() => {
  session = {};
  scripts = new Map();
  calls = [];
  openTabs = [1, 2, 3, 5];
  vi.stubGlobal('chrome', {
    i18n: chineseI18n,
    tabs: { query: async () => openTabs.map((id) => ({ id })) },
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
    await tabs.update(1, on('example.com'));
    await tabs.update(2, on('example.com'));
    await tabs.update(3, on('[::1]'));
    expect(TEMPORARY_SCRIPT_ID.startsWith('timezone-')).toBe(false);
    const script = scripts.get(TEMPORARY_SCRIPT_ID)!;
    expect(scripts.size).toBe(1);
    expect(script.matches).toEqual(['*://[::1]/*', '*://example.com/*', '*://example.com./*']);
    expect(script).toMatchObject({ js: ['timezone-temporary.js'], world: 'MAIN', runAt: 'document_start', allFrames: true, matchOriginAsFallback: true, persistAcrossSessions: false });
    expect(script.excludeMatches).toBeUndefined();
  });
  it('keeps the host while any tab still uses it and unregisters when the set empties', async () => {
    const tabs = new TemporaryTabs();
    await tabs.update(1, on('example.com'));
    await tabs.update(2, on('example.com'));
    await tabs.update(1, null);
    expect(scripts.get(TEMPORARY_SCRIPT_ID)!.matches).toContain('*://example.com/*');
    await tabs.update(2, null);
    expect(scripts.size).toBe(0);
    await tabs.update(2, null); // closing a tab that never had an override touches nothing
    expect(calls.filter((c) => c === 'unregister')).toHaveLength(1);
  });
  it('moves a tab to another host and survives a worker restart via storage.session', async () => {
    await new TemporaryTabs().update(1, on('a.com'));
    const restarted = new TemporaryTabs();
    await restarted.update(2, on('b.com'));
    expect(scripts.get(TEMPORARY_SCRIPT_ID)!.matches).toEqual(['*://a.com/*', '*://a.com./*', '*://b.com/*', '*://b.com./*']);
    await restarted.update(1, on('c.com'));
    expect(scripts.get(TEMPORARY_SCRIPT_ID)!.matches).toEqual(['*://b.com/*', '*://b.com./*', '*://c.com/*', '*://c.com./*']);
  });
  it('serializes concurrent updates so only the first one registers', async () => {
    const tabs = new TemporaryTabs();
    await Promise.all([tabs.update(1, on('a.com')), tabs.update(2, on('b.com')), tabs.update(3, on('c.com')), tabs.update(1, null)]);
    expect(calls).toEqual(['register', 'update', 'update', 'update']);
    expect(scripts.get(TEMPORARY_SCRIPT_ID)!.matches!.filter((m) => !m.includes('./'))).toEqual(['*://b.com/*', '*://c.com/*']);
  });
  it('retries registration after a failure instead of treating the stored entry as done', async () => {
    const tabs = new TemporaryTabs();
    const original = (chrome as any).scripting.registerContentScripts;
    (chrome as any).scripting.registerContentScripts = async () => { throw new Error('boom'); };
    await expect(tabs.update(1, on('a.com'))).rejects.toThrow('boom');
    (chrome as any).scripting.registerContentScripts = original;
    await tabs.update(1, on('a.com'));
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
    const run = (zone: string | null) => vm.runInContext(`(${writeMarker.toString()})(${JSON.stringify(zone)}, ${JSON.stringify(TEMPORARY_MARKER_KEY)})`, context);
    expect(run('Asia/Tokyo')).toBe(true);
    expect(store.get('timezone-override.temporary')).toBe('Asia/Tokyo');
    expect(run(null)).toBe(true);
    expect(store.size).toBe(0);
    expect(vm.runInContext(`(${writeMarker.toString()})('Asia/Tokyo', 'k')`, vm.createContext({}))).toBe(false);
  });
  it('fails loudly when the page refuses, and pins the write to the recorded document', async () => {
    const executeScript = vi.fn(async () => [{ result: false }]);
    (chrome as any).scripting.executeScript = executeScript;
    await expect(setMarker(5, 'Asia/Tokyo', 'doc-1')).rejects.toThrow(chineseI18n.getMessage('tempErrStorage'));
    expect(executeScript).toHaveBeenCalledWith(expect.objectContaining({ target: { tabId: 5, documentIds: ['doc-1'] }, world: 'MAIN', func: writeMarker, args: ['Asia/Tokyo', TEMPORARY_MARKER_KEY] }));
  });
  it('cleans up in the top frame when no document is given', async () => {
    const executeScript = vi.fn(async () => [{ result: true }]);
    (chrome as any).scripting.executeScript = executeScript;
    await setMarker(5, null);
    expect(executeScript).toHaveBeenCalledWith(expect.objectContaining({ target: { tabId: 5, frameIds: [0] }, args: [null, TEMPORARY_MARKER_KEY] }));
  });
});

describe('tab status', () => {
  const off: Config = { mode: 'off', timezone: 'Europe/London', rules: [] };
  it('reports the temporary override even when config is off', () => {
    expect(tabStatus('https://example.com/', off, { applied: 'Asia/Tokyo' }, 'Asia/Tokyo')).toEqual({
      desired: { timezone: 'Asia/Tokyo' }, applied: 'Asia/Tokyo', temporary: 'Asia/Tokyo' });
  });
  it('outranks config and normalizes aliases of the applied zone', () => {
    const status = tabStatus('https://example.com/', { ...off, mode: 'global' }, { applied: 'Asia/Calcutta' }, 'Asia/Kolkata');
    expect(status.desired).toEqual({ timezone: 'Asia/Kolkata' });
    expect(status.applied).toBe('Asia/Kolkata');
  });
  it('falls back to config without an override, and keeps configuration errors', () => {
    const global: Config = { ...off, mode: 'global', timezone: 'Asia/Tokyo' };
    expect(tabStatus('https://example.com/', global, { applied: null }, null, 'bad zone')).toEqual({
      desired: { timezone: 'Asia/Tokyo' }, applied: null, temporary: null, error: 'bad zone' });
    expect(tabStatus('https://example.com/', off, { applied: 'Asia/Tokyo' }, null)).toEqual({ desired: null, applied: null, temporary: null });
  });
  it('does not fail a working temporary override over an unrelated configuration error', () => {
    const status = tabStatus('https://example.com/', { ...off, mode: 'global' }, { applied: 'Asia/Tokyo' }, 'Asia/Tokyo', 'No bundled timezone script for rule-3');
    expect(status.error).toBeUndefined();
    expect(status.applied).toBe('Asia/Tokyo');
  });
});

describe('needsProbe', () => {
  const rules: Config = { mode: 'rules', timezone: 'Europe/London', rules: [{ id: 'a', enabled: true, action: 'include', match: 'exact', pattern: 'a.com' }] };
  it('skips pages that run natively, so the 1 s poll does not inject into them', () => {
    expect(needsProbe('https://a.com/', { ...rules, mode: 'off' }, null)).toBe(false);
    expect(needsProbe('https://b.com/', rules, null)).toBe(false);
    expect(needsProbe('chrome://settings', { ...rules, mode: 'global' }, null)).toBe(false);
    expect(needsProbe(undefined, rules, 'Asia/Tokyo')).toBe(false);
  });
  it('probes pages with a configured zone or a temporary override', () => {
    expect(needsProbe('https://a.com/', rules, null)).toBe(true);
    expect(needsProbe('https://b.com/', { ...rules, mode: 'off' }, 'Asia/Tokyo')).toBe(true);
  });
});

describe('temporaryZone', () => {
  it('only covers the origin it was set for, so a stale or foreign entry never counts', () => {
    expect(temporaryZone(on('a.com'), 'https://a.com/x')).toBe('Asia/Tokyo');
    expect(temporaryZone(on('a.com'), 'https://b.com/')).toBeNull();
    expect(temporaryZone(undefined, 'https://a.com/')).toBeNull();
    expect(temporaryZone(on('a.com'), undefined)).toBeNull();
  });
  it('treats another scheme or port of the same host as another page, like the marker storage does', () => {
    expect(temporaryZone(on('a.com'), 'http://a.com/')).toBeNull();
    expect(temporaryZone(on('a.com'), 'https://a.com:8443/')).toBeNull();
    expect(temporaryZone({ origin: 'http://localhost:3000', timezone: 'Asia/Tokyo' }, 'http://localhost:3000/deep/path?q=1')).toBe('Asia/Tokyo');
    expect(temporaryZone({ origin: 'http://localhost:3000', timezone: 'Asia/Tokyo' }, 'http://localhost:3001/')).toBeNull();
  });
});

describe('temporaryOrigin', () => {
  it.each([['https://Example.com:8080/x', 'https://example.com:8080'], ['http://[::1]:3000/', 'http://[::1]:3000']])('%s -> %s', (url, origin) => {
    expect(temporaryOrigin(url)).toBe(origin);
  });
  it.each([['chrome://settings'], ['https://my_host.test/'], [undefined]])('rejects %s', (url) => {
    expect(temporaryOrigin(url)).toBeNull();
  });
});

describe('start / end', () => {
  const executeScript = (outcome: (timezone: string | null) => unknown) => {
    const written: (string | null)[] = [];
    (chrome as any).scripting.executeScript = async ({ args }: { args: [string | null] }) => { written.push(args[0]); return [{ result: await outcome(args[0]) }]; };
    return written;
  };
  const stored = () => (session.temporaryTabs ?? {}) as Record<string, unknown>;
  it('registers before writing the marker, and stores the entry', async () => {
    const written = executeScript(() => true);
    await new TemporaryTabs().start(1, on('a.com'), 'd1');
    expect(calls).toEqual(['register']);
    expect(written).toEqual(['Asia/Tokyo']);
    expect(stored()).toEqual({ 1: on('a.com') });
  });
  it('leaves nothing behind when registration fails: no marker, no entry', async () => {
    const written = executeScript(() => true);
    (chrome as any).scripting.registerContentScripts = async () => { throw new Error('boom'); };
    await expect(new TemporaryTabs().start(1, on('a.com'), 'd1')).rejects.toThrow('boom');
    expect(written).toEqual([]);
    expect(stored()).toEqual({});
    expect(scripts.size).toBe(0);
  });
  it('rolls the registration and entry back when the page refuses the marker', async () => {
    executeScript(() => false);
    await expect(new TemporaryTabs().start(1, on('a.com'), 'd1')).rejects.toThrow(chineseI18n.getMessage('tempErrStorage'));
    expect(stored()).toEqual({});
    expect(scripts.size).toBe(0);
  });
  it('restores the previous entry when switching hosts fails', async () => {
    const tabs = new TemporaryTabs();
    const written = executeScript((zone) => zone !== 'Europe/London');
    await tabs.start(1, on('a.com'), 'd1');
    await expect(tabs.start(1, on('b.com', 'Europe/London'), 'd1')).rejects.toThrow();
    expect(written).toEqual(['Asia/Tokyo', 'Europe/London']);
    expect(stored()).toEqual({ 1: on('a.com') });
    expect(scripts.get(TEMPORARY_SCRIPT_ID)!.matches).toEqual(['*://a.com/*', '*://a.com./*']);
  });
  it('a host switch replaces the entry, so the previous host is no longer registered or trusted', async () => {
    const tabs = new TemporaryTabs();
    executeScript(() => true);
    await tabs.start(1, on('a.com'), 'd1');
    await tabs.start(1, on('b.com'), 'd1');
    expect(stored()).toEqual({ 1: on('b.com') });
    expect(scripts.get(TEMPORARY_SCRIPT_ID)!.matches).toEqual(['*://b.com/*', '*://b.com./*']);
    expect(temporaryZone(await tabs.get(1), 'https://a.com/')).toBeNull();
  });
  it('takes the rollback snapshot inside the queue, so a racing change is not lost', async () => {
    const tabs = new TemporaryTabs();
    executeScript((zone) => zone !== 'Europe/London');
    // The first change is still queued when the failing start begins; its entry is the one to restore.
    const first = tabs.update(1, on('a.com'));
    await expect(tabs.start(1, on('b.com', 'Europe/London'), 'd1')).rejects.toThrow();
    await first;
    expect(stored()).toEqual({ 1: on('a.com') });
  });
  it('end drops the entry and registration even when the page can no longer be scripted', async () => {
    const tabs = new TemporaryTabs();
    executeScript(() => true);
    await tabs.start(1, on('a.com'), 'd1');
    (chrome as any).scripting.executeScript = async () => { throw new Error('Cannot access contents of the page'); };
    await tabs.end(1);
    expect(stored()).toEqual({});
    expect(scripts.size).toBe(0);
  });
});

describe('reconciliation', () => {
  it('unregisters a registration orphaned by an extension reload (session state gone)', async () => {
    scripts.set(TEMPORARY_SCRIPT_ID, { id: TEMPORARY_SCRIPT_ID, matches: ['*://a.com/*'], js: ['timezone-content.js'] });
    await new TemporaryTabs().sync();
    expect(scripts.size).toBe(0);
  });
  it('does nothing when the stored state and the registration already agree', async () => {
    const tabs = new TemporaryTabs();
    await tabs.update(1, on('a.com'));
    calls.length = 0;
    const set = vi.spyOn((chrome as any).storage.session, 'set');
    await tabs.sync();
    expect(calls).toEqual([]);
    expect(set).not.toHaveBeenCalled();
  });
  it('does not rewrite an identical registration', async () => {
    const tabs = new TemporaryTabs();
    await tabs.update(1, on('a.com'));
    await tabs.update(2, on('a.com'));
    expect(calls).toEqual(['register']);
  });
  it('drops entries of tabs that no longer exist and keeps the registration for the rest', async () => {
    const tabs = new TemporaryTabs();
    await tabs.update(1, on('a.com'));
    await tabs.update(9, on('gone.com'));
    await tabs.sync();
    expect(session.temporaryTabs).toEqual({ 1: on('a.com') });
    expect(scripts.get(TEMPORARY_SCRIPT_ID)!.matches).toEqual(['*://a.com/*', '*://a.com./*']);
  });
  it('moves the entry when a prerendered page replaces the tab, so End still finds it', async () => {
    const tabs = new TemporaryTabs();
    await tabs.update(1, on('a.com'));
    await tabs.replace(1, 5);
    expect(session.temporaryTabs).toEqual({ 5: on('a.com') });
    await tabs.update(5, null);
    expect(scripts.size).toBe(0);
    await tabs.replace(7, 8); // unrelated replacement touches nothing
    expect(calls.filter((c) => c === 'unregister')).toHaveLength(1);
  });
});
