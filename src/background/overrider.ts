import { t } from '../shared/i18n';
import { hostnameOf } from '../shared/resolve';
import { isValidTimezone } from '../shared/timezone';

const PROTOCOL_VERSION = '1.3';
const AUTO_ATTACH = { autoAttach: true, waitForDebuggerOnStart: true, flatten: true };

interface TabState {
  timezone: string;
  /** Flat child sessions (OOPIFs, workers) that need the override pushed separately. */
  children: Set<string>;
}

interface AttachedToTarget {
  sessionId: string;
  targetInfo: { type: string };
  waitingForDebugger: boolean;
}

const noop = () => {};
const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

function send(target: chrome.debugger.DebuggerSession, method: string, params?: Record<string, unknown>) {
  return chrome.debugger.sendCommand(target, method, params);
}

function setTimezone(target: chrome.debugger.DebuggerSession, timezoneId: string) {
  return send(target, 'Emulation.setTimezoneOverride', { timezoneId });
}

async function attach(tabId: number): Promise<void> {
  try {
    await chrome.debugger.attach({ tabId }, PROTOCOL_VERSION);
  } catch (e) {
    if (!/already attached/i.test(errorMessage(e))) throw e;
    // Either a stale session of ours (service worker restarted) or another client owns the tab.
    // detach() only succeeds for our own session, which tells the two cases apart.
    await chrome.debugger.detach({ tabId }).catch(() => {
      throw new Error(t('errTabBusy'));
    });
    await chrome.debugger.attach({ tabId }, PROTOCOL_VERSION);
  }
}

/**
 * Attaching takes tens of ms, so a fast (cached/local) navigation can commit and run
 * scripts before the override lands. The override then only affects later code, so
 * reload once to give the page a consistent timezone from its first script.
 */
async function reloadIfLate(tabId: number, navigationUrl: string): Promise<void> {
  const res = (await send({ tabId }, 'Runtime.evaluate', {
    expression: '[location.href, document.scripts.length]',
    returnByValue: true,
  }).catch(noop)) as { result?: { value?: [string, number] } } | undefined;
  const [href, scripts] = res?.result?.value ?? [];
  // A different host means the new document has not committed yet, so it will start with the override.
  // No <script> yet means nothing has observed the old timezone.
  if (href && scripts && hostnameOf(href) === hostnameOf(navigationUrl)) await chrome.tabs.reload(tabId);
}

/**
 * Owns every chrome.debugger session of the extension and keeps each tab's
 * CDP timezone override equal to the last value passed to apply().
 */
export class Overrider {
  private readonly tabs = new Map<number, TabState>();
  private readonly errors = new Map<number, string>();
  private readonly queues = new Map<number, Promise<void>>();

  /**
   * null = no override (detach). Calls for the same tab are serialized in call order.
   * Pass navigationUrl when triggered by a navigation so a lost attach race can be repaired.
   */
  apply(tabId: number, timezone: string | null, navigationUrl?: string): Promise<void> {
    const next = (this.queues.get(tabId) ?? Promise.resolve()).then(() => this.applyNow(tabId, timezone, navigationUrl));
    this.queues.set(tabId, next);
    void next.finally(() => this.queues.get(tabId) === next && this.queues.delete(tabId));
    return next;
  }

  status(tabId: number): { applied: string | null; error?: string } {
    const error = this.errors.get(tabId);
    return { applied: this.tabs.get(tabId)?.timezone ?? null, ...(error ? { error } : {}) };
  }

  forget(tabId: number): void {
    this.tabs.delete(tabId);
    this.errors.delete(tabId);
  }

  handleDetach(source: chrome.debugger.Debuggee): void {
    if (source.tabId !== undefined) this.tabs.delete(source.tabId);
  }

  handleEvent(source: chrome.debugger.DebuggerSession, method: string, params: unknown): void {
    const { tabId } = source;
    if (tabId === undefined) return;
    if (method === 'Target.attachedToTarget') void this.onChildAttached(tabId, params as AttachedToTarget);
    else if (method === 'Target.detachedFromTarget')
      this.tabs.get(tabId)?.children.delete((params as { sessionId: string }).sessionId);
  }

  private async applyNow(tabId: number, timezone: string | null, navigationUrl?: string): Promise<void> {
    const state = this.tabs.get(tabId);
    if (timezone === null || !isValidTimezone(timezone)) {
      if (timezone === null) this.errors.delete(tabId);
      else this.errors.set(tabId, t('errInvalidTimezone', timezone));
      if (!state) return;
      this.tabs.delete(tabId);
      await chrome.debugger.detach({ tabId }).catch(noop);
      return;
    }
    if (state?.timezone === timezone) return;
    try {
      if (state) {
        state.timezone = timezone;
        await setTimezone({ tabId }, timezone);
        await Promise.all([...state.children].map((sessionId) => setTimezone({ tabId, sessionId }, timezone).catch(noop)));
      } else {
        await attach(tabId);
        // Register state before auto-attach so existing children see the timezone in onChildAttached.
        this.tabs.set(tabId, { timezone, children: new Set() });
        await setTimezone({ tabId }, timezone);
        await send({ tabId }, 'Target.setAutoAttach', AUTO_ATTACH);
        if (navigationUrl) await reloadIfLate(tabId, navigationUrl);
      }
      this.errors.delete(tabId);
    } catch (e) {
      this.errors.set(tabId, errorMessage(e));
      // A session that cannot apply the override only costs the user an infobar.
      if (this.tabs.delete(tabId)) await chrome.debugger.detach({ tabId }).catch(noop);
    }
  }

  private async onChildAttached(tabId: number, { sessionId, targetInfo, waitingForDebugger }: AttachedToTarget) {
    const session = { tabId, sessionId };
    const state = this.tabs.get(tabId);
    try {
      if (!state) return;
      // The override is renderer-process wide, so workers inherit it from their owner's process.
      // Only OOPIFs live in a separate process; overriding workers too just leaks stale per-process state.
      if (targetInfo.type !== 'iframe') return;
      state.children.add(sessionId);
      await setTimezone(session, state.timezone).catch(noop);
      // Auto-attach is not recursive: nested cross-origin iframes need their own subscription.
      await send(session, 'Target.setAutoAttach', AUTO_ATTACH).catch(noop);
    } finally {
      if (waitingForDebugger) await send(session, 'Runtime.runIfWaitingForDebugger').catch(noop);
    }
  }
}
