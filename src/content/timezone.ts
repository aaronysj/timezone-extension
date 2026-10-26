/*
 * Per-tab temporary override: the background owns it and applies it with explicit zones. The only page-side trace is the
 * sessionStorage key `TEMPORARY_MARKER_KEY` (isolated per tab+origin, survives reloads, readable synchronously at
 * document_start), which the temporary-only registration reads through `markedZone` so reloads apply before page scripts.
 * Nothing else trusts it: live updates and status come from the background's own entry.
 */

export const TEMPORARY_MARKER_KEY = 'timezone-override.temporary';

/** The valid zone in the page marker, or null. Sandboxed frames and disabled storage throw; the page may also have tampered with the value. */
export function markedZone(): string | null {
  try {
    const zone = sessionStorage.getItem(TEMPORARY_MARKER_KEY);
    if (!zone) return null;
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return zone;
  } catch { return null; }
}

/** Self-contained: switches an already installed controller back to native behavior; never installs one. */
export function restoreNative(): void {
  const root = globalThis as typeof globalThis & { [key: symbol]: { set(zone: string | null): string | null } | undefined };
  root[Symbol.for('timezone-override.controller')]?.set(null);
}

/** Self-contained: Chrome serializes this function when updating an already open page. With no zone nothing is installed (and an existing controller goes native). */
export function installTimezone(initial: string | null): string | null {
  const key = Symbol.for('timezone-override.controller');
  const root = globalThis as typeof globalThis & { [key: symbol]: { set(zone: string | null): string | null } };
  if (root[key]) return root[key].set(initial);
  if (initial === null) return null;

  const NativeDate = Date;
  const NativeFormat = Intl.DateTimeFormat;
  const proto = NativeDate.prototype;
  const native = Object.fromEntries(Object.getOwnPropertyNames(proto).map((name) => [name, (proto as unknown as Record<string, unknown>)[name]])) as Record<string, (...args: any[]) => any>;
  const nativeParse = NativeDate.parse;
  let zone: string | null = null;
  let formatter: Intl.DateTimeFormat;
  const set = (next: string | null) => {
    if (next !== null) {
      formatter = new NativeFormat('en-US', { timeZone: next, calendar: 'iso8601', numberingSystem: 'latn',
        era: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    }
    zone = next;
    return zone;
  };
  set(initial);

  const utc = (year: number, month: number, day: number, hour = 0, minute = 0, second = 0, ms = 0) => {
    const date = new NativeDate(0);
    native.setUTCFullYear!.call(date, year, month, day);
    native.setUTCHours!.call(date, hour, minute, second, ms);
    return +date;
  };
  const wall = (time: number) => {
    if (!Number.isFinite(time)) return NaN;
    const parts = formatter.formatToParts(time);
    const part = (name: string) => parts.find((p) => p.type === name)?.value ?? '';
    const year = part('era') === 'BC' ? 1 - Number(part('year')) : Number(part('year'));
    return utc(year, Number(part('month')) - 1, Number(part('day')), Number(part('hour')), Number(part('minute')), Number(part('second')), ((time % 1000) + 1000) % 1000);
  };
  const offset = (time: number) => wall(time) - time;
  // Date's compatible DST disambiguation: earlier instant in a fold, forward through a gap.
  const instant = (clock: number) => {
    if (!Number.isFinite(clock)) return NaN;
    const offsets = new Set([-2, -1, 0, 1, 2].map((days) => offset(Math.max(-8.64e15, Math.min(8.64e15, clock + days * 86400000)))));
    const candidates = [...offsets].map((shift) => clock - shift).filter((time) => Math.abs(time) <= 8.64e15);
    const exact = candidates.filter((time) => wall(time) === clock);
    if (exact.length) return Math.min(...exact);
    const forward = candidates.filter((time) => wall(time) > clock).sort((a, b) => wall(a) - wall(b));
    return forward[0] ?? NaN;
  };
  const parse = (text: string) => {
    const parsed = nativeParse(text);
    if (!zone || !Number.isFinite(parsed)) return parsed;
    // ISO date-only is UTC by specification. Any explicit zone (V8 legacy: UT/UTC/GMT/Z, US abbreviations, numeric offsets) stays untouched.
    const trimmed = text.trim();
    const bare = trimmed.replace(/\([^)]*\)/g, ' ');
    const zoned = /(?<![a-z])(?:ut|utc|gmt|z|[ecmp][sd]t)(?![a-z])/i.test(bare) || /\d:\d{2}(?::\d{2}(?:\.\d+)?)?\s*(?:[ap]m)?\s*[+-]\d{1,4}(?::?\d{2})?(?!\d)/i.test(bare);
    if (/^[+-]?\d{4,6}(?:-\d{2}(?:-\d{2})?)?$/.test(trimmed) || zoned) return parsed;
    const iso = /^([+-]?\d{4,6})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?$/.exec(trimmed);
    if (iso) return instant(utc(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), Number(iso[4]), Number(iso[5]), +(iso[6] ?? 0), Number((iso[7] ?? '').padEnd(3, '0').slice(0, 3))));
    // Reading the wall clock as UTC avoids system-zone DST gaps/folds shifting fields before reinterpretation.
    const clock = nativeParse(`${trimmed} UTC`);
    if (Number.isFinite(clock)) return instant(clock);
    const date = new NativeDate(parsed);
    return instant(utc(native.getFullYear!.call(date), native.getMonth!.call(date), native.getDate!.call(date), native.getHours!.call(date), native.getMinutes!.call(date), native.getSeconds!.call(date), native.getMilliseconds!.call(date)));
  };
  const primitive = (value: unknown): unknown => {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value;
    const object = value as Record<PropertyKey, any>;
    const exotic = object[Symbol.toPrimitive];
    if (exotic !== undefined) {
      const result = exotic.call(value, 'default');
      if (result === null || (typeof result !== 'object' && typeof result !== 'function')) return result;
      throw new TypeError('Cannot convert object to primitive value');
    }
    for (const name of ['valueOf', 'toString']) {
      if (typeof object[name] !== 'function') continue;
      const result = object[name]();
      if (result === null || (typeof result !== 'object' && typeof result !== 'function')) return result;
    }
    throw new TypeError('Cannot convert object to primitive value');
  };
  const patchedDate = new Proxy(NativeDate, {
    apply: () => zone ? new patchedDate().toString() : NativeDate(),
    construct(target, args, newTarget) {
      let input = args;
      if (zone && args.length >= 2) input = [instant(Reflect.apply(NativeDate.UTC, NativeDate, args))];
      else if (zone && args.length === 1) {
        let value: unknown;
        try { value = native.getTime!.call(args[0]); } catch { value = primitive(args[0]); }
        input = [typeof value === 'string' ? parse(value) : value];
      }
      return Reflect.construct(target, input, newTarget);
    },
  });
  const replace = (name: string, value: unknown) => Object.defineProperty(proto, name, { value, configurable: true, writable: true });
  for (const suffix of ['FullYear', 'Month', 'Date', 'Day', 'Hours', 'Minutes', 'Seconds', 'Milliseconds']) {
    replace(`get${suffix}`, function (this: Date) {
      return zone ? native[`getUTC${suffix}`]!.call(new NativeDate(wall(native.getTime!.call(this)))) : native[`get${suffix}`]!.call(this);
    });
  }
  replace('getYear', function (this: Date) { return zone ? this.getFullYear() - 1900 : native.getYear!.call(this); });
  replace('getTimezoneOffset', function (this: Date) { const time = native.getTime!.call(this); return zone ? Math.trunc(-offset(time) / 60000) : native.getTimezoneOffset!.call(this); });
  for (const suffix of ['FullYear', 'Month', 'Date', 'Hours', 'Minutes', 'Seconds', 'Milliseconds']) {
    replace(`set${suffix}`, function (this: Date, ...args: unknown[]) {
      if (!zone) return native[`set${suffix}`]!.apply(this, args);
      const clock = new NativeDate(wall(native.getTime!.call(this)));
      native[`setUTC${suffix}`]!.apply(clock, args);
      return native.setTime!.call(this, instant(+clock));
    });
  }
  replace('setYear', function (this: Date, year: unknown) {
    if (!zone) return native.setYear!.call(this, year);
    const value = Number(year);
    return this.setFullYear(value >= 0 && value <= 99 ? Math.trunc(value) + 1900 : value);
  });
  const withZone = (options: Intl.DateTimeFormatOptions | undefined | null) => {
    if (!zone || options === null || options?.timeZone !== undefined) return options;
    return Object.defineProperty(Object.create(options === undefined ? null : Object(options)), 'timeZone', { value: zone, enumerable: true });
  };
  for (const name of ['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString']) {
    replace(name, function (this: Date, locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) { return native[name]!.call(this, locales, withZone(options)); });
  }
  const pad = (number: number, width = 2) => String(Math.abs(number)).padStart(width, '0');
  const dateText = (date: Date) => `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()]} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][date.getMonth()]} ${pad(date.getDate())} ${date.getFullYear() < 0 ? '-' : ''}${pad(date.getFullYear(), 4)}`;
  const timeText = (date: Date) => {
    const minutes = -date.getTimezoneOffset();
    const name = new NativeFormat('en-US', { timeZone: zone!, timeZoneName: 'long' }).formatToParts(date).find((part) => part.type === 'timeZoneName')!.value;
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())} GMT${minutes < 0 ? '-' : '+'}${pad(Math.trunc(Math.abs(minutes) / 60))}${pad(Math.trunc(Math.abs(minutes) % 60))} (${name})`;
  };
  for (const name of ['toString', 'toDateString', 'toTimeString']) {
    replace(name, function (this: Date) {
      if (!zone) return native[name]!.call(this);
      if (!Number.isFinite(native.getTime!.call(this))) return 'Invalid Date';
      return name === 'toDateString' ? dateText(this) : name === 'toTimeString' ? timeText(this) : `${dateText(this)} ${timeText(this)}`;
    });
  }
  Object.defineProperty(NativeDate, 'parse', { value: (text: unknown) => parse(`${text}`), configurable: true, writable: true });
  replace('constructor', patchedDate);
  globalThis.Date = patchedDate;
  const patchedFormat = new Proxy(NativeFormat, {
    construct(target, args, newTarget) { return Reflect.construct(target, [args[0], withZone(args[1])], newTarget); },
    apply(target, receiver, args) { return Reflect.apply(target, receiver, [args[0], withZone(args[1])]); },
  });
  Intl.DateTimeFormat = patchedFormat;
  Object.defineProperty(NativeFormat.prototype, 'constructor', { value: patchedFormat, configurable: true, writable: true });
  Object.defineProperty(root, key, { value: { set } });
  return zone;
}
