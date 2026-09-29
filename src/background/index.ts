import { type Config, DEFAULT_CONFIG, loadConfig, onConfigChanged } from '../shared/config';
import type { Request, TabStatus } from '../shared/messages';
import { resolveTimezone } from '../shared/resolve';
import { Overrider } from './overrider';
import { setLanguage } from '../shared/i18n';

const SUPPRESSED_KEY = 'suppressedTabs';
const overrider = new Overrider();
let config: Config = DEFAULT_CONFIG;
let suppressed = new Set<number>();

const ready = (async () => {
  config = await loadConfig();
  setLanguage(config.language);
  const { [SUPPRESSED_KEY]: ids } = await chrome.storage.session.get(SUPPRESSED_KEY);
  if (Array.isArray(ids)) suppressed = new Set(ids);
})();
void ready.then(() => {
  updateIcon();
  return syncAllTabs();
});

function persistSuppressed() {
  return chrome.storage.session.set({ [SUPPRESSED_KEY]: [...suppressed] });
}

/** One global icon per mode; per-tab status lives in the popup. */
function updateIcon(): void {
  const { mode } = config;
  chrome.action.setIcon({ path: { 16: `icons/${mode}-16.png`, 32: `icons/${mode}-32.png` } }).catch(() => {});
}

async function syncTab(tabId: number, url: string | undefined, navigating = false): Promise<void> {
  await ready;
  if (tabId < 0 || url === undefined) return;
  const timezone = suppressed.has(tabId) ? null : (resolveTimezone(url, config)?.timezone ?? null);
  await overrider.apply(tabId, timezone, navigating ? url : undefined);
}

async function syncAllTabs(): Promise<void> {
  const tabs = await chrome.tabs.query({});
  // Discarded tabs have no renderer; they get synced by onBeforeNavigate when reloaded.
  await Promise.all(tabs.filter((t) => t.id !== undefined && !t.discarded).map((t) => syncTab(t.id!, t.pendingUrl ?? t.url)));
}

// Apply before the new document runs any script. Emulation state survives navigations,
// so this only does work when the destination needs a different timezone.
chrome.webNavigation.onBeforeNavigate.addListener(({ tabId, frameId, url }) => {
  if (frameId === 0) void syncTab(tabId, url, true);
});
// Catches cross-host redirects that onBeforeNavigate could not see.
chrome.webNavigation.onCommitted.addListener(({ tabId, frameId, url }) => {
  if (frameId === 0) void syncTab(tabId, url, true);
});
chrome.tabs.onUpdated.addListener((tabId, { url }) => {
  if (url) void syncTab(tabId, url, true);
});
chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  overrider.forget(removedTabId);
  void chrome.tabs.get(addedTabId).then((t) => syncTab(addedTabId, t.pendingUrl ?? t.url, true), () => {});
});
chrome.tabs.onRemoved.addListener((tabId) => {
  overrider.forget(tabId);
  if (suppressed.delete(tabId)) void persistSuppressed();
});

chrome.debugger.onEvent.addListener((source, method, params) => overrider.handleEvent(source, method, params));
chrome.debugger.onDetach.addListener((source, reason) => {
  overrider.handleDetach(source);
  // The user clicked "Cancel" on the debugging infobar: respect it until they resume from the popup.
  if (reason === 'canceled_by_user' && source.tabId !== undefined) {
    suppressed.add(source.tabId);
    void persistSuppressed();
  }
});

onConfigChanged((next) => {
  void ready.then(() => {
    config = next;
    setLanguage(config.language);
    updateIcon();
    return syncAllTabs();
  });
});

async function handle(req: Request): Promise<unknown> {
  await ready;
  switch (req.type) {
    case 'getStatus': {
      const tab = await chrome.tabs.get(req.tabId);
      const url = tab.pendingUrl ?? tab.url;
      const status: TabStatus = {
        desired: url ? resolveTimezone(url, config) : null,
        suppressed: suppressed.has(req.tabId),
        ...overrider.status(req.tabId),
      };
      return status;
    }
    case 'resume': {
      suppressed.delete(req.tabId);
      await persistSuppressed();
      const tab = await chrome.tabs.get(req.tabId);
      await syncTab(req.tabId, tab.pendingUrl ?? tab.url);
      return null;
    }
  }
}

chrome.runtime.onMessage.addListener((req: Request, _sender, sendResponse) => {
  handle(req).then(sendResponse, (e: unknown) => sendResponse({ error: String(e) }));
  return true;
});
