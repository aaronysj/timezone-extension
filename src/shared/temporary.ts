import { hostnameOf, normalizePattern } from './resolve';

/**
 * A tab's temporary override. The background owns it; the page marker is only a transport for reloads.
 * Keyed on the origin the marker was written to: sessionStorage is per origin, so a scheme or port change is a different page.
 */
export interface TemporaryEntry {
  origin: string;
  timezone: string;
}

export const TEMPORARY_STORE_KEY = 'temporaryTabs';

/** The host a temporary override can target, or null for pages it cannot cover (non-http(s), unmatchable hostnames). */
export function temporaryHost(url: string | undefined): string | null {
  const host = url ? hostnameOf(url) : null;
  return host ? normalizePattern(host) || null : null;
}

/** The origin a temporary override would be recorded for, or null where `temporaryHost` is. */
export function temporaryOrigin(url: string | undefined): string | null {
  if (!temporaryHost(url)) return null;
  try { return new URL(url!).origin; } catch { return null; }
}

export async function loadTemporaryTabs(): Promise<Record<string, TemporaryEntry>> {
  return ((await chrome.storage.session.get(TEMPORARY_STORE_KEY))[TEMPORARY_STORE_KEY] ?? {}) as Record<string, TemporaryEntry>;
}

/** The zone this entry gives `url`: it only covers the origin it was set for, so a tab that moved on is back on config. */
export function temporaryZone(entry: TemporaryEntry | undefined, url: string | undefined): string | null {
  return entry && temporaryOrigin(url) === entry.origin ? entry.timezone : null;
}
