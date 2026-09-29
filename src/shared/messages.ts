import type { Resolution } from './resolve';

export type Request = { type: 'getStatus'; tabId: number } | { type: 'retry'; tabId: number };

export interface TabStatus {
  /** What the current config says this tab should run under. */
  desired: Resolution | null;
  /** Timezone observed through the current page's Intl API. */
  applied: string | null;
  error?: string;
}

export function sendRequest<T>(req: Request): Promise<T> {
  return chrome.runtime.sendMessage(req);
}
