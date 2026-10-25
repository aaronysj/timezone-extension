import { t } from '../shared/i18n';
import { type TemporaryEntry, TEMPORARY_STORE_KEY, loadTemporaryTabs } from '../shared/temporary';
import { hostPatterns } from './registrations';

/** Deliberately not `timezone-` prefixed: Overrider.configure unregisters every script with that prefix. */
export const TEMPORARY_SCRIPT_ID = 'temporary-timezone';

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
  async start(tabId: number, entry: TemporaryEntry): Promise<void> {
    const previous = await this.get(tabId);
    await this.update(tabId, entry);
    try { await setMarker(tabId, entry.timezone); } catch (error) {
      await this.update(tabId, previous ?? null).catch(() => {});
      throw error;
    }
  }

  /** The entry decides; the marker is only cleaned where the tab still shows its page. */
  async end(tabId: number): Promise<void> {
    await this.update(tabId, null);
    await setMarker(tabId, null).catch(() => {});
  }

  update(tabId: number, entry: TemporaryEntry | null): Promise<void> {
    return this.mutate((tabs) => {
      if (!entry && !(tabId in tabs)) return false; // Most closed tabs never had an override.
      if (entry) tabs[tabId] = entry; else delete tabs[tabId];
      return true;
    });
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
    return this.mutate(async (tabs) => {
      const open = new Set((await chrome.tabs.query({})).map((tab) => String(tab.id)));
      for (const id of Object.keys(tabs)) if (!open.has(id)) delete tabs[id];
      return true;
    });
  }

  /** Serialized so concurrent changes cannot race. The registration is changed first: if it fails the stored state is untouched and a retry starts clean. */
  private mutate(change: (tabs: Record<string, TemporaryEntry>) => boolean | Promise<boolean>): Promise<void> {
    const run = this.queue.then(async () => {
      const tabs = await loadTemporaryTabs();
      if (!(await change(tabs))) return;
      await this.register([...new Set(Object.values(tabs).map((entry) => entry.host))].sort());
      await chrome.storage.session.set({ [TEMPORARY_STORE_KEY]: tabs });
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
