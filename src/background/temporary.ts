import { hostnameOf, normalizePattern } from '../shared/resolve';
import { hostPatterns } from './registrations';

/** Deliberately not `timezone-` prefixed: Overrider.configure unregisters every script with that prefix. */
export const TEMPORARY_SCRIPT_ID = 'temporary-timezone';
const STORE_KEY = 'temporaryTabs';

/** The host a temporary override can target, or null for pages it cannot cover (non-http(s), unmatchable hostnames). */
export function temporaryHost(url: string | undefined): string | null {
  const host = url ? hostnameOf(url) : null;
  return host ? normalizePattern(host) || null : null;
}

/**
 * Writes or removes the page marker in the tab's top frame; false when the page's storage is unusable (sandboxed, disabled).
 * Self-contained: Chrome serializes it.
 */
export function writeMarker(timezone: string | null): boolean {
  try {
    if (timezone === null) sessionStorage.removeItem('timezone-override.temporary');
    else sessionStorage.setItem('timezone-override.temporary', timezone);
    return true;
  } catch { return false; }
}

export async function setMarker(tabId: number, timezone: string | null): Promise<void> {
  const [result] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, world: 'MAIN', func: writeMarker, args: [timezone], injectImmediately: true });
  if (!result?.result) throw new Error('Page storage is unavailable, so a temporary timezone cannot be kept for this tab');
}

/**
 * Tracks which tabs run a temporary override and keeps one persistent-until-restart script registered for their hosts.
 * The script only carries the engine: every frame reads its own marker, so other tabs on the same host stay untouched.
 */
export class TemporaryTabs {
  private queue: Promise<unknown> = Promise.resolve();

  /** Serialized so concurrent register/update/unregister calls cannot race; `chrome.storage.session` survives worker restarts. */
  update(tabId: number, host: string | null): Promise<void> {
    const run = this.queue.then(async () => {
      const tabs = ((await chrome.storage.session.get(STORE_KEY))[STORE_KEY] ?? {}) as Record<string, string>;
      if (!host && !(tabId in tabs)) return; // Most closed tabs never had an override.
      if (host) tabs[tabId] = host; else delete tabs[tabId];
      await chrome.storage.session.set({ [STORE_KEY]: tabs });
      await this.register([...new Set(Object.values(tabs))].sort());
    });
    this.queue = run.catch(() => {});
    return run;
  }

  private async register(hosts: string[]): Promise<void> {
    const exists = (await chrome.scripting.getRegisteredContentScripts({ ids: [TEMPORARY_SCRIPT_ID] })).length > 0;
    if (!hosts.length) {
      if (exists) await chrome.scripting.unregisterContentScripts({ ids: [TEMPORARY_SCRIPT_ID] });
      return;
    }
    const script: chrome.scripting.RegisteredContentScript = {
      id: TEMPORARY_SCRIPT_ID, matches: hosts.flatMap((host) => hostPatterns(host)), js: ['timezone-content.js'],
      world: 'MAIN', runAt: 'document_start', allFrames: true, matchOriginAsFallback: true, persistAcrossSessions: false,
    };
    if (exists) await chrome.scripting.updateContentScripts([script]);
    else await chrome.scripting.registerContentScripts([script]);
  }
}
