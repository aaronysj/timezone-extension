import { describe, expect, it, vi } from 'vitest';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { installTimezone, markedZone, restoreNative } from '../src/content/timezone';

// The oracle runs the real Date implementation in the requested OS timezone.
const scenarios = `(() => {
  const out = [];
  const record = d => [Number.isNaN(+d) ? 'invalid' : +d, d.getFullYear(), d.getMonth(), d.getDate(), d.getDay(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds(), d.getTimezoneOffset(), d.toDateString()];
  for (const args of [[2026,2,8,2,30], [2026,10,1,1,30], [2026,9,4,2,15], [2026,3,5,1,45], [2011,11,30,12], [0,0,1], [99,14,32,25,61], [2026,0,1,0,0,0,123]]) out.push(record(new Date(...args)));
  for (const s of ['2026-03-08T02:30:00', '2026-11-01T01:30:00', '2026-01-01', '2026-01', '2026', '2026-01-01T12:00:00+05:30', '2026-01-01T12:00:00Z', 'January 2, 2026 12:34:56', 'Fri, 02 Jan 2026 12:34:56 GMT', 'invalid', '2026/03/08 02:30', 'March 8, 2026 02:30:00', '11/01/2026 01:30', 'Thu, 01 Jan 2026 10:00:00 PST', 'Thu, 01 Jul 2026 10:00:00 PDT', 'Jan 1 2026 10:00 EST', 'Jan 1 2026 10:00 EDT', 'Jan 1 2026 10:00 CST', 'Jan 1 2026 10:00 CDT', 'Jan 1 2026 10:00 MST', 'Jan 1 2026 10:00 MDT', 'Jan 1 2026 10:00 UT', 'Jan 1 2026 10:00 UTC', 'Jan 1 2026 10:00 Z', 'Jan 1 2026 10:00 GMT+0900', 'Jan 1 2026 10:00 +0900', 'Jan 1 2026 10:00 -05', 'Jan 1 2026 10:00 PM EST', 'Jan 1 2026 10:00 GMT-0500 (EST)', 'Jan 1 2026 10:00 (PST)']) out.push(record(new Date(s)), Date.parse(s));
  for (const [name, args] of [['setFullYear',[2027,1,28]],['setMonth',[2,8]],['setDate',[8]],['setHours',[2,30]],['setMinutes',[120,15]],['setSeconds',[-1,987]],['setMilliseconds',[2000]],['setYear',[99]]]) {
    const d = new Date(2026,2,7,2,30,45,123); out.push(d[name](...args), record(d));
  }
  const invalid = new Date(NaN); out.push(invalid.setFullYear(2026), record(invalid));
  const historic = new Date('1800-01-01T00:00:00Z'); out.push(record(historic));
  const d = new Date('2026-06-01T12:34:56.789Z');
  out.push(d.toLocaleString('en-US'), d.toLocaleDateString('en-US'), d.toLocaleTimeString('en-US'), new Intl.DateTimeFormat('en', {hour:'numeric'}).format(d));
  out.push(d.toISOString(), d.getUTCHours(), Date.UTC(2026,0,1), d instanceof Date, d.constructor === Date);
  class Child extends Date {} const child = new Child(2026,0,1); out.push(child instanceof Child, record(child));
  return out;
})()`;

describe('page timezone API against native Date', () => {
  it.each(['UTC', 'Asia/Tokyo', 'America/New_York', 'Europe/London', 'Australia/Lord_Howe', 'Pacific/Apia'])('%s: constructors, parsing, DST, setters and formatting', (zone) => {
    const native = spawnSync(process.execPath, ['-e', `console.log(JSON.stringify(${scenarios}))`], { env: { ...process.env, TZ: zone }, encoding: 'utf8' });
    expect(native.status, native.stderr).toBe(0);
    const context = vm.createContext({});
    vm.runInContext(`(${installTimezone.toString()})(${JSON.stringify(zone)})`, context);
    expect(JSON.parse(JSON.stringify(vm.runInContext(scenarios, context)))).toEqual(JSON.parse(native.stdout));
  });
  it('updates an existing realm, respects explicit Intl options, and restores native behavior', () => {
    const context = vm.createContext({});
    const run = (code: string) => vm.runInContext(code, context);
    run('globalThis.before = [new Date(2026,0,1).getTime(), Intl.DateTimeFormat().resolvedOptions().timeZone]');
    run(`globalThis.install = (${installTimezone.toString()}); install('Asia/Tokyo')`);
    expect(run("Intl.DateTimeFormat('en', {timeZone:'UTC'}).resolvedOptions().timeZone")).toBe('UTC');
    expect(run("Intl.DateTimeFormat('en', Object.create({timeZone:'Europe/London'})).resolvedOptions().timeZone")).toBe('Europe/London');
    expect(run("Intl.DateTimeFormat('en', 42).resolvedOptions().timeZone")).toBe('Asia/Tokyo');
    expect(run("(() => {try {Date.parse(Symbol()); return false} catch(e) {return e instanceof TypeError}})()")).toBe(true);
    run("install('America/New_York')");
    expect(run('Intl.DateTimeFormat().resolvedOptions().timeZone')).toBe('America/New_York');
    run('install(null)');
    expect(run('new Date(2026,0,1).getTime() === before[0] && Intl.DateTimeFormat().resolvedOptions().timeZone === before[1]')).toBe(true);
  });
  it('does not shift zoned or DST-gap strings (system LA, override Tokyo)', () => {
    const cases = ['Thu, 01 Jan 2026 10:00:00 PST', 'Jan 1 2026 10:00 EST', 'Jan 1 2026 10:00 PDT', '2026/03/08 02:30'];
    const native = spawnSync(process.execPath, ['-e', `console.log(JSON.stringify(${JSON.stringify(cases)}.map(s => [Date.parse(s), +new Date(s)])))`], { env: { ...process.env, TZ: 'America/Los_Angeles' }, encoding: 'utf8' });
    const context = vm.createContext({});
    vm.runInContext(`(${installTimezone.toString()})('Asia/Tokyo')`, context);
    const got = JSON.parse(JSON.stringify(vm.runInContext(`${JSON.stringify(cases)}.map(s => [Date.parse(s), +new Date(s)])`, context)));
    const expected = JSON.parse(native.stdout);
    expect(got.slice(0, 3)).toEqual(expected.slice(0, 3));
    expect(got[0]![0]).toBe(Date.UTC(2026, 0, 1, 18));
    expect(got[1]![0]).toBe(Date.UTC(2026, 0, 1, 15));
    // 02:30 JST is a normal wall time in Tokyo even though it does not exist in Los Angeles that day.
    expect(got[3]).toEqual([Date.UTC(2026, 2, 7, 17, 30), Date.UTC(2026, 2, 7, 17, 30)]);
  });
});

describe('temporary per-tab marker', () => {
  const KEY = 'timezone-override.temporary';
  const SYSTEM = new Intl.DateTimeFormat().resolvedOptions().timeZone;
  /** A realm whose sessionStorage holds `value`, or throws like a sandboxed frame when `value` is an Error. */
  const realm = (value: string | null | Error | undefined) => {
    const storage = value === undefined ? {} : { sessionStorage: { getItem: (key: string) => { if (value instanceof Error) throw value; return key === KEY ? value : null; } } };
    return vm.createContext(storage);
  };
  const zoneOf = (context: vm.Context) => vm.runInContext('Intl.DateTimeFormat().resolvedOptions().timeZone', context);
  const install = (context: vm.Context, zone: string | null) => vm.runInContext(`(${installTimezone.toString()})(${JSON.stringify(zone)})`, context);
  const restore = (context: vm.Context) => vm.runInContext(`(${restoreNative.toString()})()`, context);
  const marked = (context: vm.Context) => vm.runInContext(`(${markedZone.toString()})()`, context);

  it('reads a valid marker zone', () => {
    expect(marked(realm('Asia/Tokyo'))).toBe('Asia/Tokyo');
  });
  it.each([['not/a-zone'], ['Mars/Base'], [''], ['{"timeZone":"UTC"}'], [null]])('ignores the page-tamperable marker %j', (value) => {
    expect(marked(realm(value))).toBeNull();
  });
  it('reads nothing without sessionStorage or when reading it throws', () => {
    for (const value of [undefined, new DOMException('denied', 'SecurityError')]) expect(marked(realm(value))).toBeNull();
  });
  it('never lets the page marker influence live updates: a forged marker changes nothing', () => {
    const context = realm('UTC');
    install(context, 'America/New_York');
    expect(zoneOf(context)).toBe('America/New_York');
    install(context, 'Europe/London');
    expect(zoneOf(context)).toBe('Europe/London');
    restore(context);
    expect(zoneOf(context)).toBe(SYSTEM);
    const bare = realm('UTC');
    expect(install(bare, null)).toBeNull();
    expect(vm.runInContext('Date.toString().includes("[native code]")', bare)).toBe(true);
  });
});

describe('document_start entry (content/main.ts)', () => {
  const pending = Symbol.for('timezone-override.pending');
  const locked = Symbol.for('timezone-override.temporary');
  const run = async (state: { pending?: string; marker: string | null; locked?: boolean }) => {
    const install = vi.fn();
    vi.resetModules();
    vi.doMock('../src/content/timezone', () => ({ installTimezone: install, markedZone: () => state.marker }));
    const root = globalThis as Record<symbol, unknown>;
    if (state.pending !== undefined) root[pending] = state.pending;
    if (state.locked) root[locked] = true;
    try { await import('../src/content/main'); } finally { delete root[pending]; delete root[locked]; vi.doUnmock('../src/content/timezone'); }
    return install.mock.calls.map((call) => call[0]);
  };
  it('config scripts ignore the page marker', async () => {
    expect(await run({ pending: 'America/New_York', marker: 'Asia/Tokyo' })).toEqual(['America/New_York']);
  });
  it('the temporary-only script installs the marker zone and nothing without one', async () => {
    expect(await run({ marker: 'Asia/Tokyo' })).toEqual(['Asia/Tokyo']);
    expect(await run({ marker: null })).toEqual([]);
  });
  it('the marker zone survives whichever script runs second', async () => {
    expect(await run({ pending: 'America/New_York', marker: 'Asia/Tokyo', locked: true })).toEqual([]);
  });
});
