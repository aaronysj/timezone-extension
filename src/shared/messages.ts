import type { Resolution } from './resolve';

export type Request = { type: 'getStatus'; tabId: number } | { type: 'resume'; tabId: number };

export interface TabStatus {
  /** What the current config says this tab should run under. */
  desired: Resolution | null;
  /** Timezone actually pushed to the tab via CDP, null if not attached. */
  applied: string | null;
  /** User dismissed the debugger infobar for this tab; we stay away until resumed. */
  suppressed: boolean;
  error?: string;
}

export function sendRequest<T>(req: Request): Promise<T> {
  return chrome.runtime.sendMessage(req);
}
