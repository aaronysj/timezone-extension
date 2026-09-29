import { type MessageKey, bundleLocale, intlLocale, t } from './i18n';

let cached: string[] | undefined;

export function listTimezones(): string[] {
  if (!cached) {
    const zones = new Set(Intl.supportedValuesOf('timeZone'));
    zones.add('UTC');
    cached = [...zones].sort();
  }
  return cached;
}

export function systemTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export function isValidTimezone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** e.g. "GMT+9", "GMT-4:30"; empty string if the zone is invalid. */
export function offsetLabel(tz: string, at = new Date()): string {
  if (!isValidTimezone(tz)) return '';
  const part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' })
    .formatToParts(at)
    .find((p) => p.type === 'timeZoneName');
  return part?.value ?? '';
}

/** "GMT+5:30" -> 330, "GMT" -> 0. */
function labelToMinutes(label: string): number {
  const m = /([+-])(\d{1,2})(?::(\d{2}))?/.exec(label);
  if (!m) return 0;
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0));
}

/** Signed local-clock difference at the same instant, including DST and fractional offsets. */
export function timeDifference(tz: string, reference = systemTimezone(), at = new Date()): string {
  const minutes = labelToMinutes(offsetLabel(tz, at)) - labelToMinutes(offsetLabel(reference, at));
  return `${minutes > 0 ? '+' : ''}${Number((minutes / 60).toFixed(4))}h`;
}

export function formatNow(tz: string, at = new Date()): string {
  return new Intl.DateTimeFormat(intlLocale(), {
    timeZone: tz,
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(at);
}

/**
 * Chinese names for commonly used zones; IANA ids have no localized city names in Intl.
 * Key order doubles as ranking among zones sharing an offset.
 */
const ZH_CITIES: Record<string, string> = {
  'Asia/Shanghai': '北京 上海 中国',
  'Asia/Hong_Kong': '香港',
  'Asia/Macau': '澳门',
  'Asia/Taipei': '台北 台湾',
  'Asia/Urumqi': '乌鲁木齐 新疆',
  'Asia/Tokyo': '东京 日本',
  'Asia/Seoul': '首尔 韩国',
  'Asia/Singapore': '新加坡',
  'Asia/Kuala_Lumpur': '吉隆坡 马来西亚',
  'Asia/Bangkok': '曼谷 泰国',
  'Asia/Ho_Chi_Minh': '胡志明 越南',
  'Asia/Saigon': '胡志明 越南',
  'Asia/Jakarta': '雅加达 印尼',
  'Asia/Manila': '马尼拉 菲律宾',
  'Asia/Kolkata': '印度 孟买 新德里',
  'Asia/Calcutta': '印度 孟买 新德里',
  'Asia/Dubai': '迪拜 阿联酋',
  'Asia/Riyadh': '利雅得 沙特',
  'Asia/Tehran': '德黑兰 伊朗',
  'Asia/Karachi': '卡拉奇 巴基斯坦',
  'Asia/Dhaka': '达卡 孟加拉',
  'Asia/Jerusalem': '耶路撒冷 以色列',
  'Europe/London': '伦敦 英国',
  'Europe/Paris': '巴黎 法国',
  'Europe/Berlin': '柏林 德国',
  'Europe/Madrid': '马德里 西班牙',
  'Europe/Rome': '罗马 意大利',
  'Europe/Amsterdam': '阿姆斯特丹 荷兰',
  'Europe/Zurich': '苏黎世 瑞士',
  'Europe/Stockholm': '斯德哥尔摩 瑞典',
  'Europe/Moscow': '莫斯科 俄罗斯',
  'Europe/Istanbul': '伊斯坦布尔 土耳其',
  'Europe/Kiev': '基辅 乌克兰',
  'Europe/Kyiv': '基辅 乌克兰',
  'America/New_York': '纽约 美东',
  'America/Chicago': '芝加哥 美中',
  'America/Denver': '丹佛 美山地',
  'America/Los_Angeles': '洛杉矶 旧金山 硅谷 美西',
  'America/Anchorage': '安克雷奇 阿拉斯加',
  'Pacific/Honolulu': '檀香山 夏威夷',
  'America/Toronto': '多伦多 加拿大',
  'America/Vancouver': '温哥华',
  'America/Mexico_City': '墨西哥城',
  'America/Sao_Paulo': '圣保罗 巴西',
  'America/Argentina/Buenos_Aires': '布宜诺斯艾利斯 阿根廷',
  'America/Buenos_Aires': '布宜诺斯艾利斯 阿根廷',
  'Africa/Cairo': '开罗 埃及',
  'Africa/Johannesburg': '约翰内斯堡 南非',
  'Africa/Lagos': '拉各斯 尼日利亚',
  'Africa/Nairobi': '内罗毕 肯尼亚',
  'Australia/Sydney': '悉尼 澳大利亚',
  'Australia/Melbourne': '墨尔本',
  'Australia/Perth': '珀斯',
  'Pacific/Auckland': '奥克兰 新西兰',
  UTC: '协调世界时 格林尼治',
};

const CITY_MESSAGES: Record<string, MessageKey> = {
  'Asia/Shanghai': 'cityShanghai',
  'Asia/Hong_Kong': 'cityHongKong',
  'Asia/Macau': 'cityMacau',
  'Asia/Taipei': 'cityTaipei',
  'Asia/Urumqi': 'cityUrumqi',
  'Asia/Tokyo': 'cityTokyo',
  'Asia/Seoul': 'citySeoul',
  'Asia/Singapore': 'citySingapore',
  'Asia/Kuala_Lumpur': 'cityKualaLumpur',
  'Asia/Bangkok': 'cityBangkok',
  'Asia/Ho_Chi_Minh': 'cityHoChiMinh',
  'Asia/Saigon': 'cityHoChiMinh',
  'Asia/Jakarta': 'cityJakarta',
  'Asia/Manila': 'cityManila',
  'Asia/Kolkata': 'cityKolkata',
  'Asia/Calcutta': 'cityKolkata',
  'Asia/Dubai': 'cityDubai',
  'Asia/Riyadh': 'cityRiyadh',
  'Asia/Tehran': 'cityTehran',
  'Asia/Karachi': 'cityKarachi',
  'Asia/Dhaka': 'cityDhaka',
  'Asia/Jerusalem': 'cityJerusalem',
  'Europe/London': 'cityLondon',
  'Europe/Paris': 'cityParis',
  'Europe/Berlin': 'cityBerlin',
  'Europe/Madrid': 'cityMadrid',
  'Europe/Rome': 'cityRome',
  'Europe/Amsterdam': 'cityAmsterdam',
  'Europe/Zurich': 'cityZurich',
  'Europe/Stockholm': 'cityStockholm',
  'Europe/Moscow': 'cityMoscow',
  'Europe/Istanbul': 'cityIstanbul',
  'Europe/Kiev': 'cityKyiv',
  'Europe/Kyiv': 'cityKyiv',
  'America/New_York': 'cityNewYork',
  'America/Chicago': 'cityChicago',
  'America/Denver': 'cityDenver',
  'America/Los_Angeles': 'cityLosAngeles',
  'America/Anchorage': 'cityAnchorage',
  'Pacific/Honolulu': 'cityHonolulu',
  'America/Toronto': 'cityToronto',
  'America/Vancouver': 'cityVancouver',
  'America/Mexico_City': 'cityMexicoCity',
  'America/Sao_Paulo': 'citySaoPaulo',
  'America/Argentina/Buenos_Aires': 'cityBuenosAires',
  'America/Buenos_Aires': 'cityBuenosAires',
  'Africa/Cairo': 'cityCairo',
  'Africa/Johannesburg': 'cityJohannesburg',
  'Africa/Lagos': 'cityLagos',
  'Africa/Nairobi': 'cityNairobi',
  'Australia/Sydney': 'citySydney',
  'Australia/Melbourne': 'cityMelbourne',
  'Australia/Perth': 'cityPerth',
  'Pacific/Auckland': 'cityAuckland',
  'UTC': 'cityUTC',
};

const chineseUi = () => bundleLocale().startsWith('zh');

export function cityLabel(tz: string): string {
  return CITY_MESSAGES[tz] ? t(CITY_MESSAGES[tz]) : tz.split('/').at(-1)!.replace(/_/g, ' ');
}

export function dateLabel(tz: string, at = new Date()): string {
  return new Intl.DateTimeFormat(intlLocale(), { timeZone: tz, year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' }).format(at);
}

/** Calendar-day difference, independent of DST or the machine's locale. */
export function dayDifference(tz: string, reference = systemTimezone(), at = new Date()): string {
  const day = (zone: string) => {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
    const part = (name: string) => Number(parts.find((p) => p.type === name)!.value);
    return Date.UTC(part('year'), part('month') - 1, part('day'));
  };
  const difference = (day(tz) - day(reference)) / 86_400_000;
  const days = Math.abs(difference);
  if (!days) return '';
  return difference > 0 ? (days === 1 ? t('dayLater') : t('dayLaterPlural', days)) : (days === 1 ? t('dayEarlier') : t('dayEarlierPlural', days));
}

export interface ZoneInfo {
  id: string;
  /** Last path segment, human readable: "Buenos Aires". */
  city: string;
  /** Everything before the city: "America/Argentina"; empty for "UTC". */
  region: string;
  /** Generic zone name in the UI language ("日本标准时间"), plus Chinese city aliases in a Chinese UI. */
  local: string;
  offset: string;
  minutes: number;
}

const compact = (s: string) => s.toLowerCase().replace(/[\s_\-/]/g, '');

let infos: { locale: string; at: number; list: (ZoneInfo & { keys: string })[] } | undefined;

/** Offsets change with DST, so the table is rebuilt at most once an hour. */
function zoneInfos(): (ZoneInfo & { keys: string })[] {
  const now = Date.now();
  const locale = intlLocale();
  if (infos && infos.locale === locale && now - infos.at >= 0 && now - infos.at < 3_600_000) return infos.list;
  const at = new Date(now);
  const chinese = chineseUi();
  const list = listTimezones().map((id) => {
    const parts = id.split('/');
    const offset = offsetLabel(id, at);
    const generic =
      new Intl.DateTimeFormat(locale, { timeZone: id, timeZoneName: 'longGeneric' })
        .formatToParts(at)
        .find((p) => p.type === 'timeZoneName')?.value ?? '';
    const name = /^GMT/.test(generic) ? '' : generic;
    const local = [chinese ? ZH_CITIES[id] : '', name].filter(Boolean).join(' ');
    return {
      id,
      city: parts.at(-1)!.replace(/_/g, ' '),
      region: parts.slice(0, -1).join('/'),
      local,
      offset,
      minutes: labelToMinutes(offset),
      // Chinese aliases stay searchable in every UI language.
      keys: compact(`${id} ${cityLabel(id)} ${local} ${ZH_CITIES[id] ?? ''}`),
    };
  });
  // Within an offset, well-known cities first so "+8" leads with Shanghai rather than Antarctica/Casey.
  const order = Object.keys(ZH_CITIES);
  const known = (id: string) => (order.includes(id) ? order.indexOf(id) : order.length);
  list.sort((a, b) => a.minutes - b.minutes || known(a.id) - known(b.id) || a.id.localeCompare(b.id));
  infos = { locale, at: now, list };
  return list;
}

const OFFSET_QUERY = /^(?:gmt|utc)?\s*([+-−])\s*(\d{1,2})(?::?(\d{2}))?$/i;

/**
 * Searches zones by IANA id, city (any spacing), localized or Chinese city/zone name, or UTC offset
 * ("+8", "GMT-5", "utc+5:30"). An empty query returns every zone ordered by offset.
 */
export function searchTimezones(query: string): ZoneInfo[] {
  const list = zoneInfos();
  const q = query.trim();
  if (!q) return list;

  const off = OFFSET_QUERY.exec(q);
  if (off) {
    const minutes = (off[1] === '+' ? 1 : -1) * (Number(off[2]) * 60 + Number(off[3] ?? 0));
    return list.filter((z) => z.minutes === minutes);
  }
  if (/^(gmt|utc)$/i.test(q)) return list.filter((z) => z.minutes === 0);

  const c = compact(q);
  const rank = (z: ZoneInfo & { keys: string }): number => {
    const city = compact(z.city);
    if (city === c || compact(cityLabel(z.id)) === c) return 0;
    if (city.startsWith(c)) return 1;
    if (compact(z.local).includes(c)) return 2;
    if (z.keys.includes(c)) return 3;
    return -1;
  };
  return list
    .map((z) => [rank(z), z] as const)
    .filter(([r]) => r >= 0)
    .sort((a, b) => a[0] - b[0])
    .map(([, z]) => z);
}
