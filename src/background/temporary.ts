import { t } from '../shared/i18n';
import { TEMPORARY_MARKER_KEY } from '../content/timezone';
import { type TemporaryEntry, TEMPORARY_STORE_KEY, loadTemporaryTabs, temporaryHost } from '../shared/temporary';
import { hostPatterns } from './registrations';

/** Deliberately not `timezone-` prefixed: Overrider.configure unregisters every script with that prefix. */
export const TEMPORARY_SCRIPT_ID = 'temporary-timezone';

/**
 * Writes or removes the page marker in the tab's top frame; false when the page's storage is unusable (sandboxed, disabled).
 * Self-contained: Chrome serializes it.
 */
export function writeMarker(timezone: string | null, key: string): boolean {
  try {
    if (timezone === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, timezone);
    return true;
  } catch { return false; }
}

/** Pinned to one document, so a tab that navigated since the origin was recorded gets an error instead of a marker on the wrong page. `documentId` is omitted only to clean up wherever the tab is now. */
export async function setMarker(tabId: number, timezone: string | null, documentId?: string): Promise<void> {
  const target = documentId ? { tabId, documentIds: [documentId] } : { tabId, frameIds: [0] };
  const [result] = await chrome.scripting.executeScript({ target, world: 'MAIN', func: writeMarker, args: [timezone, TEMPORARY_MARKER_KEY], injectImmediately: true });
  if (!result?.result) throw new Error(t('tempErrStorage'));
}

/**
 * Source of truth for which tabs run a temporary override (`chrome.storage.session`), with one persistent-until-restart
 * script registered for their hosts so reloads apply from document_start. The page marker only tells that script which
 * zone to use; nothing outside the registration reads it, and an entry is what makes it count. Stale markers
 * (after End, a host switch, session restore) are therefore inert, and a forged one cannot fake the popup or block Off.
 */
export class TemporaryTabs {
  private queue: Promise<unknown> = Promise.resolve();

  get(tabId: number): Promise<TemporaryEntry | undefined> {
    return loadTemporaryTabs().then((tabs) => tabs[tabId]);
  }

  /** Marks the tab, rolling back if the page refuses the marker, so a failure never leaves a half-applied override. */
  async start(tabId: number, entry: TemporaryEntry, documentId: string): Promise<void> {
    const previous = await this.update(tabId, entry);
    try { await setMarker(tabId, entry.timezone, documentId); } catch (error) {
      await this.update(tabId, previous ?? null).catch(() => {});
      throw error;
    }
  }

  /** The entry decides; the marker is only cleaned where the tab still shows its page. */
  async end(tabId: number): Promise<void> {
    await this.update(tabId, null);
    await setMarker(tabId, null).catch(() => {});
  }

  /** Resolves to the entry it replaced, read inside the queue so it is never stale. */
  async update(tabId: number, entry: TemporaryEntry | null): Promise<TemporaryEntry | undefined> {
    let previous: TemporaryEntry | undefined;
    await this.mutate((tabs) => {
      previous = tabs[tabId];
      if (!entry && !previous) return false; // Most closed tabs never had an override.
      if (entry) tabs[tabId] = entry; else delete tabs[tabId];
      return true;
    });
    return previous;
  }

  /** The tab id changes when a prerendered page replaces the tab. */
  replace(removed: number, added: number): Promise<void> {
    return this.mutate((tabs) => {
      if (!(removed in tabs)) return false;
      tabs[added] = tabs[removed]!;
      delete tabs[removed];
      return true;
    });
  }

  /**
   * Drops entries of tabs that no longer exist and makes the registration match what is left. Extension reloads clear
   * `storage.session` but keep dynamic registrations, which would otherwise outlive every entry.
   */
  sync(): Promise<void> {
    return this.serialize(async () => {
      const tabs = await loadTemporaryTabs();
      const open = new Set((await chrome.tabs.query({})).map((tab) => String(tab.id)));
      const gone = Object.keys(tabs).filter((id) => !open.has(id));
      for (const id of gone) delete tabs[id];
      await this.register(tabs);
      if (gone.length) await chrome.storage.session.set({ [TEMPORARY_STORE_KEY]: tabs });
    });
  }

  /** Serialized so concurrent changes cannot race. The registration is changed first: if it fails the stored state is untouched and a retry starts clean. */
  private mutate(change: (tabs: Record<string, TemporaryEntry>) => boolean): Promise<void> {
    return this.serialize(async () => {
      const tabs = await loadTemporaryTabs();
      if (!change(tabs)) return;
      await this.register(tabs);
      await chrome.storage.session.set({ [TEMPORARY_STORE_KEY]: tabs });
    });
  }

  private serialize(task: () => Promise<void>): Promise<void> {
    const run = this.queue.then(task);
    this.queue = run.catch(() => {});
    return run;
  }

  /** Makes the registration cover exactly the hosts of the entries; a registration that already does is left alone. */
  private async register(tabs: Record<string, TemporaryEntry>): Promise<void> {
    const matches = [...new Set(Object.values(tabs).map((entry) => temporaryHost(entry.origin)!))].sort().flatMap((host) => hostPatterns(host));
    const [existing] = await chrome.scripting.getRegisteredContentScripts({ ids: [TEMPORARY_SCRIPT_ID] });
    if (!matches.length) {
      if (existing) await chrome.scripting.unregisterContentScripts({ ids: [TEMPORARY_SCRIPT_ID] });
      return;
    }
    if (existing && JSON.stringify(existing.matches) === JSON.stringify(matches)) return;
    const script: chrome.scripting.RegisteredContentScript = {
      id: TEMPORARY_SCRIPT_ID, matches, js: ['timezone-temporary.js'],
      world: 'MAIN', runAt: 'document_start', allFrames: true, matchOriginAsFallback: true, persistAcrossSessions: false,
    };
    if (existing) await chrome.scripting.updateContentScripts([script]);
    else await chrome.scripting.registerContentScripts([script]);
  }
}
