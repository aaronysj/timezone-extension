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
  return rule ? { pattern: normalizePattern(rule.pattern), match: rule.match } : { pattern: host ?? '', match: 'exact' };
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
    const res = await sendRequest<{ error?: string } | null>({ type: 'resume', tabId: tab.id });
    if (res?.error) actionError = res.error;
  } catch { actionError = t('popupBackendRetry'); }
  statusKey = '';
  await refreshStatus();
  (document.getElementById('retry-apply') ?? document.getElementById('site-scope') ?? document.getElementById(`mode-${config.mode}`))?.focus();
}

function errorHelp(error: string): string {
  return t(/debugger|attached|调试|デバッガ|디버거/i.test(error) ? 'errHelpDebugger' : 'errHelpGeneric');
}

async function refreshStatus() {
  if (tab?.id === undefined || !host) {
    now.className = 'now is-system';
    now.replaceChildren(h('p', { className: 'now-empty' }, t('popupUnsupported')));
    return;
  }
  const request = ++statusRequest;
  const res = await sendRequest<TabStatus | { error: string }>({ type: 'getStatus', tabId: tab.id })
    .catch(() => ({ error: t('popupBackendUnreachable') }));
  if (request !== statusRequest) return;
  const known = 'applied' in res;
  const desired = tabUrl ? resolveTimezone(tabUrl, config)?.timezone ?? null : null;
  shownZone = (known && res.applied) || systemTimezone();
  const effective = config.mode === 'rules' ? ruleForHost(host, config.rules) : undefined;
  const error = actionError || res.error;
  const applied = known && editor.state !== 'error' && !!res.applied && res.applied === desired && !error && !res.suppressed;
  const label = t(!known ? 'statusUnknown' : editor.state === 'error' ? 'statusUnsaved' : res.suppressed ? 'statusPaused' : error ? 'statusFailed' : applied ? 'statusApplied' : res.applied !== desired ? 'statusApplying' : 'statusSystem');
  const key = JSON.stringify([bundleLocale(), label, shownZone, effective, error, config.mode]);
  if (key !== statusKey) {
    statusKey = key;
    now.className = `now${applied ? '' : ' is-system'}`;
    const state = h('div', { className: 'now-status', role: 'status', ariaLive: 'polite' },
      h('span', { className: `state ${error || !known ? 'err' : applied ? 'ok' : 'muted'}` }, label),
      !known || error || (known && res.suppressed)
        ? h('button', { id: 'retry-apply', className: 'link', textContent: t(known && res.suppressed ? 'actionResume' : 'actionRetry'), onclick: () => void retryApply() }) : null);
    const explanation = !known ? t('explainUnknown')
      : editor.state === 'error' ? t('explainUnsaved')
      : error ? (res.applied ? t('explainStillZone', cityLabel(shownZone), errorHelp(error)) : t('explainStillSystem', errorHelp(error)))
      : res.suppressed ? t('explainPaused')
      : '';
    replaceKeepingFocus(now, [
      h('div', { className: 'now-top' }, h('div', { className: 'now-host', title: host }, host), state),
      h('div', { className: 'now-clock' }, h('div', { className: 'now-time', ariaLabel: t('localTimeLabel') }),
        h('div', { className: 'now-location' }, h('div', { className: 'now-city', title: shownZone }, cityLabel(shownZone)),
          h('div', { className: 'now-offset' }, offsetLabel(shownZone)))),
      h('div', { className: 'now-calendar' }, h('div', { className: 'now-date' }), h('div', { className: 'now-difference' })),
      explanation ? h('p', { className: 'now-rule' }, explanation) : null,
      error ? h('details', {}, h('summary', {}, t('techDetails')), h('p', { className: 'error-details' }, error)) : null,
    ].filter((el) => el !== null));
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
  const without = rule && tabUrl ? resolveTimezone(tabUrl, { ...config, rules: config.rules.filter((r) => r.id !== rule.id) }) : null;
  return h('section', { className: 'block' },
    h('label', { className: 'block-label', htmlFor: 'site-scope' }, t('scopeField')), select,
    warning ? h('p', { className: 'warn', role: 'alert' }, t('warnBroadRule', warning)) : null,
    h('label', { className: 'block-label', htmlFor: 'site-tz' }, t(rule?.action === 'exclude' ? 'siteTzExcluded' : rule ? (rule.enabled ? 'siteTz' : 'siteTzDisabled') : 'siteTzNew')),
    warning ? null : timezonePicker({ id: 'site-tz', label: t('siteTz'), compact: true, value: rule?.action === 'include' ? rule.timezone ?? config.timezone : '',
      placeholder: t('siteTzPlaceholder'), onCommit: (tz) => void setSite('include', tz) }),
    overridden ? h('p', { className: 'warn' }, blocked ? t('warnExcludedBy', effective.pattern) : t('warnOverriddenBy', scopeLabel(effective))) : null,
    overridden ? h('button', { id: 'edit-effective', className: 'link', textContent: t('editEffective'), onclick: () => { selected = effectiveScope(); followEffective = true; focusAfter = 'site-tz'; render(); } }) : null,
    rule && !rule.enabled && !warning ? h('button', { id: 'enable-site-rule', className: 'link', textContent: t('enableRule'), onclick: () => void editor.update({ ...config, rules: config.rules.map((r) => r.id === rule.id ? { ...r, enabled: true } : r) }) }) : null,
    h('div', { className: 'block-actions' },
      rule && selected.pattern !== host ? h('button', { id: 'only-this-site', className: 'link', textContent: t('onlyThisSite'), onclick: () => { selected = { pattern: host, match: 'exact' }; followEffective = false; focusAfter = 'site-tz'; render(); } }) : null,
      !warning && rule?.action !== 'exclude' ? h('button', { id: 'use-system', className: 'link', textContent: t('useSystem'), onclick: () => void setSite('exclude') }) : null,
      rule ? h('button', { id: 'remove-site-rule', className: 'link', textContent: t('removeRule'), title: without ? t('removeRuleTitleZone', cityLabel(without.timezone)) : t('removeRuleTitleSystem'), onclick: () => { followEffective = true; focusAfter = 'site-scope'; void editor.update({ ...config, rules: config.rules.filter((r) => r.id !== rule.id) }); } }) : null));
}

function render() {
  setLanguage(config.language);
  localizeDocument('extName');
  replaceKeepingFocus(root, [modeSwitch(config.mode, (mode) => {
    followEffective = true;
    void editor.update({ ...config, mode });
  }), now, ...[siteControls()].filter((el): el is HTMLElement => el !== null),
    h('div', { className: 'popup-language' }, h('label', { htmlFor: 'popup-language' }, t('languageLabel')),
      languageSelect('popup-language', config.language, (language) => void editor.update({ ...config, language }))),
    h('footer', {}, h('button', { id: 'open-settings', className: 'link', textContent: t('openSettings'), onclick: () => chrome.runtime.openOptionsPage() }), feedback)], focusAfter);
  focusAfter = undefined;
}
onConfigChanged((next: Config) => editor.receive(next));
render();
feedback.replaceChildren(saveNotice(editor));
await refreshStatus();
setInterval(() => void refreshStatus(), 1000);
