/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';

const root = path.resolve(import.meta.dirname, '..');
const localesDir = path.join(root, 'public/_locales');
const read = (file: string) => fs.readFileSync(file, 'utf8');
const catalog = (locale: string): Record<string, { message: string }> =>
  JSON.parse(read(path.join(localesDir, locale, 'messages.json')));
const sources = (fs.readdirSync(path.join(root, 'src'), { recursive: true }) as string[])
  .filter((f) => f.endsWith('.ts'))
  .map((f) => [f, read(path.join(root, 'src', f))] as const);

const locales = fs.readdirSync(localesDir);
const en = catalog('en');
const substitutions = (message: string) => [...message.matchAll(/\$(\d)/g)].map((m) => m[1]).sort().join();

describe('locale catalogs', () => {
  it('ships the planned locales and declares the default one', () => {
    expect(locales.sort()).toEqual(['en', 'ja', 'ko', 'zh_CN']);
    expect(JSON.parse(read(path.join(root, 'public/manifest.json'))).default_locale).toBe('en');
  });

  it.each(locales)('%s has exactly the default keys with the same substitutions', (locale) => {
    const messages = catalog(locale);
    expect(Object.keys(messages).sort()).toEqual(Object.keys(en).sort());
    for (const [key, { message }] of Object.entries(messages)) {
      expect(message.trim(), `${locale}.${key}`).not.toBe('');
      // Chrome parses `$name$` as a named placeholder and rejects the whole extension if it is undeclared ("$1$2").
      expect(message, `${locale}.${key}`).not.toMatch(/\$\w+\$/);
      expect(substitutions(message), `${locale}.${key}`).toBe(substitutions(en[key]!.message));
    }
  });

  it('has no unused messages', () => {
    const code = sources.map(([, s]) => s).join('\n') + read(path.join(root, 'public/manifest.json'));
    const unused = Object.keys(en).filter((key) => !code.includes(`'${key}'`) && !code.includes(`__MSG_${key}__`));
    expect(unused).toEqual([]);
  });

  it('keeps user-facing text out of the source', () => {
    // Chinese city aliases and error-matching patterns are data, not UI copy.
    const allowed = /ZH_CITIES|^\s+(?:'[\w/]+'|UTC): '|\.test\(error\)|^\s*(?:\/\/|\*|\/\*\*)/;
    const offenders = sources.flatMap(([file, text]) => text.split('\n')
      .filter((line) => /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(line) && !allowed.test(line))
      .map((line) => `${file}: ${line.trim()}`));
    expect(offenders).toEqual([]);
  });
});

describe('locale-dependent formatting', () => {
  const useLocale = (locale: string, ui: string) => {
    const messages = catalog(locale);
    vi.stubGlobal('chrome', { i18n: {
      getUILanguage: () => ui,
      getMessage: (key: string, subs: string[] = []) => (messages[key]?.message ?? '').replace(/\$(\d)/g, (_, n) => subs[Number(n) - 1] ?? ''),
    } });
  };
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
  const at = new Date('2026-09-28T01:00:00Z');

  it.each(['en', 'zh_CN', 'ja', 'ko'] as const)('uses selected %s even when the browser uses a different language', async (language) => {
    useLocale('en', 'en-GB');
    const { setLanguage, t, intlLocale } = await import('../src/shared/i18n');
    const tz = await import('../src/shared/timezone');
    setLanguage(language);
    const selected = catalog(language);
    expect(t('modeRules')).toBe(selected.modeRules!.message);
    expect(t('scopeExact', 'example.com')).toBe(selected.scopeExact!.message.replace('$1', 'example.com'));
    expect(intlLocale()).toBe(selected.locale!.message);
    expect(tz.cityLabel('Asia/Tokyo')).toBe(selected.cityTokyo!.message);
    expect(tz.dateLabel('Asia/Tokyo', at)).toBe(new Intl.DateTimeFormat(intlLocale(), { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' }).format(at));
    setLanguage('auto');
    expect(t('modeRules')).toBe(catalog('en').modeRules!.message);
    expect(intlLocale()).toBe('en-GB');
  });

  it('refreshes timezone search names after a manual language change', async () => {
    useLocale('en', 'en-US');
    const { setLanguage } = await import('../src/shared/i18n');
    const tz = await import('../src/shared/timezone');
    tz.searchTimezones('Tokyo');
    setLanguage('ja');
    expect(tz.searchTimezones('東京')[0]?.local).toContain('日本');
  });

  it.each([
    ['en', 'en-GB', 'Shanghai', 'Tokyo', 'Seoul'],
    ['zh_CN', 'zh-CN', '北京', '东京', '首尔'],
    ['ja', 'ja-JP', '上海', '東京', 'ソウル'],
    ['ko', 'ko-KR', '상하이', '도쿄', '서울'],
  ])('localizes and searches displayed cities in %s', async (locale, ui, shanghai, tokyo, seoul) => {
    useLocale(locale!, ui!);
    const tz = await import('../src/shared/timezone');
    expect(tz.cityLabel('Asia/Shanghai')).toBe(shanghai);
    expect(tz.cityLabel('Asia/Tokyo')).toBe(tokyo);
    expect(tz.cityLabel('Asia/Seoul')).toBe(seoul);
    expect(tz.searchTimezones(tokyo!)[0]?.id).toBe('Asia/Tokyo');
    expect(tz.searchTimezones(seoul!)[0]?.id).toBe('Asia/Seoul');
    expect(tz.searchTimezones('东京')[0]?.id).toBe('Asia/Tokyo');
  });
  it('normalizes localized timezone name searches for case and spaces', async () => {
    useLocale('en', 'en-US');
    const tz = await import('../src/shared/timezone');
    const name = tz.searchTimezones('Los Angeles').find(z => z.id === 'America/Los_Angeles')!.local;
    expect(tz.searchTimezones(name.toUpperCase().replaceAll(' ', '_')).some(z => z.id === 'America/Los_Angeles')).toBe(true);
  });
  it('rebuilds cached search names when the catalog language changes', async () => {
    useLocale('en', 'en-US');
    const tz = await import('../src/shared/timezone');
    expect(tz.searchTimezones('Tokyo')[0]?.local).not.toContain('日本');
    useLocale('ja', 'ja-JP');
    expect(tz.searchTimezones('東京')[0]?.local).toContain('日本');
  });
  it.each([['en', 'zh-TW'], ['en', 'de-DE'], ['ja', 'ja-JP'], ['ko', 'ko-KR']])('uses the resolved Intl locale for formatNow: %s/%s', async (locale, ui) => {
    useLocale(locale!, ui!);
    const tz = await import('../src/shared/timezone');
    const { intlLocale } = await import('../src/shared/i18n');
    expect(tz.formatNow('Asia/Tokyo', at)).toBe(new Intl.DateTimeFormat(intlLocale(), { timeZone: 'Asia/Tokyo', dateStyle: 'medium', timeStyle: 'medium' }).format(at));
  });
  it('uses IANA city names and English copy outside a Chinese UI', async () => {
    useLocale('en', 'en-US');
    const tz = await import('../src/shared/timezone');
    expect(tz.cityLabel('America/New_York')).toBe('New York');
    expect(tz.dayDifference('Asia/Tokyo', 'America/Los_Angeles', at)).toBe('1 day ahead of this device');
    expect(tz.dateLabel('Asia/Tokyo', at)).toBe('Mon, September 28, 2026');
    expect(tz.searchTimezones('东京')[0]?.id).toBe('Asia/Tokyo');
  });

  it('formats dates in the catalog language when the UI language has no catalog', async () => {
    useLocale('en', 'zh-TW');
    const { intlLocale } = await import('../src/shared/i18n');
    expect(intlLocale()).toBe('en');
  });

  it('localizes Japanese dates and zone names', async () => {
    useLocale('ja', 'ja');
    const tz = await import('../src/shared/timezone');
    expect(tz.dateLabel('Asia/Tokyo', at)).toContain('2026年9月28日');
    expect(tz.searchTimezones('Tokyo')[0]?.local).toContain('日本');
  });
});


describe('build translation validation', () => {
  it('accepts shipped catalogs and rejects missing keys and invalid substitutions', () => {
    const validate = (directory: string) => spawnSync(process.execPath, [path.join(root, 'scripts/check-i18n.mjs'), directory], { encoding: 'utf8' });
    expect(validate(root).status).toBe(0);
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'timezone-i18n-'));
    try {
      fs.mkdirSync(path.join(fixture, 'public'));
      fs.cpSync(localesDir, path.join(fixture, 'public/_locales'), { recursive: true });
      fs.copyFileSync(path.join(root, 'public/manifest.json'), path.join(fixture, 'public/manifest.json'));
      const file = path.join(fixture, 'public/_locales/ja/messages.json');
      const messages = catalog('ja');
      delete messages.saveApply;
      messages.withDetail = { message: '$1$2' };
      fs.writeFileSync(file, JSON.stringify(messages));
      const failure = validate(fixture);
      expect(failure.status).toBe(1);
      expect(failure.stderr).toContain('ja.saveApply: missing or empty message');
      expect(failure.stderr).toContain('ja.withDetail: invalid placeholder');
      messages.saveApply = catalog('ja').saveApply!;
      messages.withDetail = { message: '$1 / $3' };
      fs.writeFileSync(file, JSON.stringify(messages));
      expect(validate(fixture).stderr).toContain('substitutions differ from default catalog');
    } finally { fs.rmSync(fixture, { recursive: true, force: true }); }
  });
});
