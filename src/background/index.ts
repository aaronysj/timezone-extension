import { type Config, DEFAULT_CONFIG, loadConfig, onConfigChanged } from '../shared/config';
import type { Request, TabStatus } from '../shared/messages';
import { temporaryHost, temporaryZone } from '../shared/temporary';
import { isValidTimezone } from '../shared/timezone';
import { Overrider } from './overrider';
import { needsProbe, tabStatus } from './status';
import { TemporaryTabs } from './temporary';
import { setLanguage, t } from '../shared/i18n';

const temporary = new TemporaryTabs();
const overrider = new Overrider((tabId) => temporary.get(tabId).catch(() => undefined));
let config: Config = DEFAULT_CONFIG;
let configurationError: string | undefined;
let ready: Promise<void> = Promise.resolve();

function updateIcon(): void {
  chrome.action.setIcon({ path: { 16: `icons/${config.mode}-16.png`, 32: `icons/${config.mode}-32.png` } }).catch(() => {});
}

/** Registration is queued; page updates are not, so a frozen tab never stalls later config changes. */
function configure(next: Config): Promise<void> {
  config = next;
  setLanguage(config.language);
  updateIcon();
  const run = ready.then(async () => {
    try {
      await overrider.configure(next);
      configurationError = undefined;
    } catch (error) { configurationError = String(error); }
    if (next === config) void overrider.applyAll(next);
  });
  ready = run;
  return run;
}

let changed = false;
// A change event can arrive before the initial read resolves; never let the older read win.
void loadConfig().then((initial) => changed ? undefined : configure(initial));
onConfigChanged((next) => { changed = true; void configure(next); });

// document_start handles first page scripts; refresh restored/inherited-origin frames too.
chrome.webNavigation.onCommitted.addListener(({ tabId }) => {
  void ready.then(() => overrider.apply(tabId, config)).catch(() => {});
});
chrome.tabs.onRemoved.addListener((tabId) => {
  overrider.forget(tabId);
  void temporary.update(tabId, null).catch(() => {});
});
chrome.tabs.onReplaced.addListener((added, removed) => void temporary.replace(removed, added).catch(() => {}));
// A reload of the extension clears the session state but keeps the registration; reconcile every time the worker starts.
void temporary.sync().catch(() => {});

async function handle(req: Request): Promise<unknown> {
  await ready;
  if (req.type === 'retry') {
    await configure(config);
    await overrider.apply(req.tabId, config);
    return null;
  }
  const tab = await chrome.tabs.get(req.tabId);
  if (req.type === 'setTemporary') {
    const { timezone } = req;
    if (timezone === null) {
      // Ending must always drop the registration, even if the tab has since moved somewhere we cannot script.
      await temporary.end(req.tabId);
      await overrider.apply(req.tabId, config).catch(() => {});
      return null;
    }
    const host = temporaryHost(tab.url);
    if (!host) throw new Error(t('tempErrPage'));
    if (!isValidTimezone(timezone)) throw new Error(t('tempErrZone', timezone));
    await temporary.start(req.tabId, { host, timezone });
    await overrider.apply(req.tabId, config);
    return null;
  }
  const url = tab.pendingUrl ?? tab.url;
  const override = temporaryZone(await temporary.get(req.tabId).catch(() => undefined), url);
  const probe = needsProbe(url, config, override) ? await overrider.status(req.tabId) : { applied: null };
  return tabStatus(url, config, probe, override, configurationError);
}

chrome.runtime.onMessage.addListener((req: Request, _sender, sendResponse) => {
  handle(req).then(sendResponse, (error: unknown) => sendResponse({ error: String(error) }));
  return true;
});
