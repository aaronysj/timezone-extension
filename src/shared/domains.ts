import { parse } from 'tldts';
import type { RuleMatch } from './config';
import { t } from './i18n';
import { normalizePattern } from './resolve';

export interface SiteScope { pattern: string; match: RuleMatch }

/** Never offers ICANN or private public suffixes as a parent scope. */
export function siteScopes(host: string): SiteScope[] {
  const scopes: SiteScope[] = [{ pattern: host, match: 'exact' }];
  const parsed = parse(host, { allowPrivateDomains: true });
  if (!parsed.domain || parsed.isIp || (!parsed.isIcann && !parsed.isPrivate)) return scopes;
  let pattern = host;
  while (pattern.length >= parsed.domain.length) {
    scopes.push({ pattern, match: 'suffix' });
    if (pattern === parsed.domain) break;
    pattern = pattern.slice(pattern.indexOf('.') + 1);
  }
  return scopes;
}

export function rulePatternError(input: string, match: RuleMatch): string {
  const host = normalizePattern(input);
  if (!host) return t('patternInvalid');
  const parsed = parse(host, { allowPrivateDomains: true });
  if (match === 'suffix' && (parsed.isIcann || parsed.isPrivate) && !parsed.domain)
    return t('patternPublicSuffix', host);
  return '';
}

export const scopeLabel = (scope: SiteScope): string =>
  t(scope.match === 'exact' ? 'scopeExact' : 'scopeSuffix', scope.pattern);
