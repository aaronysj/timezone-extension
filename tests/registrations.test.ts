import { expect, it } from 'vitest';
import { registrations } from '../src/background/registrations';
import { resolveTimezone } from '../src/shared/resolve';
import type { Config } from '../src/shared/config';

const matches = (pattern: string, url: string) => {
  const host = new URL(url).hostname;
  const target = pattern.split('://')[1]!.slice(0, -2);
  return target.startsWith('*.') ? host === target.slice(2) || host.endsWith(target.slice(1)) : host === target;
};
it('compiles rule precedence into exactly one early script, including trailing-dot hosts', () => {
  const config: Config = { mode: 'rules', timezone: 'UTC', rules: [
    { id: 'base', enabled: true, action: 'include', match: 'suffix', pattern: 'example.com', timezone: 'Asia/Tokyo' },
    { id: 'sub', enabled: true, action: 'include', match: 'suffix', pattern: 'sub.example.com', timezone: 'Europe/London' },
    { id: 'exact', enabled: true, action: 'include', match: 'exact', pattern: 'exact.sub.example.com', timezone: 'America/New_York' },
    { id: 'tie', enabled: true, action: 'include', match: 'exact', pattern: 'exact.sub.example.com', timezone: 'Asia/Seoul' },
    { id: 'exclude', enabled: true, action: 'exclude', match: 'suffix', pattern: 'pay.example.com' },
  ] };
  const scripts = registrations(config);
  for (const url of ['https://example.com/', 'http://example.com.:8080/', 'https://www.example.com/', 'https://x.sub.example.com/', 'https://exact.sub.example.com/', 'https://pay.example.com/', 'https://x.pay.example.com/', 'https://other.com/', 'https://badexample.com/']) {
    const active = scripts.filter(s => s.matches!.some(p => matches(p, url)) && !s.excludeMatches!.some(p => matches(p, url)));
    const desired = resolveTimezone(url, config)?.timezone;
    expect(active.length, url).toBe(desired ? 1 : 0);
    if (desired) expect(active[0]!.js![0], url).toBe(`timezones/${desired.replaceAll('/', '_')}.js`);
  }
  expect(scripts.every(s => s.world === 'MAIN' && s.runAt === 'document_start' && s.allFrames && s.persistAcrossSessions)).toBe(true);
});

it('ships a bootstrap file for every tzdata Zone and Link name, including link names Chrome may canonicalize to', async () => {
  const { fileName } = await import('../scripts/timezone-names.mjs');
  const { existsSync, readFileSync } = await import('node:fs');
  if (!existsSync('dist/timezones/index.json')) return; // needs `npm run build`
  const shipped = new Set(JSON.parse(readFileSync('dist/timezones/index.json', 'utf8')) as string[]);
  for (const zone of ['Asia/Calcutta', 'Asia/Kolkata', 'Europe/Kiev', 'Europe/Kyiv', 'US/Eastern', 'America/Coyhaique', 'UTC', ...Intl.supportedValuesOf('timeZone')]) {
    expect(shipped.has(fileName(zone)), zone).toBe(true);
    expect(existsSync(`dist/timezones/${fileName(zone)}`), zone).toBe(true);
  }
});
