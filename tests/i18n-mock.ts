import en from '../public/_locales/en/messages.json';
import zh from '../public/_locales/zh_CN/messages.json';
import ja from '../public/_locales/ja/messages.json';
import ko from '../public/_locales/ko/messages.json';

const catalogs: Record<string, Record<string, { message: string }>> = { en, zh_CN: zh, ja, ko };

export function localeI18n(locale: string, uiLanguage = locale.replace('_', '-')) {
  const catalog = catalogs[locale] ?? catalogs.en!;
  return {
    getUILanguage: () => uiLanguage,
    getMessage: (key: string, substitutions: string[] = []) =>
      (catalog[key]?.message ?? catalogs.en![key]?.message ?? '').replace(/\$\$|\$([1-9])/g, (token: string, n: string) => n ? substitutions[Number(n) - 1] ?? '' : token.slice(1)),
  };
}
export const chineseI18n = localeI18n('zh_CN');
