import type { Mode } from '../shared/config';
import type { ConfigEditor } from '../shared/editor';
import { type Language, type MessageKey, parseLanguage, t } from '../shared/i18n';

type Child = Node | string | null | undefined | false;
type Props<K extends keyof HTMLElementTagNameMap> = Partial<Omit<HTMLElementTagNameMap[K], 'style'>> & {
  style?: string;
};

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props<K> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  const { style, ...rest } = props;
  Object.assign(el, rest);
  if (style) el.setAttribute('style', style);
  el.append(...children.filter((c): c is Node | string => !!c));
  return el;
}

const MODE_LABELS: Record<Mode, MessageKey> = { off: 'modeOff', global: 'modeGlobal', rules: 'modeRules' };
export const modeLabel = (mode: Mode): string => t(MODE_LABELS[mode]);

export function languageSelect(id: string, value: Language | undefined, onChange: (language: Language) => void): HTMLSelectElement {
  const labels: Record<Language, MessageKey> = {
    auto: 'languageAuto', en: 'languageEnglish', zh_CN: 'languageChinese', ja: 'languageJapanese', ko: 'languageKorean',
  };
  const select = h('select', { id, className: 'language-select', ariaLabel: t('languageLabel'), onchange: () => onChange(parseLanguage(select.value)) },
    ...(Object.keys(labels) as Language[]).map((language) => h('option', { value: language }, t(labels[language]))));
  select.value = value ?? 'auto';
  return select;
}

export function modeSwitch(mode: Mode, onChange: (mode: Mode) => void): HTMLElement {
  return h(
    'div',
    { className: 'segmented', role: 'group', ariaLabel: t('modeGroupLabel') },
    ...(Object.keys(MODE_LABELS) as Mode[]).map((m) =>
      h('button', {
        id: `mode-${m}`,
        type: 'button',
        ariaPressed: String(m === mode),
        className: m === mode ? 'active' : '',
        textContent: modeLabel(m),
        onclick: () => m !== mode && onChange(m),
      }),
    ),
  );
}

/** Stable control IDs keep keyboard position across a config rerender. */
export function replaceKeepingFocus(root: HTMLElement, children: Node[], fallbackId?: string): void {
  const active = document.activeElement;
  const id = fallbackId ?? (active instanceof HTMLElement ? active.id : '');
  const selection = active instanceof HTMLInputElement && active.type === 'text'
    ? [active.selectionStart, active.selectionEnd, active.value] as const : null;
  root.replaceChildren(...children);
  const next = id ? document.getElementById(id) : null;
  if (next) {
    next.dataset.restoringFocus = 'true';
    next.focus({ preventScroll: true });
    delete next.dataset.restoringFocus;
    if (selection && next instanceof HTMLInputElement && next.value === selection[2])
      next.setSelectionRange(selection[0], selection[1]);
  }
}

export function saveNotice(editor: ConfigEditor): HTMLElement {
  return h('div', { className: `save-notice ${editor.state === 'error' ? 'err' : 'muted'}`, role: 'status', ariaLive: 'polite' },
    t(editor.state === 'saving' ? 'saveSaving' : editor.state === 'saved' ? 'saveSaved' : editor.state === 'error' ? 'saveError' : 'saveIdle'),
    editor.state === 'error' ? h('button', { id: 'retry-save', type: 'button', textContent: t('saveRetry'), onclick: () => void editor.retry() }) : null);
}
