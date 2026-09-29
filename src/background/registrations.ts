import type { Config, Rule } from '../shared/config';
import { normalizePattern, ruleSpecificity } from '../shared/resolve';

export function timezoneFile(zone: string): string {
  const canonical = new Intl.DateTimeFormat('en', { timeZone: zone }).resolvedOptions().timeZone;
  return `timezones/${canonical.replace(/[^a-zA-Z0-9-]/g, '_')}.js`;
}

const patterns = (rule: Rule): string[] => {
  const host = normalizePattern(rule.pattern);
  if (!host) return [];
  const prefix = rule.match === 'suffix' && !host.startsWith('[') ? '*.' : '';
  return [`*://${prefix}${host}/*`, ...(!host.startsWith('[') ? [`*://${prefix}${host}./*`] : [])];
};

/** Compile the same precedence as resolveTimezone into mutually exclusive URL matches. */
export function registrations(config: Config): chrome.scripting.RegisteredContentScript[] {
  const script = (id: string, zone: string, matches: string[], excludeMatches: string[] = []): chrome.scripting.RegisteredContentScript => ({
    id, matches, excludeMatches: [...new Set(excludeMatches)], js: [timezoneFile(zone), 'timezone-content.js'],
    world: 'MAIN', runAt: 'document_start', allFrames: true, matchOriginAsFallback: true, persistAcrossSessions: true,
  });
  if (config.mode === 'off') return [];
  if (config.mode === 'global') return [script('timezone-global', config.timezone, ['http://*/*', 'https://*/*'])];
  const rules = config.rules.filter((rule) => rule.enabled && patterns(rule).length);
  const excludes = rules.filter((rule) => rule.action === 'exclude').flatMap(patterns);
  const includes = rules.filter((rule) => rule.action === 'include').sort((a, b) => ruleSpecificity(b) - ruleSpecificity(a));
  const result: chrome.scripting.RegisteredContentScript[] = [];
  const earlier = [...excludes];
  for (const [index, rule] of includes.entries()) {
    try { result.push(script(`timezone-rule-${index}`, rule.timezone || config.timezone, patterns(rule), earlier)); } catch { /* Invalid imported timezone: resolver shows an error rather than installing a broken script. */ }
    earlier.push(...patterns(rule));
  }
  return result;
}
