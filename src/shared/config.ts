import { isValidTimezone, systemTimezone } from './timezone';
import { normalizePattern } from './resolve';
import { type Language, parseLanguage } from './i18n';

export type Mode = 'off' | 'global' | 'rules';
export type RuleAction = 'include' | 'exclude';
export type RuleMatch = 'exact' | 'suffix';

export interface Rule {
  id: string;
  enabled: boolean;
  action: RuleAction;
  match: RuleMatch;
  pattern: string;
  /** Only meaningful for include rules; falls back to Config.timezone when empty. */
  timezone?: string;
}

export interface Config {
  /** Missing in older configurations: follow the browser. */
  language?: Language;
  mode: Mode;
  timezone: string;
  rules: Rule[];
}

export const DEFAULT_CONFIG: Config = { mode: 'off', timezone: systemTimezone(), rules: [] };

const STORAGE_KEY = 'config';
const MODES: readonly Mode[] = ['off', 'global', 'rules'];

function parseRule(raw: unknown): Rule | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.pattern !== 'string') return null;
  return {
    id: typeof r.id === 'string' ? r.id : crypto.randomUUID(),
    enabled: r.enabled !== false,
    action: r.action === 'exclude' ? 'exclude' : 'include',
    match: r.match === 'exact' ? 'exact' : 'suffix',
    pattern: r.pattern,
    ...(typeof r.timezone === 'string' && r.timezone ? { timezone: r.timezone } : {}),
  };
}

/** Tolerates missing/corrupt fields so a bad stored value never bricks the extension. */
export function parseConfig(raw: unknown): Config {
  if (!raw || typeof raw !== 'object') return structuredClone(DEFAULT_CONFIG);
  const c = raw as Record<string, unknown>;
  return {
    mode: MODES.includes(c.mode as Mode) ? (c.mode as Mode) : DEFAULT_CONFIG.mode,
    timezone: typeof c.timezone === 'string' && isValidTimezone(c.timezone) ? c.timezone : DEFAULT_CONFIG.timezone,
    rules: Array.isArray(c.rules) ? c.rules.map(parseRule).filter((r): r is Rule => r !== null) : [],
    ...(c.language !== undefined ? { language: parseLanguage(c.language) } : {}),
  };
}

export async function loadConfig(): Promise<Config> {
  const { [STORAGE_KEY]: raw } = await chrome.storage.local.get(STORAGE_KEY);
  return parseConfig(raw);
}

export function saveConfig(config: Config): Promise<void> {
  return chrome.storage.local.set({ [STORAGE_KEY]: config });
}

export function onConfigChanged(listener: (config: Config) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && STORAGE_KEY in changes) listener(parseConfig(changes[STORAGE_KEY]?.newValue));
  });
}

/** Adds a rule, or merges into the one with the same match type + pattern instead of duplicating it. */
export function upsertRule(config: Config, rule: Omit<Rule, 'id'>): Config {
  const i = config.rules.findIndex((r) => r.match === rule.match && normalizePattern(r.pattern) === rule.pattern);
  const existing = i >= 0 ? config.rules[i] : undefined;
  const next: Rule = existing ? { ...existing, ...rule } : { ...rule, id: crypto.randomUUID() };
  const rules = i >= 0 ? config.rules.with(i, next) : [...config.rules, next];
  return { ...config, rules };
}
