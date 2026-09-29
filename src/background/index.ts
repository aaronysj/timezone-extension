import { type Config, DEFAULT_CONFIG, loadConfig, onConfigChanged } from '../shared/config';
import type { Request, TabStatus } from '../shared/messages';
import { resolveTimezone } from '../shared/resolve';
import { Overrider } from './overrider';
import { setLanguage } from '../shared/i18n';

const overrider = new Overrider();
let config: Config = DEFAULT_CONFIG;
let configurationError: string | undefined;

function updateIcon(): void {
  chrome.action.setIcon({ path: { 16: `icons/${config.mode}-16.png`, 32: `icons/${config.mode}-32.png` } }).catch(() => {});
}

async function configure(next: Config): Promise<void> {
  config = next;
  setLanguage(config.language);
  updateIcon();
  try {
    await overrider.configure(config);
    configurationError = undefined;
  } catch (error) { configurationError = String(error); }
}

let ready = loadConfig().then(configure);
onConfigChanged((next) => { ready = ready.then(() => configure(next)); });

// document_start handles first page scripts; refresh restored/inherited-origin frames too.
chrome.webNavigation.onCommitted.addListener(({ tabId }) => {
  void ready.then(() => overrider.apply(tabId, config)).catch(() => {});
});
chrome.tabs.onRemoved.addListener((tabId) => overrider.forget(tabId));

async function handle(req: Request): Promise<unknown> {
  await ready;
  if (req.type === 'retry') {
    await configure(config);
    await overrider.apply(req.tabId, config);
    return null;
  }
  const tab = await chrome.tabs.get(req.tabId);
  const url = tab.pendingUrl ?? tab.url;
  const desired = url ? resolveTimezone(url, config) : null;
  if (!desired) return { desired: null, applied: null } satisfies TabStatus;
  const status = await overrider.status(req.tabId);
  try {
    if (status.applied === new Intl.DateTimeFormat('en', { timeZone: desired.timezone }).resolvedOptions().timeZone) status.applied = desired.timezone;
  } catch (error) { status.error = String(error); }
  return { desired, ...status, ...(configurationError ? { error: configurationError } : {}) } satisfies TabStatus;
}

chrome.runtime.onMessage.addListener((req: Request, _sender, sendResponse) => {
  handle(req).then(sendResponse, (error: unknown) => sendResponse({ error: String(error) }));
  return true;
});
