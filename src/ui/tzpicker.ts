import { type ZoneInfo, cityLabel, isValidTimezone, offsetLabel, searchTimezones, systemTimezone } from '../shared/timezone';
import { t } from '../shared/i18n';
import { h } from './dom';

const clocks = new Map<string, Intl.DateTimeFormat>();
function timeIn(tz: string): string {
  let f = clocks.get(tz);
  if (!f) clocks.set(tz, (f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' })));
  return f.format(new Date());
}

let seq = 0;

/**
 * Searchable timezone combobox. Search by city, IANA id, localized name or offset ("+8").
 * onCommit only ever receives a valid IANA zone.
 */
export function timezonePicker(opts: {
  id?: string;
  /** '' shows the placeholder until a zone is picked. */
  value: string;
  placeholder?: string;
  label?: string;
  /** Keep the passive IANA identifier in the tooltip, with active guidance still visible. */
  compact?: boolean;
  /** Optional shortlist before the user starts searching. */
  suggestions?: string[];
  selected?: string;
  onCommit: (tz: string) => void;
}): HTMLElement {
  const listId = `tzp-${++seq}`;
  const helpId = `${listId}-help`;
  const system = systemTimezone();
  let value = opts.value;
  let results: ZoneInfo[] = [];
  let active = -1;

  const offset = h('span', { className: 'tzp-offset' }, offsetLabel(value));
  const list = h('ul', { className: 'tzp-list', id: listId, role: 'listbox', hidden: true });
  const input = h('input', {
    className: 'tzp-input',
    id: opts.id ?? '',
    value: value ? cityLabel(value) : '',
    ariaLabel: opts.label ?? t('pickerLabel'),
    spellcheck: false,
    autocomplete: 'off',
    placeholder: opts.placeholder ?? t('pickerPlaceholder'),
    role: 'combobox',
    ariaExpanded: 'false',
    ariaAutoComplete: 'list',
    title: t('pickerTitle'),
  });
  input.setAttribute('aria-controls', listId);
  input.setAttribute('aria-describedby', helpId);
  const help = h('p', { className: 'tzp-help', id: helpId, role: 'status' });

  function option(z: ZoneInfo, i: number): HTMLLIElement {
    const li = h(
      'li',
      {
        id: `${listId}-${i}`,
        role: 'option',
        className: `tzp-opt${z.id === (opts.selected ?? value) ? ' is-current' : ''}`,
        ariaSelected: String(z.id === (opts.selected ?? value)),
        onmousedown: (e) => e.preventDefault(),
        onclick: () => commit(z.id),
        onmousemove: () => i !== active && setActive(i, false),
      },
      h('span', { className: 'tzp-city' }, cityLabel(z.id), z.id === system ? h('em', {}, t('pickerThisDevice')) : null),
      h('span', { className: 'tzp-time' }, timeIn(z.id)),
      h('span', { className: 'tzp-id' }, z.region ? `${z.region}/${z.city.replace(/ /g, '_')}` : z.id, z.local ? `  ${z.local}` : ''),
      h('span', { className: 'tzp-off' }, z.offset),
    );
    return li;
  }

  function setActive(i: number, scroll = true) {
    list.children[active]?.classList.remove('is-active');
    active = i;
    const li = list.children[i] as HTMLElement | undefined;
    li?.classList.add('is-active');
    if (li) input.setAttribute('aria-activedescendant', li.id);
    else input.removeAttribute('aria-activedescendant');
    if (li && scroll) li.scrollIntoView({ block: 'nearest' });
  }

  function search(query: string) {
    results = searchTimezones(query);
    if (!query.trim() && opts.suggestions) {
      results = [...new Set(opts.suggestions)].flatMap((id) => results.find((z) => z.id === id) ?? []);
    } else if (!query.trim()) {
      // Pin the machine's own zone on top of the full list.
      const sys = results.find((z) => z.id === system);
      if (sys) results = [sys, ...results.filter((z) => z !== sys)];
    }
    list.replaceChildren(
      ...(results.length ? results.map(option) : [h('li', { className: 'tzp-empty' }, t('pickerNoMatch', query.trim()))]),
    );
    const current = query.trim() ? 0 : results.findIndex((z) => z.id === value);
    setActive(current >= 0 ? current : 0);
  }

  /** Shows the full list; the text is selected so typing replaces the current zone. */
  function open() {
    if (!list.hidden) return;
    list.hidden = false;
    input.ariaExpanded = 'true';
    wrap.classList.add('is-open');
    search('');
    input.placeholder = t('pickerPlaceholder');
    input.select();
    help.textContent = '';
  }

  function close() {
    list.hidden = true;
    input.ariaExpanded = 'false';
    wrap.classList.remove('is-open');
    input.removeAttribute('aria-activedescendant');
    input.value = value ? cityLabel(value) : '';
    input.placeholder = opts.placeholder ?? t('pickerPlaceholder');
    input.classList.remove('invalid');
    input.ariaInvalid = 'false';
    list.replaceChildren();
    help.textContent = opts.compact ? '' : value;
    input.title = value ? `${value} · ${t('pickerClickToSearch')}` : t('pickerClickToSearch');
  }

  function commit(tz: string) {
    const changed = tz !== value;
    value = tz;
    offset.textContent = offsetLabel(tz);
    close();
    if (changed) opts.onCommit(tz);
  }

  input.addEventListener('focus', () => { if (!input.dataset.restoringFocus) open(); });
  input.addEventListener('click', open);
  input.addEventListener('blur', () => {
    const abandoned = !list.hidden && input.value !== value && input.value !== cityLabel(value);
    close();
    if (abandoned) help.textContent = t('pickerAbandoned');
  });
  input.addEventListener('input', () => {
    list.hidden = false;
    input.ariaExpanded = 'true';
    wrap.classList.add('is-open');
    search(input.value);
  });
  input.addEventListener('keydown', (e) => {
    if (list.hidden) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        e.preventDefault();
        open();
      }
      return;
    }
    const last = results.length - 1;
    if (e.key === 'ArrowDown') setActive(Math.min(active + 1, last));
    else if (e.key === 'ArrowUp') setActive(Math.max(active - 1, 0));
    else if (e.key === 'PageDown') setActive(Math.min(active + 8, last));
    else if (e.key === 'PageUp') setActive(Math.max(active - 8, 0));
    else if (e.key === 'Escape') close();
    else if (e.key === 'Enter') {
      const typed = input.value.trim();
      const pick = results[active]?.id ?? (isValidTimezone(typed) ? typed : undefined);
      if (pick) commit(pick);
      else {
        input.classList.add('invalid');
        input.ariaInvalid = 'true';
        help.textContent = t('pickerInvalid');
      }
    } else return;
    e.preventDefault();
  });

  const wrap = h('div', { className: 'tzp' }, input, offset, list, help);
  help.textContent = opts.compact ? '' : value;
  if (value) input.title = `${value} · ${t('pickerClickToSearch')}`;
  return wrap;
}
