import type { Config, Rule } from './config';

export interface Resolution {
  timezone: string;
  /** The include rule that decided the result; undefined in global mode. */
  rule?: Rule;
  /** Set by this tab's temporary override, which outranks every config rule. */
  temporary?: boolean;
}

/**
 * Normalizes user input into a bare lowercase hostname.
 * Accepts "Example.com", "*.example.com", ".example.com", "https://example.com/path".
 */
export function normalizePattern(input: string): string {
  const s = input.trim().replace(/^\*?\./, '');
  if (!s || /[\s\\]/.test(s)) return '';
  try {
    const u = new URL(s.includes('://') ? s : `https://${s}`);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return '';
    const host = u.hostname.toLowerCase().replace(/\.$/, '');
    if (host.startsWith('[')) return host; // URL validates bracketed IPv6.
    if (host.length > 253 || !host.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return '';
    return host;
  } catch {
    return '';
  }
}

export function hostnameOf(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.hostname.replace(/\.$/, '') : null;
  } catch {
    return null;
  }
}

export function ruleMatches(rule: Rule, host: string): boolean {
  const p = normalizePattern(rule.pattern);
  if (!p) return false;
  return rule.match === 'exact' ? host === p : host === p || host.endsWith(`.${p}`);
}

/** Exact beats suffix; among suffixes the longest pattern wins; ties go to the earlier rule. */
export function ruleSpecificity(rule: Rule): number {
  return (rule.match === 'exact' ? 1e6 : 0) + normalizePattern(rule.pattern).length;
}

/** The effective rule, including exclusions, shared by the editor and resolver. */
export function ruleForHost(host: string, rules: Rule[]): Rule | undefined {
  let best: Rule | undefined;
  for (const rule of rules) {
    if (!rule.enabled || !ruleMatches(rule, host)) continue;
    if (!best || (rule.action === 'exclude' && best.action !== 'exclude') ||
      (rule.action === best.action && ruleSpecificity(rule) > ruleSpecificity(best))) best = rule;
  }
  return best;
}

/**
 * Decides which timezone (if any) a URL should run under.
 * Only http(s) pages are eligible; exclude rules always win over include rules.
 */
export function resolveTimezone(url: string, config: Config): Resolution | null {
  if (config.mode === 'off') return null;
  const host = hostnameOf(url);
  if (!host) return null;
  if (config.mode === 'global') return { timezone: config.timezone };

  const best = ruleForHost(host, config.rules);
  return best?.action === 'include' ? { timezone: best.timezone || config.timezone, rule: best } : null;
}
