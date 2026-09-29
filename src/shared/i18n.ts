import messages from '../../public/_locales/en/messages.json';
import chinese from '../../public/_locales/zh_CN/messages.json';
import japanese from '../../public/_locales/ja/messages.json';
import korean from '../../public/_locales/ko/messages.json';

/** `en` is the default locale, so its catalog defines the complete key set. */
export type MessageKey = keyof typeof messages;
export type Language = 'auto' | 'en' | 'zh_CN' | 'ja' | 'ko';
const catalogs = { en: messages, zh_CN: chinese, ja: japanese, ko: korean };
let language: Language = 'auto';

export function parseLanguage(value: unknown): Language {
  return value === 'en' || value === 'zh_CN' || value === 'ja' || value === 'ko' ? value : 'auto';
}

/** Changes only this context's UI. Persistence belongs to the config editor. */
export function setLanguage(value: Language = 'auto'): void {
  language = parseLanguage(value);
}

export function t(key: MessageKey, ...substitutions: (string | number)[]): string {
  if (language === 'auto') return chrome.i18n.getMessage(key, substitutions.map(String)) || key;
  return catalogs[language][key].message.replace(/\$\$|\$([1-9])/g,
    (_token, index: string | undefined) => index ? String(substitutions[Number(index) - 1] ?? '') : '$');
}

/**
 * Language of the catalog Chrome actually picked, which can differ from the UI language
 * (e.g. zh-TW falls back to en). Dates and city names follow it so they match the text.
 */
export const bundleLocale = (): string => t('locale');

export function intlLocale(): string {
  const bundle = bundleLocale();
  if (language !== 'auto') return bundle;
  const ui = chrome.i18n.getUILanguage();
  return ui.split('-')[0] === bundle.split('-')[0] ? ui : bundle;
}

/** Applies the catalog language to a page's static shell. */
export function localizeDocument(title: MessageKey): void {
  document.documentElement.lang = bundleLocale();
  document.title = t(title);
}
