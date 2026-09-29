import { type Config, type Rule, loadConfig, onConfigChanged } from '../shared/config';
import { hostnameOf, normalizePattern, resolveTimezone, ruleForHost } from '../shared/resolve';
import { cityLabel, dateLabel, dayDifference, isValidTimezone, offsetLabel, systemTimezone } from '../shared/timezone';
import { h, languageSelect, modeHint, modeSwitch, replaceKeepingFocus } from '../ui/dom';
import { timezonePicker } from '../ui/tzpicker';
import { icon } from '../ui/icons';
import { attachPopover } from '../ui/popover';
import { ConfigDraft } from '../shared/config-draft';
import { rulePatternError } from '../shared/domains';
import { localizeDocument, setLanguage, t } from '../shared/i18n';

localizeDocument('optionsTitle');
const root = document.getElementById('app')!;
let config = await loadConfig();
setLanguage(config.language);
let testUrl = '';
let addDraft = '';
let addSubdomains = false;
let addError = '';
let addMessage = '';
let focusAfter: string | undefined;
const patternDrafts = new Map<string, string>();
const ruleErrors = new Map<string, string>();
const actions = h('div', { className: 'save-bar' });
const editor = new ConfigDraft(config, () => { config = editor.value; render(); });
const hasPendingFields = () => patternDrafts.size > 0 || !!addDraft.trim();
const hasChanges = () => editor.dirty || hasPendingFields();
/** Last deleted rule, kept so the deletion can be undone. */
let undo: { rule: Rule; index: number } | null = null;
/** Rule to briefly highlight on the next render (just added, or already existed). */
let flashId: string | null = null;
let editingRuleId: string | null = null;
let rulesSaveBlocked = false;

function stage(next: Config) {
  editor.update(next);
}

function updateRule(id: string, patch: Partial<Rule>) {
  const rule = config.rules.find((r) => r.id === id)!;
  const next = { ...rule, ...patch };
  const pattern = normalizePattern(next.pattern);
  const error = rulePatternError(next.pattern, next.match) || (config.rules.some((r) => r.id !== id && r.match === next.match && normalizePattern(r.pattern) === pattern) ? t('ruleDuplicate') : '');
  if (error && ('pattern' in patch || 'match' in patch || patch.enabled === true)) { ruleErrors.set(id, error); render(); return; }
  if ('pattern' in patch) {
    ruleErrors.delete(id);
    patternDrafts.delete(id);
  } else if (!patternDrafts.has(id)) ruleErrors.delete(id);
  return stage({ ...config, rules: config.rules.map((r) => (r.id === id ? { ...r, ...patch, ...('pattern' in patch ? { pattern } : {}) } : r)) });
}

// ---- live clocks: every [data-tz] element shows the current time in that zone ----

const formatters = new Map<string, Intl.DateTimeFormat>();
function timeIn(tz: string, seconds: boolean): string {
  const key = `${tz}|${seconds}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}) });
    formatters.set(key, f);
  }
  return f.format(new Date());
}

function clock(tz: string, className: string, seconds = false): HTMLElement {
  const el = h('time', { className });
  el.dataset.tz = tz;
  if (seconds) el.dataset.seconds = '';
  el.textContent = offsetLabel(tz) ? timeIn(tz, seconds) : '--:--';
  return el;
}

function tick() {
  for (const el of root.querySelectorAll<HTMLElement>('[data-tz]')) {
    const tz = el.dataset.tz!;
    if (offsetLabel(tz)) el.textContent = timeIn(tz, 'seconds' in el.dataset);
  }
  const date = root.querySelector('.hero-date');
  if (date) date.textContent = [dateLabel(headerTimezone()), dayDifference(headerTimezone())].filter(Boolean).join(' · ');
}

// ---- header: explain what the displayed time means in the selected mode ----

const headerTimezone = () => config.mode === 'off' ? systemTimezone() : config.timezone;

function hero(): HTMLElement {
  const off = config.mode === 'off';
  const timezone = headerTimezone();
  return h(
    'header',
    { className: `hero${off ? ' is-off' : ''}` },
    h(
      'div',
      { className: 'hero-copy' },
      h('h1', {}, t('optionsTitle')),
      h('p', {}, t('optionsHeroHint', t('saveApply'))),
    ),
    h(
      'div',
      { className: 'hero-clock' },
      clock(timezone, 'big-clock'),
      h('div', { className: 'hero-purpose' }, t(off ? 'heroSystemTime' : config.mode === 'global' ? 'heroGlobalTime' : 'heroDefaultTime'),
        h('span', { className: 'pending-state', hidden: !hasChanges() }, t('settingsUnsaved'))),
      h('span', { className: 'hero-zone', title: timezone }, `${cityLabel(timezone)} · ${offsetLabel(timezone)}`),
      h('span', { className: 'hero-date' }, dateLabel(timezone)),
    ),
  );
}

function general(): HTMLElement {
  const timezoneLabel = t(config.mode === 'global' ? 'globalTzLabel' : 'defaultTz');
  return h(
    'section',
    { className: 'panel general' },
    h('h2', {}, t('generalTitle')),
    h(
      'div',
      { className: 'field' },
      h('span', { className: 'field-label' }, t('modeGroupLabel')),
      h('div', {}, modeSwitch(config.mode, (mode) => void stage({ ...config, mode })), h('p', { className: 'muted' }, modeHint(config.mode))),
    ),
    h(
      'div',
      { className: 'field' },
      h('label', { className: 'field-label', htmlFor: 'default-tz' }, timezoneLabel),
      h(
        'div',
        {},
        timezonePicker({ id: 'default-tz', label: timezoneLabel, value: config.timezone, compact: true, onCommit: (timezone) => void stage({ ...config, timezone }) }),
        h('p', { className: 'muted' }, t('defaultTzHint')),
      ),
    ),
    h('div', { className: 'field language-field' },
      h('label', { className: 'field-label', htmlFor: 'settings-language' }, t('languageLabel')),
      h('div', {}, languageSelect('settings-language', config.language, (language) => stage({ ...config, language })),
        h('p', { className: 'muted' }, t('languageSaveHint')))),
    retainedRules(),
    h('p', { className: 'muted' }, t('coverageNote')),
  );
}

// ---- rules ----

type Effect = 'default' | 'custom' | 'exclude';

const effectOf = (r: Rule): Effect => (r.action === 'exclude' ? 'exclude' : r.timezone ? 'custom' : 'default');

function ruleRow(rule: Rule): HTMLElement {
  const prefix = `rule-${rule.id}`;
  const effect = effectOf(rule);
  const tz = effect === 'exclude' ? systemTimezone() : rule.timezone || config.timezone;
  const commit = (patch: Partial<Rule>, focus = `${prefix}-zone`) => {
    focusAfter = focus;
    updateRule(rule.id, patch);
  };

  const scope = h('button', {
    id: `${prefix}-scope`, type: 'button', className: 'scope-trigger',
    ariaLabel: t('ruleScopeLabel', rule.pattern),
  }, t(rule.match === 'suffix' ? 'includeSubdomains' : 'scopeExactShort'), icon('caret'));
  const scopePopup = h('div', { id: `${prefix}-scope-popup`, className: 'rule-popover scope-popover' },
    ...(['exact', 'suffix'] as const).map((match) => h('button', {
      id: `${prefix}-scope-${match}`, type: 'button', className: 'scope-option',
      ariaPressed: String(rule.match === match),
      onclick: () => commit({ match }, scope.id),
    }, h('span', {}, h('strong', {}, t(match === 'exact' ? 'scopeExactOption' : 'scopeSuffixOption')),
      h('small', {}, t(match === 'exact' ? 'scopeExactExample' : 'scopeSuffixExample', rule.pattern))),
      rule.match === match ? icon('check') : null)));
  attachPopover(scope, scopePopup);

  const zone = h('button', {
    id: `${prefix}-zone`, type: 'button', className: `zone-trigger${effect === 'exclude' ? ' system-zone' : ''}`,
    ariaLabel: t('ruleEffectLabel', rule.pattern), title: tz,
  }, h('span', { className: 'zone-label' }, effect === 'exclude' ? t('useSystem') : cityLabel(tz)),
    h('span', { className: 'zone-offset' }, offsetLabel(tz)), icon('caret'));
  const zonePopup = h('div', { id: `${prefix}-zone-popup`, className: 'rule-popover zone-popover' },
    h('div', { className: 'zone-presets' },
      h('button', { id: `${prefix}-default`, type: 'button', ariaPressed: String(effect === 'default'), onclick: () => commit({ action: 'include', timezone: undefined }) }, icon('globe'), h('span', {}, t('effectDefault'), h('small', {}, `${cityLabel(config.timezone)} · ${offsetLabel(config.timezone)}`)), effect === 'default' ? icon('check') : null),
      h('button', { id: `${prefix}-system`, type: 'button', ariaPressed: String(effect === 'exclude'), title: t('excludeTitle'), onclick: () => commit({ action: 'exclude', timezone: undefined }) }, icon('monitor'), h('span', {}, t('useSystem'), h('small', {}, `${cityLabel(systemTimezone())} · ${offsetLabel(systemTimezone())}`)), effect === 'exclude' ? icon('check') : null)),
    timezonePicker({ id: `${prefix}-tz`, label: t('ruleCustomTzLabel', rule.pattern), value: '', compact: true, suggestions: [tz, 'Asia/Tokyo', systemTimezone()], selected: effect === 'custom' ? tz : undefined, commitHint: t('pickerDraftHelp'),
      onCommit: (timezone) => commit({ action: 'include', timezone }) }));
  attachPopover(zone, zonePopup, `${prefix}-tz`);

  const edit = h('button', { id: `${prefix}-edit`, type: 'button', className: 'edit-trigger', textContent: t('editRule'), ariaLabel: t('ruleEditLabel', rule.pattern), onclick: () => { editingRuleId = rule.id; } });
  const pattern = h('input', {
    className: 'pattern', id: `${prefix}-pattern`, value: patternDrafts.get(rule.id) ?? rule.pattern,
    spellcheck: false, ariaLabel: t('ruleDomainLabel', rule.pattern),
    ariaInvalid: String(ruleErrors.has(rule.id) || !!rulePatternError(rule.pattern, rule.match)),
    oninput: () => { patternDrafts.set(rule.id, pattern.value); pattern.ariaInvalid = 'false'; renderActions(); },
  });
  pattern.setAttribute('aria-describedby', `${prefix}-error`);
  const editPopup = h('div', { id: `${prefix}-edit-popup`, className: 'rule-popover edit-popover' },
    h('form', { onsubmit: (event: SubmitEvent) => {
      event.preventDefault();
      const raw = pattern.value;
      const normalized = normalizePattern(raw);
      const error = rulePatternError(raw, rule.match) || (config.rules.some((r) => r.id !== rule.id && r.match === rule.match && normalizePattern(r.pattern) === normalized) ? t('ruleDuplicate') : '');
      if (error) { ruleErrors.set(rule.id, error); editingRuleId = rule.id; focusAfter = pattern.id; render(); return; }
      editingRuleId = null;
      commit({ pattern: raw }, edit.id);
    } }, h('label', { htmlFor: pattern.id }, t('colSite')), pattern,
      h('p', { className: 'field-error', id: `${prefix}-error`, role: 'alert' }, ruleErrors.get(rule.id) || rulePatternError(rule.pattern, rule.match)),
      h('button', { id: `${prefix}-edit-done`, type: 'submit', className: 'primary', textContent: t('editDone') })));
  attachPopover(edit, editPopup, pattern.id);
  editPopup.addEventListener('toggle', (event) => {
    if ((event as ToggleEvent).newState === 'closed' && editPopup.isConnected && editingRuleId === rule.id) editingRuleId = null;
  });

  const more = h('button', { id: `${prefix}-more`, type: 'button', className: 'more-trigger', ariaLabel: t('ruleMoreLabel', rule.pattern) }, icon('more'));
  const morePopup = h('div', { id: `${prefix}-more-popup`, className: 'rule-popover more-popover' },
    h('button', {
      className: 'remove', id: `${prefix}-remove`, type: 'button', ariaLabel: t('deleteLabel', rule.pattern),
      onclick: () => {
        undo = { rule, index: config.rules.indexOf(rule) };
        patternDrafts.delete(rule.id);
        ruleErrors.delete(rule.id);
        if (editingRuleId === rule.id) editingRuleId = null;
        focusAfter = 'undo-delete';
        stage({ ...config, rules: config.rules.filter((r) => r.id !== rule.id) });
      },
    }, icon('trash'), t('delete')));
  attachPopover(more, morePopup);

  const row = h('li', { className: `rule is-${effect}${rule.enabled ? '' : ' is-disabled'}${rule.id === flashId ? ' flash' : ''}` },
    h('input', { type: 'checkbox', role: 'switch', className: 'enabled', id: `${prefix}-enabled`, checked: rule.enabled,
      ariaLabel: t('ruleEnableLabel', rule.pattern), title: t(rule.enabled ? 'ruleEnabledTitle' : 'ruleDisabledTitle'),
      onchange: (event) => commit({ enabled: (event.target as HTMLInputElement).checked }, `${prefix}-enabled`) }),
    h('div', { className: 'rule-site' }, h('strong', { className: 'domain-name', title: rule.pattern }, rule.pattern), scope,
      ruleErrors.has(rule.id) && editingRuleId !== rule.id ? h('p', { className: 'field-error', role: 'alert' }, ruleErrors.get(rule.id)) : null),
    h('div', { className: 'rule-effect' }, zone,
      effect === 'default' ? h('span', { className: 'zone-source' }, t('effectDefault')) : null),
    clock(tz, 'rule-time'), h('div', { className: 'rule-actions' }, edit, more),
    scopePopup, zonePopup, editPopup, morePopup);
  row.dataset.id = rule.id;
  return row;
}

function addForm(): HTMLElement {
  const input = h('input', {
    id: 'add-site', value: addDraft, ariaLabel: t('addSiteLabel'),
    placeholder: t('addSitePlaceholder'), spellcheck: false,
    ariaInvalid: String(!!addError),
    oninput: () => { addDraft = input.value; addError = ''; addMessage = ''; input.ariaInvalid = 'false'; input.classList.remove('invalid'); error.textContent = ''; renderActions(); },
  });
  input.classList.toggle('invalid', !!addError);
  input.setAttribute('aria-describedby', 'add-site-error');
  const error = h('p', { id: 'add-site-error', className: 'field-error', role: 'alert' }, addError);
  return h('form', { className: 'add-form', onsubmit: (e: SubmitEvent) => {
    e.preventDefault();
    const match = addSubdomains ? 'suffix' : 'exact';
    addError = rulePatternError(input.value, match);
    if (addError) { focusAfter = 'add-site'; return render(); }
    const pattern = normalizePattern(input.value);
    const existing = config.rules.find((r) => r.match === match && normalizePattern(r.pattern) === pattern);
    if (existing) { addMessage = t('addExists', pattern); flashId = existing.id; focusAfter = `rule-${existing.id}-edit`; return render(); }
    undo = null;
    const rule: Rule = { id: crypto.randomUUID(), enabled: true, action: 'include', match, pattern };
    flashId = rule.id;
    addDraft = '';
    addMessage = t(match === 'exact' ? 'addedDraftExact' : 'addedDraftSuffix', pattern);
    void stage({ ...config, rules: [...config.rules, rule] });
  } }, h('div', { className: 'add' }, input, h('button', { id: 'add-site-submit', type: 'submit', className: 'primary', textContent: t('addSite') })),
    h('label', { className: 'subdomains' }, h('input', { id: 'add-subdomains', type: 'checkbox', checked: addSubdomains, onchange: (e) => { addSubdomains = (e.target as HTMLInputElement).checked; } }), t('addSubdomains')),
    error, h('p', { className: 'muted', role: 'status' }, addMessage));
}

function retainedRules(): HTMLElement | null {
  if (config.mode === 'rules') return null;
  return h('div', { className: 'mode-summary' },
    h('p', { className: 'muted' }, t(config.mode === 'global' ? 'rulesRetainedGlobal' : 'rulesRetainedOff')),
    h('div', { className: 'mode-summary-actions' },
      h('button', { id: 'activate-rules', textContent: t('manageRules'), onclick: () => {
        rulesSaveBlocked = false;
        editingRuleId = patternDrafts.keys().next().value ?? null;
        focusAfter = addDraft.trim() ? 'add-site' : editingRuleId ? `rule-${editingRuleId}-pattern` : 'mode-rules';
        stage({ ...config, mode: 'rules' });
      } }),
      hasPendingFields() ? h('button', { id: 'discard-rule-inputs', textContent: t('discardRuleInputs'), onclick: () => {
        patternDrafts.clear();
        ruleErrors.clear();
        addDraft = addError = addMessage = '';
        addSubdomains = false;
        editingRuleId = null;
        rulesSaveBlocked = false;
        focusAfter = 'activate-rules';
        render();
      } }) : null),
    hasPendingFields() ? h('p', { className: 'warn', role: rulesSaveBlocked ? 'alert' : 'status' }, t('rulesPendingInputs')) : null);
}

function undoBar(): HTMLElement | null {
  if (!undo) return null;
  const { rule, index } = undo;
  return h(
    'div',
    { className: 'undo', role: 'status' },
    h('span', {}, t('pendingDelete', rule.pattern)),
    h('button', {
      id: 'undo-delete',
      textContent: t('undo'),
      onclick: () => {
        undo = null;
        focusAfter = `rule-${rule.id}-enabled`;
        flashId = rule.id;
        void stage({ ...config, rules: config.rules.toSpliced(Math.min(index, config.rules.length), 0, rule) });
      },
    }),
  );
}

function rulesSection(): HTMLElement {
  return h(
    'section',
    { className: 'panel rules' },
    h(
      'div',
      { className: 'panel-head' },
      h('h2', {}, t('rulesTitle')),
      h('p', { className: 'muted' }, t('rulesHint')),
    ),
    addForm(),
    config.rules.length
      ? h('div', { className: 'rules-table' }, h('div', { className: 'rule-columns', ariaHidden: 'true' }, h('span', { className: 'column-enabled' }, t('colEnabled')), h('span', {}, t('colSite')), h('span', {}, t('colTimezone')), h('span', {}, t('colLocalTime')), h('span')), h('ul', { className: 'rule-list' }, ...config.rules.map(ruleRow)))
      : h('p', { className: 'empty' }, t('rulesEmpty')),
    undoBar(),
  );
}

// ---- tester ----

const testerResult = h('p', { className: 'tester-result', ariaLive: 'polite' });

function verdict(): { text: string; tone: 'ok' | 'muted' | 'warn'; ruleId?: string } | null {
  if (!testUrl) return null;
  const url = /^[a-z][\w+.-]*:\/\//i.test(testUrl) ? testUrl : `https://${testUrl}`;
  const host = normalizePattern(testUrl) ? hostnameOf(url) : null;
  if (!host) return { text: t('testerOnlyHttp'), tone: 'warn' };
  if (config.mode === 'off') return { text: t('testerOff'), tone: 'muted' };
  const res = resolveTimezone(url, config);
  const zone = res ? t('withDetail', res.timezone, offsetLabel(res.timezone)) : '';
  if (config.mode === 'global') return { text: t('testerGlobal', zone), tone: 'ok' };
  if (res?.rule) return { text: t('testerRule', zone, res.rule.pattern), tone: 'ok', ruleId: res.rule.id };
  const matched = ruleForHost(host, config.rules);
  const excluded = matched?.action === 'exclude' ? matched : undefined;
  if (excluded) return { text: t('testerExcluded', excluded.pattern), tone: 'muted', ruleId: excluded.id };
  return { text: t('testerNoMatch', host), tone: 'muted' };
}

function renderTester() {
  const v = verdict();
  testerResult.className = `tester-result ${v?.tone ?? 'muted'}`;
  testerResult.textContent = v?.text ?? t('testerIdle');
  for (const row of root.querySelectorAll<HTMLElement>('.rule')) row.classList.toggle('is-hit', row.dataset.id === v?.ruleId);
}

function testerSection(): HTMLElement {
  const input = h('input', {
    id: 'tester',
    value: testUrl,
    placeholder: 'mail.google.com',
    spellcheck: false,
    oninput: () => {
      testUrl = input.value.trim();
      renderTester();
    },
  });
  return h(
    'section',
    { className: 'panel tester' },
    h('label', { className: 'field-label', htmlFor: 'tester' }, t('testerLabel')),
    h('div', {}, input, testerResult),
  );
}

function discard() {
  if (editor.state === 'saving') return;
  patternDrafts.clear();
  ruleErrors.clear();
  addDraft = addError = addMessage = '';
  addSubdomains = false;
  undo = null;
  editingRuleId = null;
  rulesSaveBlocked = false;
  focusAfter = `mode-${editor.value.mode}`;
  editor.reset();
}

async function saveSettings(overwrite = false) {
  if (editor.state === 'saving') return;
  // Inactive saved rules must not block changing the global mode. Unfinished
  // text fields stay local, with visible actions rather than hidden validation.
  if (config.mode !== 'rules') {
    if (hasPendingFields()) {
      rulesSaveBlocked = true;
      focusAfter = 'activate-rules';
      return render();
    }
    await editor.save(overwrite);
    return;
  }
  if (addDraft.trim()) {
    addError = t('addPendingError', t('addSite'));
    focusAfter = 'add-site';
    return render();
  }
  ruleErrors.clear();
  const seen = new Set<string>();
  const rules = config.rules.map((rule) => {
    const raw = patternDrafts.get(rule.id) ?? rule.pattern;
    const pattern = normalizePattern(raw);
    const key = `${rule.match}:${pattern}`;
    const error = (rule.enabled || patternDrafts.has(rule.id) ? rulePatternError(raw, rule.match) : '')
      || (seen.has(key) ? t('ruleDuplicateMerge') : '')
      || (rule.enabled && rule.action === 'include' && !isValidTimezone(rule.timezone ?? config.timezone) ? t('ruleInvalidTz') : '');
    if (error) ruleErrors.set(rule.id, error);
    seen.add(key);
    return { ...rule, pattern: pattern || rule.pattern };
  });
  if (ruleErrors.size) {
    editingRuleId = ruleErrors.keys().next().value!;
    focusAfter = `rule-${editingRuleId}-pattern`;
    return render();
  }
  patternDrafts.clear();
  editor.update({ ...config, rules });
  await editor.save(overwrite);
}

function renderActions() {
  const saving = editor.state === 'saving';
  const dirty = hasChanges();
  const pending = root.querySelector<HTMLElement>('.pending-state');
  if (pending) pending.hidden = !dirty;
  const message = t(saving ? 'saveApplying' : editor.conflict ? 'saveConflict'
    : editor.state === 'error' ? 'saveFailedDraft'
    : dirty ? 'saveDirty'
    : editor.state === 'saved' ? 'saveAppliedDone' : 'saveClean');
  replaceKeepingFocus(actions, [
    h('p', { className: `save-message ${editor.state === 'error' ? 'err' : editor.conflict ? 'warn' : 'muted'}`, role: 'status', ariaLive: 'polite' }, message),
    h('div', { className: 'save-buttons' },
      h('button', { id: 'discard-settings', textContent: t(editor.conflict ? 'loadLatest' : 'discardChanges'), disabled: saving || (!dirty && !editor.conflict), onclick: discard }),
      editor.conflict ? h('button', { id: 'overwrite-settings', textContent: t('overwriteSave'), disabled: saving, onclick: () => void saveSettings(true) }) : null,
      h('button', { id: 'save-settings', className: 'primary', textContent: t(saving ? 'savingShort' : editor.state === 'error' ? 'saveRetry' : 'saveApply'), disabled: saving || !dirty || editor.conflict, onclick: () => void saveSettings() })),
  ]);
}

function render() {
  // Language changes join the explicit transaction, including discard and failed saves.
  if (!editor.dirty && !hasPendingFields()) setLanguage(config.language);
  localizeDocument('optionsTitle');
  replaceKeepingFocus(root, [hero(), h('fieldset', { className: 'settings-fields', disabled: editor.state === 'saving', ariaLabel: t('pendingSettingsLabel') }, general(),
    ...(config.mode === 'rules' ? [rulesSection(), testerSection()] : [])), actions], focusAfter);
  renderActions();
  focusAfter = undefined;
  renderTester();
  flashId = null;
  if (editingRuleId && config.mode === 'rules') {
    const popup = document.getElementById(`rule-${editingRuleId}-edit-popup`);
    popup?.showPopover();
    document.getElementById(`rule-${editingRuleId}-pattern`)?.focus();
  }
}

onConfigChanged((next) => editor.receive(next, hasPendingFields()));
window.addEventListener('beforeunload', (event) => {
  if (hasChanges() || editor.state === 'saving') { event.preventDefault(); event.returnValue = ''; }
});

render();

setInterval(tick, 1000);
