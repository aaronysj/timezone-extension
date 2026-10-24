// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../src/shared/config';
import { resolveTimezone } from '../src/shared/resolve';
import { chineseI18n, localeI18n } from './i18n-mock';

let stored: Config;
let site: string;
let failure: boolean;
let statusFailure: boolean;
let appliedOverride: string | undefined;
let temporaryZone: string | null;
let sent: unknown[];
let listeners: ((changes: unknown, area: string) => void)[];
const input = (id: string) => document.getElementById(id) as HTMLInputElement;
const text = () => document.body.textContent!;
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const change = (id: string, value: string) => { const el = input(id); el.value = value; el.dispatchEvent(new Event('change', { bubbles: true })); };

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  site = 'https://docs.example.com';
  failure = false;
  statusFailure = false;
  appliedOverride = undefined;
  temporaryZone = null;
  sent = [];
  listeners = [];
  stored = { mode: 'rules', timezone: 'Asia/Shanghai', rules: [
    { id: 'parent', enabled: true, action: 'include', match: 'suffix', pattern: 'example.com' },
    { id: 'exact', enabled: true, action: 'include', match: 'exact', pattern: 'docs.example.com', timezone: 'America/New_York' },
  ] };
  document.body.innerHTML = '<main id="app"></main>';
  vi.stubGlobal('chrome', {
    i18n: chineseI18n,
    tabs: { query: async () => [{ id: 1, url: site }], reload: vi.fn() },
    storage: { local: {
      get: async () => ({ config: structuredClone(stored) }),
      set: async ({ config }: { config: Config }) => {
        if (failure) throw new Error('storage quota');
        stored = structuredClone(config);
        listeners.forEach((fn) => fn({ config: { newValue: stored } }, 'local'));
      },
    }, onChanged: { addListener: (fn: typeof listeners[number]) => listeners.push(fn) } },
    runtime: { openOptionsPage: vi.fn(), sendMessage: async (req: { type: string; timezone?: string | null }) => {
      sent.push(req);
      if (req.type === 'setTemporary') { temporaryZone = req.timezone ?? null; return null; }
      const desired = temporaryZone ? { timezone: temporaryZone, temporary: true } : resolveTimezone(site, stored);
      return { desired, temporary: temporaryZone, applied: appliedOverride ?? (statusFailure ? null : desired?.timezone ?? null),
        ...(statusFailure ? { error: 'Cannot access contents of the page. Extension host permission is withheld.' } : {}) };
    } },
  });
  Element.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.showPopover = vi.fn();
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('popup regressions', () => {
  it('shows the site clock while the page status is still pending', async () => {
    vi.useFakeTimers();
    let answer: ((status: unknown) => void) | undefined;
    const sendMessage = vi.fn(() => new Promise((resolve) => { answer ??= resolve; }));
    vi.stubGlobal('chrome', { ...chrome, runtime: { ...chrome.runtime, sendMessage } });
    await import('../src/popup/main');
    await flush();
    expect(document.querySelector('.now-host')?.textContent).toBe(new URL(site).hostname);
    expect(document.querySelector('.now-time')?.textContent).toMatch(/^\d\d:\d\d$/);
    await vi.advanceTimersByTimeAsync(3000);
    // Polling waits for the pending answer instead of discarding it as stale.
    expect(sendMessage).toHaveBeenCalledTimes(1);
    answer!({ desired: null, applied: null });
    await flush();
    expect(text()).toContain(chineseI18n.getMessage('statusSystem'));
  });
  it('saves a language change, updates the entire popup, and restores the browser language', async () => {
    await import('../src/popup/main');
    input('popup-language').focus();
    const previous = structuredClone(stored);
    change('popup-language', 'en');
    await flush();
    expect(stored).toEqual({ ...previous, language: 'en' });
    expect(document.documentElement.lang).toBe('en');
    expect(input('mode-rules').textContent).toBe('By rules');
    expect(input('site-tz').value).toBe('New York');
    expect(document.activeElement?.id).toBe('popup-language');
    expect(text()).toContain(localeI18n('en').getMessage('statusApplied'));
    change('popup-language', 'auto');
    await flush();
    expect(stored.language).toBe('auto');
    expect(document.documentElement.lang).toBe('zh-CN');
    expect(input('mode-rules').textContent).toBe('按规则');
  });
  it('retains a failed language change for retry without persisting it', async () => {
    await import('../src/popup/main');
    failure = true;
    change('popup-language', 'ja');
    await flush();
    expect(stored.language).toBeUndefined();
    expect(input('popup-language').value).toBe('ja');
    expect(input('retry-save').textContent).toBe(localeI18n('ja').getMessage('saveRetry'));
    failure = false;
    input('retry-save').click();
    await flush();
    expect(stored.language).toBe('ja');
  });
  it('loads the saved language and follows updates from the settings page', async () => {
    stored.language = 'ko';
    await import('../src/popup/main');
    expect(document.documentElement.lang).toBe('ko');
    expect(input('popup-language').value).toBe('ko');
    stored = { ...stored, language: 'en' };
    listeners.forEach((fn) => fn({ config: { newValue: stored } }, 'local'));
    await flush();
    expect(document.documentElement.lang).toBe('en');
    expect(input('site-tz').value).toBe('New York');
  });
  it('keeps abandoned and invalid search feedback visible in the compact picker', async () => {
    await import('../src/popup/main');
    expect(document.querySelector('.tzp-help')?.textContent).toBe('');
    const picker = input('site-tz');
    picker.focus();
    picker.value = 'no-such-timezone';
    picker.dispatchEvent(new Event('input', { bubbles: true }));
    picker.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(picker.ariaInvalid).toBe('true');
    expect(text()).toContain('没有有效时区');
    picker.blur();
    expect(picker.value).toBe('纽约');
    expect(text()).toContain('未选择结果，时区未更改');
    expect(stored.rules[1]!.timezone).toBe('America/New_York');
  });
  it('creates an exact override from an inherited rule without changing its parent', async () => {
    site = 'https://hubble.amh-group.com';
    stored.rules = [{ ...stored.rules[0]!, pattern: 'amh-group.com' }];
    await import('../src/popup/main');
    expect(input('site-scope').value).toBe('suffix:amh-group.com');
    change('site-scope', 'exact:hubble.amh-group.com');
    expect(input('site-scope').value).toBe('exact:hubble.amh-group.com');
    const picker = input('site-tz');
    picker.value = '东京';
    picker.dispatchEvent(new Event('input', { bubbles: true }));
    picker.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();
    expect(stored.rules).toHaveLength(2);
    expect(stored.rules[0]!.timezone).toBeUndefined();
    expect(stored.rules[1]).toMatchObject({ pattern: 'hubble.amh-group.com', match: 'exact', timezone: 'Asia/Tokyo' });
  });
  it('edits the effective exact rule, not its parent rule', async () => {
    await import('../src/popup/main');
    expect(input('site-scope').value).toBe('exact:docs.example.com');
    expect(input('site-tz').value).toBe('纽约');
    input('site-tz').focus();
    input('site-tz').value = '东京';
    input('site-tz').dispatchEvent(new Event('input', { bubbles: true }));
    input('site-tz').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();
    expect(stored.rules.find((r) => r.id === 'exact')?.timezone).toBe('Asia/Tokyo');
    expect(stored.rules.find((r) => r.id === 'parent')?.timezone).toBeUndefined();
    expect(document.activeElement?.id).toBe('site-tz');
    expect(input('site-tz').ariaExpanded).toBe('false');
  });
  it('defaults a new site to its registrable domain, never a public suffix', async () => {
    site = 'https://shop.example.co.uk';
    await import('../src/popup/main');
    expect(input('site-scope').value).toBe('suffix:example.co.uk');
    // Timezone comes first; nothing to undo on a site without rules.
    expect(input('site-tz').compareDocumentPosition(input('site-scope')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.getElementById('use-system')).toBeNull();
    expect(document.getElementById('remove-site-rule')).toBeNull();
    const picker = input('site-tz');
    picker.value = '东京';
    picker.dispatchEvent(new Event('input', { bubbles: true }));
    picker.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();
    expect(stored.rules.at(-1)).toMatchObject({ pattern: 'example.co.uk', match: 'suffix', action: 'include', timezone: 'Asia/Tokyo' });
    expect(input('remove-site-rule')).toBeTruthy();
    expect([...document.querySelectorAll('#site-scope option')].some((o) => (o as HTMLOptionElement).value === 'suffix:co.uk')).toBe(false);
  });
  it('warns about an existing public-suffix rule without silently changing it', async () => {
    site = 'https://shop.example.co.uk';
    stored.rules = [{ ...stored.rules[0]!, pattern: 'co.uk' }];
    await import('../src/popup/main');
    expect(text()).toContain('已有规则范围过宽');
    expect(document.getElementById('site-tz')).toBeNull();
    expect(stored.rules[0]!.pattern).toBe('co.uk');
    expect(input('remove-site-rule')).toBeTruthy();
  });
  it('renders error cause and a retry action without claiming success', async () => {
    statusFailure = true;
    await import('../src/popup/main');
    expect(text()).toContain('修改失败');
    expect(text()).toContain('当前仍使用系统时区');
    expect(text()).toContain('Cannot access contents of the page');
    expect(input('retry-apply')).toBeTruthy();
    expect(text()).not.toContain('已生效');
  });
  it('does not claim success while an old timezone is still applied', async () => {
    appliedOverride = 'Asia/Tokyo';
    await import('../src/popup/main');
    expect(text()).toContain('应用中');
    expect(text()).not.toContain('已生效');
  });
  it('shows exclusions and does not silently bypass them with a local include', async () => {
    stored.rules[0]!.action = 'exclude';
    await import('../src/popup/main');
    expect(input('site-scope').value).toBe('suffix:example.com');
    change('site-scope', 'exact:docs.example.com');
    expect(text()).toContain('排除规则 example.com 优先');
    expect(input('edit-effective')).toBeTruthy();
  });
});

describe('options regressions', () => {
  it('hides rule editing and the URL tester in global mode while preserving rules through save', async () => {
    await import('../src/options/main');
    const original = structuredClone(stored.rules);
    const writes = vi.spyOn(chrome.storage.local, 'set');
    input('mode-global').click();
    expect(document.querySelector('.rules')).toBeNull();
    expect(document.getElementById('tester')).toBeNull();
    expect(document.getElementById('add-site')).toBeNull();
    expect(document.querySelector('.hero-purpose')?.textContent).toContain('所有网站使用的时间');
    expect((document.querySelector('.pending-state') as HTMLElement).hidden).toBe(false);
    expect(input('default-tz').ariaLabel).toBe('所有网站时区');
    expect(text()).not.toContain('草稿');
    expect(text()).toContain('网站规则会保留');
    expect(writes).not.toHaveBeenCalled();
    expect(stored.mode).toBe('rules');
    input('save-settings').click();
    await flush();
    expect(stored.mode).toBe('global');
    expect(stored.rules).toEqual(original);
    expect((document.querySelector('.pending-state') as HTMLElement).hidden).toBe(true);
    input('activate-rules').click();
    expect(document.querySelectorAll('.rule')).toHaveLength(original.length);
    expect(document.activeElement?.id).toBe('mode-rules');
    expect(stored.mode).toBe('global');
    input('save-settings').click();
    await flush();
    expect(stored.mode).toBe('rules');
    expect(stored.rules).toEqual(original);
  });
  it('discards a mode change without losing accepted rule edits', async () => {
    await import('../src/options/main');
    input('rule-parent-scope-exact').click();
    input('mode-global').click();
    input('mode-rules').click();
    expect(input('rule-parent-scope').textContent).toContain('仅此域名');
    input('mode-global').click();
    input('discard-settings').click();
    expect(input('mode-rules').ariaPressed).toBe('true');
    expect(input('rule-parent-scope').textContent).toContain('含子域名');
    expect((document.querySelector('.pending-state') as HTMLElement).hidden).toBe(true);
  });
  it('makes unfinished rule fields recoverable instead of failing validation in a hidden section', async () => {
    await import('../src/options/main');
    input('rule-parent-pattern').value = 'bad domain';
    input('rule-parent-pattern').dispatchEvent(new Event('input', { bubbles: true }));
    input('mode-global').click();
    expect(document.getElementById('rule-parent-pattern')).toBeNull();
    expect(text()).toContain('还有未完成的网站编辑');
    input('save-settings').click();
    await flush();
    expect(stored.mode).toBe('rules');
    expect(document.querySelector('.mode-summary [role="alert"]')).not.toBeNull();
    expect(document.activeElement?.id).toBe('activate-rules');
    input('activate-rules').click();
    expect(input('rule-parent-pattern').value).toBe('bad domain');
    expect(document.activeElement?.id).toBe('rule-parent-pattern');
    input('rule-parent-pattern').value = 'new.example.com';
    input('rule-parent-pattern').dispatchEvent(new Event('input', { bubbles: true }));
    input('rule-parent-edit-done').click();
    input('mode-global').click();
    input('save-settings').click();
    await flush();
    expect(stored.mode).toBe('global');
    expect(stored.rules[0]!.pattern).toBe('new.example.com');
  });
  it('lets users discard only unfinished site input and still save the selected global settings', async () => {
    await import('../src/options/main');
    input('rule-parent-scope-exact').click();
    input('add-site').value = 'not a domain';
    input('add-site').dispatchEvent(new Event('input', { bubbles: true }));
    input('mode-global').click();
    input('discard-rule-inputs').click();
    expect(input('mode-global').ariaPressed).toBe('true');
    expect(document.getElementById('discard-rule-inputs')).toBeNull();
    expect(document.activeElement?.id).toBe('activate-rules');
    input('save-settings').click();
    await flush();
    expect(stored.mode).toBe('global');
    expect(stored.rules[0]!.match).toBe('exact');
  });
  it('does not let invalid inactive legacy rules block a global mode save', async () => {
    stored.rules[0]!.pattern = 'co.uk';
    await import('../src/options/main');
    const original = structuredClone(stored.rules);
    input('mode-global').click();
    input('save-settings').click();
    await flush();
    expect(stored.mode).toBe('global');
    expect(stored.rules).toEqual(original);
  });
  it('shows the system clock and retains rules when switching off', async () => {
    await import('../src/options/main');
    input('mode-off').click();
    expect(document.querySelector('.rules')).toBeNull();
    expect(document.querySelector('.hero-purpose')?.textContent).toContain('本机时间');
    expect((document.querySelector('.big-clock') as HTMLElement).dataset.tz).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(text()).toContain('已配置的网站规则会保留');
  });
  it('stages language changes, discards them, then saves and localizes all controls', async () => {
    await import('../src/options/main');
    const writes = vi.spyOn(chrome.storage.local, 'set');
    change('settings-language', 'en');
    expect(stored.language).toBeUndefined();
    expect(document.documentElement.lang).toBe('zh-CN');
    expect(input('save-settings').disabled).toBe(false);
    input('discard-settings').click();
    expect(input('settings-language').value).toBe('auto');
    expect(writes).not.toHaveBeenCalled();
    change('settings-language', 'ja');
    input('save-settings').click();
    await flush();
    expect(stored.language).toBe('ja');
    expect(writes).toHaveBeenCalledTimes(1);
    const ja = localeI18n('ja');
    expect(document.documentElement.lang).toBe('ja');
    expect(input('mode-rules').textContent).toBe(ja.getMessage('modeRules'));
    expect(input('default-tz').value).toBe(ja.getMessage('cityShanghai'));
    expect(text()).toContain(ja.getMessage('saveAppliedDone'));
    expect(input('overwrite-settings')).toBeNull();
    expect(document.title).toBe(ja.getMessage('optionsTitle'));
  });
  it('keeps a failed language save in the draft until retry succeeds', async () => {
    await import('../src/options/main');
    failure = true;
    change('settings-language', 'ko');
    input('save-settings').click();
    await flush();
    expect(stored.language).toBeUndefined();
    expect(input('settings-language').value).toBe('ko');
    expect(document.documentElement.lang).toBe('zh-CN');
    failure = false;
    input('save-settings').click();
    await flush();
    expect(stored.language).toBe('ko');
    expect(document.documentElement.lang).toBe('ko');
  });
  it('follows popup changes without overwriting an unsaved options draft', async () => {
    await import('../src/options/main');
    stored = { ...stored, language: 'en' };
    listeners.forEach((fn) => fn({ config: { newValue: stored } }, 'local'));
    expect(document.documentElement.lang).toBe('en');
    expect(input('settings-language').value).toBe('en');
    change('settings-language', 'ja');
    stored = { ...stored, language: 'ko' };
    listeners.forEach((fn) => fn({ config: { newValue: stored } }, 'local'));
    expect(input('settings-language').value).toBe('ja');
    expect(document.documentElement.lang).toBe('en');
    expect(input('save-settings').disabled).toBe(true);
    input('discard-settings').click();
    expect(input('settings-language').value).toBe('ko');
    expect(document.documentElement.lang).toBe('ko');
  });
  it('stages exact/suffix scope and custom/default/system timezones through the unified controls', async () => {
    await import('../src/options/main');
    const writes = vi.spyOn(chrome.storage.local, 'set');
    input('rule-parent-scope-exact').click();
    expect(input('rule-parent-scope').textContent).toContain('仅此域名');
    expect(stored.rules[0]!.match).toBe('suffix');
    input('rule-exact-system').click();
    expect(input('rule-exact-zone').textContent).toContain('使用系统时区');
    input('rule-parent-tz').focus();
    input('rule-parent-tz').value = '东京';
    input('rule-parent-tz').dispatchEvent(new Event('input', { bubbles: true }));
    input('rule-parent-tz').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(input('rule-parent-zone').textContent).toContain('东京');
    expect(document.activeElement?.id).toBe('rule-parent-zone');
    expect(writes).not.toHaveBeenCalled();
    input('save-settings').click();
    await flush();
    expect(stored.rules[0]).toMatchObject({ match: 'exact', timezone: 'Asia/Tokyo', action: 'include' });
    expect(stored.rules[1]!.action).toBe('exclude');
    expect(writes).toHaveBeenCalledTimes(1);
    input('rule-parent-default').click();
    input('save-settings').click();
    await flush();
    expect(stored.rules[0]!.timezone).toBeUndefined();
  });
  it('prevents duplicate scope changes and restores the existing scope without writing', async () => {
    stored.rules.push({ ...stored.rules[0]!, id: 'duplicate', match: 'exact' });
    await import('../src/options/main');
    input('rule-parent-scope-exact').click();
    expect(text()).toContain('已存在相同域名和范围的规则');
    expect(input('rule-parent-scope').textContent).toContain('含子域名');
    expect(stored.rules[0]!.match).toBe('suffix');
  });
  it('edits a domain in its editor and stages only a valid normalized value', async () => {
    await import('../src/options/main');
    input('rule-parent-edit').click();
    input('rule-parent-pattern').value = 'https://new.example.com/path';
    input('rule-parent-pattern').dispatchEvent(new Event('input', { bubbles: true }));
    input('rule-parent-edit-done').click();
    expect(document.querySelector('[data-id="parent"] .domain-name')?.textContent).toBe('new.example.com');
    expect(stored.rules[0]!.pattern).toBe('example.com');
    input('save-settings').click();
    await flush();
    expect(stored.rules[0]!.pattern).toBe('new.example.com');
  });
  it('stages mode changes until Save and applies them in one write', async () => {
    await import('../src/options/main');
    const writes = vi.spyOn(chrome.storage.local, 'set');
    input('mode-global').click();
    input('default-tz').focus();
    input('default-tz').value = '东京';
    input('default-tz').dispatchEvent(new Event('input', { bubbles: true }));
    input('default-tz').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();
    expect(stored.mode).toBe('rules');
    expect(stored.timezone).toBe('Asia/Shanghai');
    expect(writes).not.toHaveBeenCalled();
    expect(input('save-settings')).toBeTruthy();
    input('save-settings').click();
    await flush();
    expect(stored.mode).toBe('global');
    expect(stored.timezone).toBe('Asia/Tokyo');
    expect(writes).toHaveBeenCalledTimes(1);
    expect(text()).toContain('已保存并应用');
  });
  it('discards staged deletion without writing to storage', async () => {
    await import('../src/options/main');
    input('rule-exact-remove').click();
    await flush();
    expect(stored.rules).toHaveLength(2);
    expect(document.getElementById('rule-exact-pattern')).toBeNull();
    input('discard-settings').click();
    expect(input('rule-exact-pattern')).toBeTruthy();
    expect(stored.rules).toHaveLength(2);
  });
  it('rejects invalid domains without losing the draft', async () => {
    await import('../src/options/main');
    input('add-site').value = 'not a domain';
    input('add-site').dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();
    expect(stored.rules).toHaveLength(2);
    expect(input('add-site').value).toBe('not a domain');
    expect(input('add-site').ariaInvalid).toBe('true');
    expect(text()).toContain('请输入有效域名');
    expect(document.activeElement?.id).toBe('add-site');
  });
  it('keeps focus and exposes the selected mode after a rerender', async () => {
    await import('../src/options/main');
    input('rule-parent-enabled').focus();
    input('rule-parent-enabled').checked = false;
    input('rule-parent-enabled').dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(document.activeElement?.id).toBe('rule-parent-enabled');
    expect(input('mode-rules').ariaPressed).toBe('true');
    expect((document.querySelector('.pending-state') as HTMLElement).hidden).toBe(false);
    expect(stored.rules[0]!.enabled).toBe(true);
  });
  it('defaults added rules to exact and retains failed edits for retry', async () => {
    await import('../src/options/main');
    failure = true;
    input('add-site').value = 'shop.example.co.uk';
    input('add-site').dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();
    expect(text()).toContain('未保存');
    expect(text()).toContain('shop.example.co.uk');
    expect(stored.rules).toHaveLength(2);
    input('save-settings').click();
    await flush();
    expect(text()).toContain('保存失败');
    failure = false;
    input('save-settings').click();
    await flush();
    expect(stored.rules.at(-1)).toMatchObject({ pattern: 'shop.example.co.uk', match: 'exact' });
    expect(text()).toContain('已保存');
  });
  it('validates edits and preserves an invalid field during another edit', async () => {
    await import('../src/options/main');
    input('rule-parent-pattern').value = 'bad domain';
    input('rule-parent-pattern').dispatchEvent(new Event('input', { bubbles: true }));
    input('rule-parent-edit').click();
    input('rule-parent-edit-done').click();
    input('rule-parent-enabled').checked = false;
    input('rule-parent-enabled').dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(stored.rules[0]!.pattern).toBe('example.com');
    expect(input('rule-parent-pattern').value).toBe('bad domain');
    expect(text()).toContain('请输入有效域名');
    input('save-settings').click();
    await flush();
    expect(stored.rules[0]!.enabled).toBe(true);
    expect(document.activeElement?.id).toBe('rule-parent-pattern');
  });
  it('preserves a local draft when another window changes the persisted configuration', async () => {
    await import('../src/options/main');
    input('mode-global').click();
    stored = { ...stored, timezone: 'Europe/London' };
    listeners.forEach((fn) => fn({ config: { newValue: stored } }, 'local'));
    expect(input('mode-global').ariaPressed).toBe('true');
    expect(text()).toContain('其他窗口已修改设置');
    expect(input('save-settings').disabled).toBe(true);
    input('discard-settings').click();
    expect(input('default-tz').value).toBe('伦敦');
    expect(input('mode-rules').ariaPressed).toBe('true');
  });
  it('deletes and restores with a useful keyboard focus target', async () => {
    await import('../src/options/main');
    input('rule-exact-remove').click();
    await flush();
    expect(stored.rules).toHaveLength(2);
    expect(document.getElementById('rule-exact-pattern')).toBeNull();
    expect(document.activeElement?.id).toBe('undo-delete');
    input('undo-delete').click();
    await flush();
    expect(stored.rules).toHaveLength(2);
    expect(document.activeElement?.id).toBe('rule-exact-enabled');
  });
});


describe.each(['en', 'zh_CN', 'ja', 'ko', 'de'])('localized UI flows: %s', (locale) => {
  it('localizes options, invalid-domain feedback, and the explicit save flow', async () => {
    const i18n = localeI18n(locale);
    vi.stubGlobal('chrome', { ...chrome, i18n });
    await import('../src/options/main');
    expect(document.documentElement.lang).toBe(i18n.getMessage('locale'));
    expect(document.title).toBe(i18n.getMessage('optionsTitle'));
    expect(input('save-settings').textContent).toBe(i18n.getMessage('saveApply'));
    input('mode-global').click();
    expect(stored.mode).toBe('rules');
    input('save-settings').click();
    await flush();
    expect(stored.mode).toBe('global');
    expect(text()).toContain(i18n.getMessage('saveAppliedDone'));
    expect(document.querySelector('.rules')).toBeNull();
    expect(text()).toContain(i18n.getMessage('rulesRetainedGlobal'));
    input('mode-rules').click();
    input('add-site').value = 'bad domain';
    input('add-site').dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(document.getElementById('add-site-error')?.textContent).toBe(i18n.getMessage('patternInvalid'));
    expect(text()).not.toMatch(/__MSG_|\$[1-9]|undefined/);
  });
  it('localizes popup status, scope parameters, search, and backend-error guidance', async () => {
    const i18n = localeI18n(locale);
    vi.stubGlobal('chrome', { ...chrome, i18n });
    statusFailure = true;
    await import('../src/popup/main');
    await flush();
    expect(document.documentElement.lang).toBe(i18n.getMessage('locale'));
    expect(text()).toContain(i18n.getMessage('statusFailed'));
    expect(text()).toContain(i18n.getMessage('errHelpDebugger'));
    expect(input('site-scope').textContent).toContain('docs.example.com');
    input('site-tz').focus();
    input('site-tz').value = 'Tokyo';
    input('site-tz').dispatchEvent(new Event('input', { bubbles: true }));
    input('site-tz').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();
    expect(stored.rules[1]!.timezone).toBe('Asia/Tokyo');
    expect(input('site-tz').value).toBe(i18n.getMessage('cityTokyo'));
    expect(text()).not.toMatch(/__MSG_|\$[1-9]|undefined/);
  });
});

describe('temporary tab override', () => {
  const pick = async (id: string, query: string) => {
    input(id).focus();
    input(id).value = query;
    input(id).dispatchEvent(new Event('input', { bubbles: true }));
    input(id).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();
  };
  it.each(['off', 'global', 'rules'] as const)('is offered in %s mode, empty and without an active note', async (mode) => {
    stored = { ...stored, mode };
    await import('../src/popup/main');
    await flush();
    expect(input('temp-tz').value).toBe('');
    expect(input('temp-tz').placeholder).toBe(chineseI18n.getMessage('tempPlaceholder'));
    expect(document.querySelector('label[for="temp-tz"]')?.textContent).toBe(chineseI18n.getMessage('tempUse'));
    expect(document.getElementById('temp-clear')).toBeNull();
    expect(text()).not.toContain(chineseI18n.getMessage('tempHint'));
  });
  it('sits after the site controls and before the language selector', async () => {
    await import('../src/popup/main');
    expect(input('site-tz').compareDocumentPosition(input('temp-tz')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(input('temp-tz').compareDocumentPosition(input('popup-language')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it('is hidden on pages it cannot cover', async () => {
    site = 'chrome://extensions';
    await import('../src/popup/main');
    expect(document.getElementById('temp-tz')).toBeNull();
  });
  it('commits through setTemporary without touching config, then shows the temporary state', async () => {
    stored = { ...stored, mode: 'off' };
    const before = structuredClone(stored);
    await import('../src/popup/main');
    await flush();
    await pick('temp-tz', '东京');
    expect(sent).toContainEqual({ type: 'setTemporary', tabId: 1, timezone: 'Asia/Tokyo' });
    expect(stored).toEqual(before);
    expect(input('temp-tz').value).toBe('东京');
    expect(document.activeElement?.id).toBe('temp-tz');
    expect(text()).toContain(chineseI18n.getMessage('tempHint'));
    expect(text()).toContain(chineseI18n.getMessage('statusTemporary'));
    expect(text()).toContain(chineseI18n.getMessage('explainTemporary'));
    expect(document.querySelector('.now-city')?.getAttribute('title')).toBe('Asia/Tokyo');
    expect(document.querySelector('.state.ok')).not.toBeNull();
  });
  it('reflects an existing override on open, over what config says', async () => {
    temporaryZone = 'Asia/Tokyo';
    await import('../src/popup/main');
    await flush();
    expect(input('temp-tz').value).toBe('东京');
    expect(document.querySelector('.now-city')?.getAttribute('title')).toBe('Asia/Tokyo');
    expect(text()).toContain(chineseI18n.getMessage('statusTemporary'));
  });
  it('reloads the tab and ends the override, returning focus to the picker', async () => {
    temporaryZone = 'Asia/Tokyo';
    await import('../src/popup/main');
    await flush();
    input('temp-reload').click();
    expect(chrome.tabs.reload).toHaveBeenCalledWith(1);
    input('temp-clear').focus();
    input('temp-clear').click();
    await flush();
    expect(sent).toContainEqual({ type: 'setTemporary', tabId: 1, timezone: null });
    expect(document.getElementById('temp-clear')).toBeNull();
    expect(input('temp-tz').value).toBe('');
    expect(document.activeElement?.id).toBe('temp-tz');
    expect(text()).not.toContain(chineseI18n.getMessage('statusTemporary'));
  });
  it('shows the background error instead of pretending the override applied', async () => {
    const send = chrome.runtime.sendMessage as (req: unknown) => Promise<unknown>;
    vi.stubGlobal('chrome', { ...chrome, runtime: { ...chrome.runtime, sendMessage: async (req: { type: string }) => req.type === 'setTemporary' ? { error: 'Error: Page storage is unavailable' } : send(req) } });
    await import('../src/popup/main');
    await flush();
    await pick('temp-tz', '东京');
    expect(text()).toContain(chineseI18n.getMessage('statusFailed'));
    expect(text()).toContain('Page storage is unavailable');
    expect(document.getElementById('temp-clear')).toBeNull();
  });
});
