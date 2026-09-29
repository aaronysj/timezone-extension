import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chineseI18n } from './i18n-mock';
import { type Config, type Rule } from '../src/shared/config';
import { siteScopes, rulePatternError } from '../src/shared/domains';
import { ConfigEditor } from '../src/shared/editor';
import { ruleForHost, resolveTimezone } from '../src/shared/resolve';
import { dayDifference } from '../src/shared/timezone';

const rule = (patch: Partial<Rule>): Rule => ({ id: '1', enabled: true, match: 'suffix', action: 'include', pattern: 'example.com', ...patch });
const config = (): Config => ({ mode: 'rules', timezone: 'Asia/Shanghai', rules: [] });
beforeEach(() => vi.stubGlobal('chrome', { i18n: chineseI18n }));
afterEach(() => vi.unstubAllGlobals());

describe('safe site scopes', () => {
  it.each([
    ['shop.example.co.uk', ['shop.example.co.uk', 'example.co.uk']],
    ['a.example.com.cn', ['a.example.com.cn', 'example.com.cn']],
    ['a.tenant.github.io', ['a.tenant.github.io', 'tenant.github.io']],
  ])('stops before the public or private suffix for %s', (host, expected) => {
    const scopes = siteScopes(host);
    expect(scopes[0]).toEqual({ pattern: host, match: 'exact' });
    expect(scopes.filter((s) => s.match === 'suffix').map((s) => s.pattern)).toEqual(expected);
  });
  it.each(['localhost', '127.0.0.1', '[::1]', 'intranet.local'])('offers only the exact host for %s', (host) => {
    expect(siteScopes(host)).toEqual([{ pattern: host, match: 'exact' }]);
  });
  it.each(['co.uk', 'com.cn', 'github.io', 'com'])('rejects suffix-wide rules on %s', (host) => {
    expect(rulePatternError(host, 'suffix')).toContain('公共后缀');
  });
  it('a new exact rule does not modify sibling sites', () => {
    const c = config();
    c.rules = [rule({ ...siteScopes('shop.example.co.uk')[0]! })];
    expect(resolveTimezone('https://shop.example.co.uk', c)?.timezone).toBe('Asia/Shanghai');
    expect(resolveTimezone('https://other.example.co.uk', c)).toBeNull();
    expect(resolveTimezone('https://other.co.uk', c)).toBeNull();
  });
});

describe('effective editor rule', () => {
  it('returns the same exact rule as the resolver', () => {
    const c = config();
    c.rules = [rule({}), rule({ id: '2', match: 'exact', pattern: 'docs.example.com', timezone: 'America/New_York' })];
    expect(ruleForHost('docs.example.com', c.rules)).toBe(resolveTimezone('https://docs.example.com', c)?.rule);
  });
  it('returns the exclusion that blocks an exact include', () => {
    const rules = [rule({ action: 'exclude' }), rule({ id: '2', match: 'exact', pattern: 'docs.example.com' })];
    expect(ruleForHost('docs.example.com', rules)?.id).toBe('1');
  });
});

describe('retained drafts and serialized storage writes', () => {
  it('preserves a failed draft and saves it on retry', async () => {
    const write = vi.fn().mockRejectedValueOnce(new Error('quota')).mockResolvedValueOnce(undefined);
    const editor = new ConfigEditor(config(), vi.fn(), vi.fn(), write);
    const next = { ...config(), timezone: 'Asia/Tokyo' };
    expect(await editor.update(next)).toBe(false);
    expect(editor.state).toBe('error');
    editor.receive(config());
    expect(editor.value).toEqual(next);
    expect(await editor.retry()).toBe(true);
    expect(editor.state).toBe('saved');
    expect(write).toHaveBeenLastCalledWith(next);
  });
  it('serializes rapid edits without regressing the visible draft', async () => {
    let release!: () => void;
    const write = vi.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; })).mockResolvedValue(undefined);
    const editor = new ConfigEditor(config(), vi.fn(), vi.fn(), write);
    const first = editor.update({ ...config(), timezone: 'Asia/Tokyo' });
    const second = editor.update({ ...config(), timezone: 'America/New_York' });
    await Promise.resolve();
    expect(write).toHaveBeenCalledTimes(1);
    editor.receive(config());
    expect(editor.value.timezone).toBe('America/New_York');
    release();
    await first;
    expect(await second).toBe(true);
    expect(write.mock.calls.map((args) => args[0].timezone)).toEqual(['Asia/Tokyo', 'America/New_York']);
    expect(editor.state).toBe('saved');
  });
});

describe('calendar day difference', () => {
  it('reports cross-date changes in both directions', () => {
    const at = new Date('2026-09-28T01:00:00Z');
    expect(dayDifference('Asia/Tokyo', 'America/Los_Angeles', at)).toBe('比本机晚 1 天');
    expect(dayDifference('America/Los_Angeles', 'Asia/Tokyo', at)).toBe('比本机早 1 天');
    expect(dayDifference('Asia/Tokyo', 'Asia/Shanghai', at)).toBe('');
  });
});
