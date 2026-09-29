import type { Config } from '../shared/config';
import { resolveTimezone } from '../shared/resolve';
import { installTimezone } from '../content/timezone';
import { registrations } from './registrations';

/** Registers early page scripts and updates open documents without debugger sessions. */
export class Overrider {
  private failures = new Map<number, { documentId: string; error: string }>();
  async configure(config: Config): Promise<void> {
    const old = await chrome.scripting.getRegisteredContentScripts();
    const previous = old.filter((script) => script.id.startsWith('timezone-'));
    const next = registrations(config);
    const ids = new Set(previous.map((script) => script.id));
    const additions = next.filter((script) => !ids.has(script.id));
    const updates = next.filter((script) => ids.has(script.id));
    const obsolete = previous.filter((script) => !next.some((candidate) => candidate.id === script.id)).map((script) => script.id);
    if (updates.length) await chrome.scripting.updateContentScripts(updates);
    if (additions.length) await chrome.scripting.registerContentScripts(additions);
    if (obsolete.length) await chrome.scripting.unregisterContentScripts({ ids: obsolete });
    const tabs = await chrome.tabs.query({});
    await Promise.all(tabs.filter((tab) => tab.id !== undefined && !tab.discarded).map((tab) => this.apply(tab.id!, config).catch(() => {})));
  }

  async apply(tabId: number, config: Config): Promise<void> {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    const byId = new Map(frames?.map((frame) => [frame.frameId, frame]));
    const effectiveUrl = (id: number, visited = new Set<number>()): string => {
      const frame = byId.get(id);
      if (!frame || visited.has(id)) return '';
      visited.add(id);
      if (/^blob:https?:/.test(frame.url)) return frame.url.slice(5);
      return /^(about:|data:)/.test(frame.url) && frame.parentFrameId >= 0 ? effectiveUrl(frame.parentFrameId, visited) : frame.url;
    };
    await Promise.all((frames ?? []).map(async (frame) => {
      if (!/^https?:/.test(effectiveUrl(frame.frameId))) return;
      const timezone = resolveTimezone(effectiveUrl(frame.frameId), config)?.timezone ?? null;
      try {
        await chrome.scripting.executeScript({ target: { tabId, documentIds: [frame.documentId] }, world: 'MAIN', func: installTimezone, args: [timezone], injectImmediately: true });
        if (frame.frameId === 0) this.failures.delete(tabId);
      } catch (error) {
        if (frame.frameId === 0) this.failures.set(tabId, { documentId: frame.documentId, error: String(error) });
      }
    }));
  }

  async status(tabId: number): Promise<{ applied: string | null; error?: string }> {
    try {
      const [result] = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: () => {
        const controller = (globalThis as typeof globalThis & { [key: symbol]: unknown })[Symbol.for('timezone-override.controller')];
        return controller ? Intl.DateTimeFormat().resolvedOptions().timeZone : null;
      } });
      const failure = this.failures.get(tabId);
      return { applied: result?.result ?? null, ...(failure?.documentId === result?.documentId ? { error: failure?.error } : {}) };
    } catch (error) { return { applied: null, error: String(error) }; }
  }

  forget(tabId: number): void { this.failures.delete(tabId); }
}
