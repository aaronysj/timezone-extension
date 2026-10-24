import { type Config, type Rule, loadConfig, onConfigChanged, upsertRule } from '../shared/config';
import { ConfigEditor } from '../shared/editor';
import { type SiteScope, rulePatternError, scopeLabel, siteScopes } from '../shared/domains';
import { bundleLocale, intlLocale, localizeDocument, setLanguage, t } from '../shared/i18n';
import { type TabStatus, sendRequest } from '../shared/messages';
import { hostnameOf, normalizePattern, resolveTimezone, ruleForHost } from '../shared/resolve';
import { cityLabel, dateLabel, dayDifference, offsetLabel, systemTimezone, timeDifference } from '../shared/timezone';
import { h, languageSelect, modeLabel, modeSwitch, replaceKeepingFocus, saveNotice } from '../ui/dom';
import { timezonePicker } from '../ui/tzpicker';

localizeDocument('extName');
const root = document.getElementById('app')!;
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const tabUrl = tab?.pendingUrl ?? tab?.url;
const host = tabUrl ? hostnameOf(tabUrl) : null;
let config = await loadConfig();
const effectiveScope = (): SiteScope => {
  const rule = ruleForHost(host ?? '', config.rules);
  if (rule) return { pattern: normalizePattern(rule.pattern), match: rule.match };
  // New rules cover the whole site by default; hosts without a registrable domain (IPs, localhost) stay exact.
  return siteScopes(host ?? '').at(-1) ?? { pattern: host ?? '', match: 'exact' };
};
let selected: SiteScope = effectiveScope();
let followEffective = true;
let focusAfter: string | undefined;
const now = h('section', { className: 'now' });
const feedback = h('div', { className: 'feedback', hidden: true });
const editor = new ConfigEditor(config, () => {
  config = editor.value;
  if (followEffective) selected = effectiveScope();
  render();
  void refreshStatus();
}, () => {
  feedback.hidden = editor.state === 'idle';
  replaceKeepingFocus(feedback, [saveNotice(editor)], document.activeElement?.id === 'retry-save' && editor.state !== 'error' ? `mode-${config.mode}` : undefined);
  void refreshStatus();
});

const scopeRule = (): Rule | undefined => config.rules.find((r) => r.match === selected.match && normalizePattern(r.pattern) === selected.pattern);
async function setSite(action: 'include' | 'exclude', timezone?: string) {
  if (rulePatternError(selected.pattern, selected.match)) return;
  await editor.update(upsertRule(config, { enabled: true, pattern: selected.pattern, match: selected.match, action,
    timezone: action === 'include' && timezone !== config.timezone ? timezone : undefined }));
}

const timeIn = (tz: string, at = new Date()) => new Intl.DateTimeFormat('en-GB', {
  timeZone: tz, hour: '2-digit', minute: '2-digit',
}).format(at);
let shownZone = systemTimezone();
let statusKey = '';
let statusRequest = 0;
let actionError = '';
/** This tab's temporary override as last reported by the background; the section below follows it. */
let temporary: string | null = null;

function tick() {
  const at = new Date();
  const time = now.querySelector('.now-time');
  const date = now.querySelector('.now-date');
  const difference = now.querySelector('.now-difference');
  if (time) time.textContent = timeIn(shownZone, at);
  if (date) {
    date.textContent = new Intl.DateTimeFormat(intlLocale(), { timeZone: shownZone, month: 'numeric', day: 'numeric', weekday: 'short' }).format(at);
    (date as HTMLElement).title = dateLabel(shownZone, at);
  }
  if (difference) {
    const days = dayDifference(shownZone, systemTimezone(), at);
    const hours = timeDifference(shownZone, systemTimezone(), at);
    difference.textContent = days ? t('withDetail', days, hours) : t('timeDiff', hours);
  }
}

async function retryApply() {
  if (tab?.id === undefined) return;
  actionError = '';
  try {
    const res = await sendRequest<{ error?: string } | null>({ type: 'retry', tabId: tab.id });
    if (res?.error) actionError = res.error;
  } catch { actionError = t('popupBackendRetry'); }
  statusKey = '';
  await refreshStatus();
  (document.getElementById('retry-apply') ?? document.getElementById('site-scope') ?? document.getElementById(`mode-${config.mode}`))?.focus();
}

async function setTemporary(timezone: string | null) {
  if (tab?.id === undefined) return;
  actionError = '';
  try {
    const res = await sendRequest<{ error?: string } | null>({ type: 'setTemporary', tabId: tab.id, timezone });
    if (res?.error) actionError = res.error;
  } catch { actionError = t('popupBackendRetry'); }
  // Ending removes the focused button, so keep the keyboard on the picker that replaces it.
  if (timezone === null) focusAfter = 'temp-tz';
  statusKey = '';
  await refreshStatus();
  focusAfter = undefined;
}

function errorHelp(): string {
  return t('errHelpGeneric');
}

function nowView(state: HTMLElement | null, explanation: string, error: string | undefined): HTMLElement[] {
  return ([
    h('div', { className: 'now-top' }, h('div', { className: 'now-host', title: host ?? '' }, host ?? ''), state),
    h('div', { className: 'now-clock' }, h('div', { className: 'now-time', ariaLabel: t('localTimeLabel') }),
      h('div', { className: 'now-location' }, h('div', { className: 'now-city', title: shownZone }, cityLabel(shownZone)),
        h('div', { className: 'now-offset' }, offsetLabel(shownZone)))),
    h('div', { className: 'now-calendar' }, h('div', { className: 'now-date' }), h('div', { className: 'now-difference' })),
    explanation ? h('p', { className: 'now-rule' }, explanation) : null,
    error ? h('details', {}, h('summary', {}, t('techDetails')), h('p', { className: 'error-details' }, error)) : null,
  ] as (HTMLElement | null)[]).filter((el): el is HTMLElement => el !== null);
}

/** Shown until the first status arrives, so a slow page never leaves the clock blank. */
function pendingStatus() {
  if (tab?.id === undefined || !host || statusKey) return;
  shownZone = (tabUrl ? resolveTimezone(tabUrl, config)?.timezone : undefined) ?? systemTimezone();
  now.className = 'now is-system';
  replaceKeepingFocus(now, nowView(null, '', undefined));
  tick();
}

let statusInFlight = false;
async function pollStatus() {
  // Polling never supersedes a pending request; otherwise a >1s response would be discarded forever.
  if (statusInFlight) return tick();
  statusInFlight = true;
  try { await refreshStatus(); } finally { statusInFlight = false; }
}

async function refreshStatus() {
  if (tab?.id === undefined || !host) {
    now.className = 'now is-system';
    now.replaceChildren(h('p', { className: 'now-empty' }, t('popupUnsupported')));
    return;
  }
  const request = ++statusRequest;
  const res = await sendRequest<TabStatus | { error: string } | undefined>({ type: 'getStatus', tabId: tab.id })
    .catch(() => undefined) ?? { error: t('popupBackendUnreachable') };
  if (request !== statusRequest) return;
  const known = 'applied' in res;
  const override = known ? res.temporary ?? null : temporary;
  const desired = override ?? (tabUrl ? resolveTimezone(tabUrl, config)?.timezone ?? null : null);
  shownZone = (known && res.applied) || systemTimezone();
  const effective = config.mode === 'rules' ? ruleForHost(host, config.rules) : undefined;
  const error = actionError || res.error;
  const applied = known && editor.state !== 'error' && !!res.applied && res.applied === desired && !error;
  const label = t(!known ? 'statusUnknown' : editor.state === 'error' ? 'statusUnsaved' : error ? 'statusFailed' : applied ? (override ? 'statusTemporary' : 'statusApplied') : res.applied !== desired ? 'statusApplying' : 'statusSystem');
  const key = JSON.stringify([bundleLocale(), label, shownZone, effective, error, config.mode, override]);
  if (override !== temporary) {
    temporary = override;
    render();
  }
  if (key !== statusKey) {
    statusKey = key;
    now.className = `now${applied ? '' : ' is-system'}`;
    const state = h('div', { className: 'now-status', role: 'status', ariaLive: 'polite' },
      h('span', { className: `state ${error || !known ? 'err' : applied ? 'ok' : 'muted'}` }, label),
      !known || error
        ? h('button', { id: 'retry-apply', className: 'link', textContent: t('actionRetry'), onclick: () => void retryApply() }) : null);
    const explanation = !known ? t('explainUnknown')
      : editor.state === 'error' ? t('explainUnsaved')
      : error ? (res.applied ? t('explainStillZone', cityLabel(shownZone), errorHelp()) : t('explainStillSystem', errorHelp()))
      : applied && override ? t('explainTemporary')
      : '';
    replaceKeepingFocus(now, nowView(state, explanation, error));
  }
  tick();
}

function siteControls(): HTMLElement | null {
  if (config.mode === 'off') return h('p', { className: 'hint' }, t('popupOffHint', modeLabel('rules'), modeLabel('global')));
  if (config.mode === 'global') return h('section', { className: 'block' },
    h('label', { className: 'block-label', htmlFor: 'global-tz' }, t('globalUse')),
    timezonePicker({ id: 'global-tz', label: t('globalTzLabel'), compact: true, value: config.timezone, onCommit: (timezone) => void editor.update({ ...config, timezone }) }));
  if (!host) return null;
  const rule = scopeRule();
  const effective = ruleForHost(host, config.rules);
  const scopes = siteScopes(host);
  if (!scopes.some((s) => s.pattern === selected.pattern && s.match === selected.match)) scopes.push(selected);
  const key = (s: SiteScope) => `${s.match}:${s.pattern}`;
  const select = h('select', { id: 'site-scope', ariaLabel: t('scopeSelectLabel'), onchange: () => {
    selected = scopes.find((s) => key(s) === select.value)!;
    followEffective = false;
    render();
  } }, ...scopes.map((s) => h('option', { value: key(s), textContent: s.match === 'suffix' ? t('scopeOptionSuffix', s.pattern) : t('scopeExact', s.pattern) })));
  select.value = key(selected);
  select.title = scopeLabel(selected);
  const warning = rulePatternError(selected.pattern, selected.match);
  const blocked = effective?.action === 'exclude' && effective.id !== rule?.id;
  const overridden = effective && effective.id !== rule?.id;
  // "Use system timezone" only matters when another rule would still change this site.
  const fallback = tabUrl ? resolveTimezone(tabUrl, { ...config, rules: config.rules.filter((r) => r.id !== rule?.id) }) : null;
  return h('section', { className: 'block' },
    h('label', { className: 'block-label', htmlFor: 'site-tz' }, t(rule?.action === 'exclude' ? 'siteTzExcluded' : rule ? (rule.enabled ? 'siteTz' : 'siteTzDisabled') : 'siteTzNew')),
    warning ? null : timezonePicker({ id: 'site-tz', label: t('siteTz'), compact: true, value: rule?.action === 'include' ? rule.timezone ?? config.timezone : '',
      placeholder: t('siteTzPlaceholder'), onCommit: (tz) => void setSite('include', tz) }),
    h('div', { className: 'scope-row' }, h('label', { className: 'scope-label', htmlFor: 'site-scope' }, t('scopeField')), select),
    warning ? h('p', { className: 'warn', role: 'alert' }, t('warnBroadRule', warning)) : null,
    overridden ? h('p', { className: 'warn' }, blocked ? t('warnExcludedBy', effective.pattern) : t('warnOverriddenBy', scopeLabel(effective))) : null,
    overridden ? h('button', { id: 'edit-effective', className: 'link', textContent: t('editEffective'), onclick: () => { selected = effectiveScope(); followEffective = true; focusAfter = 'site-tz'; render(); } }) : null,
    rule && !rule.enabled && !warning ? h('button', { id: 'enable-site-rule', className: 'link', textContent: t('enableRule'), onclick: () => void editor.update({ ...config, rules: config.rules.map((r) => r.id === rule.id ? { ...r, enabled: true } : r) }) }) : null,
    rule || fallback ? h('div', { className: 'block-actions' },
      !warning && rule?.action !== 'exclude' && fallback ? h('button', { id: 'use-system', className: 'link', textContent: t('useSystem'), onclick: () => void setSite('exclude') }) : null,
      rule ? h('button', { id: 'remove-site-rule', className: 'link', textContent: t('removeRule'), title: fallback ? t('removeRuleTitleZone', cityLabel(fallback.timezone)) : t('removeRuleTitleSystem'), onclick: () => { followEffective = true; focusAfter = 'site-scope'; void editor.update({ ...config, rules: config.rules.filter((r) => r.id !== rule.id) }); } }) : null) : null);
}

/** Available in every mode: the override lives in this tab only and outranks config. */
function temporaryControls(): HTMLElement | null {
  if (!host) return null;
  return h('section', { className: 'block' },
    h('label', { className: 'block-label', htmlFor: 'temp-tz' }, t('tempUse')),
    timezonePicker({ id: 'temp-tz', label: t('tempTzLabel'), compact: true, value: temporary ?? '', placeholder: t('tempPlaceholder'),
      onCommit: (timezone) => void setTemporary(timezone) }),
    temporary ? h('p', { className: 'hint' }, t('tempHint')) : null,
    temporary ? h('div', { className: 'block-actions' },
      h('button', { id: 'temp-reload', className: 'link', textContent: t('tempReload'), onclick: () => { if (tab?.id !== undefined) void chrome.tabs.reload(tab.id); } }),
      h('button', { id: 'temp-clear', className: 'link', textContent: t('tempClear'), onclick: () => void setTemporary(null) })) : null);
}

function render() {
  setLanguage(config.language);
  localizeDocument('extName');
  replaceKeepingFocus(root, [modeSwitch(config.mode, (mode) => {
    followEffective = true;
    void editor.update({ ...config, mode });
  }), now, ...[siteControls(), temporaryControls()].filter((el): el is HTMLElement => el !== null),
    h('div', { className: 'popup-language' }, h('label', { htmlFor: 'popup-language' }, t('languageLabel')),
      languageSelect('popup-language', config.language, (language) => void editor.update({ ...config, language }))),
    h('footer', {}, h('button', { id: 'open-settings', className: 'link', textContent: t('openSettings'), onclick: () => chrome.runtime.openOptionsPage() }), feedback)], focusAfter);
  focusAfter = undefined;
}
onConfigChanged((next: Config) => editor.receive(next));
render();
feedback.replaceChildren(saveNotice(editor));
pendingStatus();
void pollStatus();
setInterval(() => void pollStatus(), 1000);
