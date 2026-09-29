import { describe, expect, it } from 'vitest';
import type { Config, Rule } from '../src/shared/config';
import { parseConfig } from '../src/shared/config';
import { normalizePattern, resolveTimezone } from '../src/shared/resolve';

let seq = 0;
const rule = (r: Partial<Rule> & Pick<Rule, 'pattern'>): Rule => ({
  id: String(seq++),
  enabled: true,
  action: 'include',
  match: 'suffix',
  ...r,
});
const cfg = (c: Partial<Config>): Config => ({ mode: 'rules', timezone: 'UTC', rules: [], ...c });

describe('normalizePattern', () => {
  it.each([
    ['Example.COM', 'example.com'],
    ['  *.example.com ', 'example.com'],
    ['.example.com', 'example.com'],
    ['example.com.', 'example.com'],
    ['https://Sub.Example.com:8443/a/b?c', 'sub.example.com'],
    ['example.com:8080', 'example.com'],
    ['example.com/path', 'example.com'],
    ['http://[::1]:3000/', '[::1]'],
    ['', ''],
  ])('%s -> %s', (input, expected) => expect(normalizePattern(input)).toBe(expected));
});

describe('resolveTimezone', () => {
  it('off mode never overrides', () => {
    expect(resolveTimezone('https://a.com', cfg({ mode: 'off', rules: [rule({ pattern: 'a.com' })] }))).toBeNull();
  });

  it('global mode overrides every http(s) page', () => {
    const c = cfg({ mode: 'global', timezone: 'Asia/Tokyo' });
    expect(resolveTimezone('https://anything.org/x', c)).toEqual({ timezone: 'Asia/Tokyo' });
    expect(resolveTimezone('http://localhost:8080', c)).toEqual({ timezone: 'Asia/Tokyo' });
  });

  it.each(['chrome://settings', 'chrome-extension://abc/popup.html', 'file:///tmp/a.html', 'about:blank', 'not a url'])(
    'ignores non-http(s) url %s',
    (url) => expect(resolveTimezone(url, cfg({ mode: 'global' }))).toBeNull(),
  );

  it('rules mode without a match does not override', () => {
    expect(resolveTimezone('https://b.com', cfg({ rules: [rule({ pattern: 'a.com' })] }))).toBeNull();
  });

  it('suffix matches the domain itself and subdomains, but not lookalikes', () => {
    const c = cfg({ rules: [rule({ pattern: 'a.com' })] });
    expect(resolveTimezone('https://a.com', c)?.timezone).toBe('UTC');
    expect(resolveTimezone('https://x.y.a.com', c)?.timezone).toBe('UTC');
    expect(resolveTimezone('https://ba.com', c)).toBeNull();
    expect(resolveTimezone('https://a.com.evil.net', c)).toBeNull();
  });

  it('exact matches only the exact host', () => {
    const c = cfg({ rules: [rule({ pattern: 'a.com', match: 'exact' })] });
    expect(resolveTimezone('https://a.com/p', c)).not.toBeNull();
    expect(resolveTimezone('https://www.a.com', c)).toBeNull();
  });

  it('host matching is case-insensitive and ignores port and trailing dot', () => {
    const c = cfg({ rules: [rule({ pattern: 'A.com', match: 'exact' })] });
    expect(resolveTimezone('https://A.COM.:8443/', c)).not.toBeNull();
  });

  it('uses the rule timezone, falling back to the default', () => {
    const c = cfg({
      timezone: 'Europe/London',
      rules: [rule({ pattern: 'jp.com', timezone: 'Asia/Tokyo' }), rule({ pattern: 'uk.com' })],
    });
    expect(resolveTimezone('https://jp.com', c)?.timezone).toBe('Asia/Tokyo');
    expect(resolveTimezone('https://uk.com', c)?.timezone).toBe('Europe/London');
  });

  it('exclude rules win over include rules regardless of order or specificity', () => {
    const c = cfg({
      rules: [
        rule({ pattern: 'mail.a.com', match: 'exact', timezone: 'Asia/Tokyo' }),
        rule({ pattern: 'a.com', action: 'exclude' }),
      ],
    });
    expect(resolveTimezone('https://mail.a.com', c)).toBeNull();
  });

  it('exclude carves exceptions out of a broader include', () => {
    const c = cfg({
      rules: [rule({ pattern: 'a.com', timezone: 'Asia/Tokyo' }), rule({ pattern: 'pay.a.com', action: 'exclude' })],
    });
    expect(resolveTimezone('https://www.a.com', c)?.timezone).toBe('Asia/Tokyo');
    expect(resolveTimezone('https://pay.a.com', c)).toBeNull();
    expect(resolveTimezone('https://x.pay.a.com', c)).toBeNull();
  });

  it('most specific include wins: exact > longer suffix > shorter suffix', () => {
    const c = cfg({
      rules: [
        rule({ pattern: 'a.com', timezone: 'Asia/Tokyo' }),
        rule({ pattern: 'b.a.com', timezone: 'Asia/Shanghai' }),
        rule({ pattern: 'c.b.a.com', match: 'exact', timezone: 'America/New_York' }),
      ],
    });
    expect(resolveTimezone('https://x.a.com', c)?.timezone).toBe('Asia/Tokyo');
    expect(resolveTimezone('https://x.b.a.com', c)?.timezone).toBe('Asia/Shanghai');
    expect(resolveTimezone('https://c.b.a.com', c)?.timezone).toBe('America/New_York');
  });

  it('ties go to the earlier rule', () => {
    const c = cfg({
      rules: [rule({ pattern: 'a.com', timezone: 'Asia/Tokyo' }), rule({ pattern: '*.a.com', timezone: 'Asia/Seoul' })],
    });
    expect(resolveTimezone('https://a.com', c)?.timezone).toBe('Asia/Tokyo');
  });

  it('disabled rules and empty patterns are ignored', () => {
    const c = cfg({
      rules: [rule({ pattern: 'a.com', action: 'exclude', enabled: false }), rule({ pattern: '' }), rule({ pattern: 'a.com' })],
    });
    expect(resolveTimezone('https://a.com', c)?.rule?.pattern).toBe('a.com');
    expect(resolveTimezone('https://z.com', c)).toBeNull();
  });
});

describe('parseConfig', () => {
  it('keeps old configurations on browser language and validates stored preferences', () => {
    expect(parseConfig({}).language).toBeUndefined();
    for (const language of ['auto', 'en', 'zh_CN', 'ja', 'ko']) expect(parseConfig({ language }).language).toBe(language);
    for (const language of ['de', 'zh-TW', null, 42, {}]) expect(parseConfig({ language }).language).toBe('auto');
  });
  it('falls back to defaults for garbage', () => {
    const system = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(parseConfig(undefined)).toEqual({ mode: 'off', timezone: system, rules: [] });
    expect(parseConfig({ mode: 'weird', timezone: 3, rules: [null, { pattern: 1 }] })).toEqual({
      mode: 'off',
      timezone: system,
      rules: [],
    });
    expect(parseConfig({ timezone: 'Mars/Olympus' }).timezone).toBe(system);
  });

  it('fills rule defaults', () => {
    const [r] = parseConfig({ mode: 'rules', rules: [{ pattern: 'a.com' }] }).rules;
    expect(r).toMatchObject({ enabled: true, action: 'include', match: 'suffix', pattern: 'a.com' });
    expect(r?.timezone).toBeUndefined();
  });
});

describe('domain input regressions', () => {
  it.each(['not a domain', '-bad.com', 'bad-.com', 'a..com', 'https://user:password@example.com', 'ftp://example.com', 'a.com\\evil'])('rejects invalid or ambiguous input: %s', (input) => {
    expect(normalizePattern(input)).toBe('');
  });

  it.each([
    ['https://例子.中国/path', 'xn--fsqu00a.xn--fiqs8s'],
    ['localhost:3000', 'localhost'],
    ['127.0.0.1:8080', '127.0.0.1'],
    ['[::1]:3000', '[::1]'],
  ])('normalizes valid special hosts: %s', (input, expected) => {
    expect(normalizePattern(input)).toBe(expected);
  });
});
