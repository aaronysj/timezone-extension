import { describe, expect, it } from 'vitest';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { installTimezone } from '../src/content/timezone';

// The oracle runs the real Date implementation in the requested OS timezone.
const scenarios = `(() => {
  const out = [];
  const record = d => [Number.isNaN(+d) ? 'invalid' : +d, d.getFullYear(), d.getMonth(), d.getDate(), d.getDay(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds(), d.getTimezoneOffset(), d.toDateString()];
  for (const args of [[2026,2,8,2,30], [2026,10,1,1,30], [2026,9,4,2,15], [2026,3,5,1,45], [2011,11,30,12], [0,0,1], [99,14,32,25,61], [2026,0,1,0,0,0,123]]) out.push(record(new Date(...args)));
  for (const s of ['2026-03-08T02:30:00', '2026-11-01T01:30:00', '2026-01-01', '2026-01', '2026', '2026-01-01T12:00:00+05:30', '2026-01-01T12:00:00Z', 'January 2, 2026 12:34:56', 'Fri, 02 Jan 2026 12:34:56 GMT', 'invalid']) out.push(record(new Date(s)), Date.parse(s));
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
});
