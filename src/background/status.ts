import type { Config } from '../shared/config';
import type { TabStatus } from '../shared/messages';
import { type Resolution, resolveTimezone } from '../shared/resolve';

/** Merges the page probe with config: a temporary override in the page outranks config, even when the mode is off. */
export function tabStatus(url: string | undefined, config: Config, probe: { applied: string | null; temporary: string | null; error?: string }, configurationError?: string): TabStatus {
  const desired: Resolution | null = probe.temporary ? { timezone: probe.temporary, temporary: true } : url ? resolveTimezone(url, config) : null;
  if (!desired) return { desired: null, applied: null, temporary: null };
  const status = { ...probe };
  try {
    if (status.applied === new Intl.DateTimeFormat('en', { timeZone: desired.timezone }).resolvedOptions().timeZone) status.applied = desired.timezone;
  } catch (error) { status.error = String(error); }
  return { desired, ...status, ...(configurationError ? { error: configurationError } : {}) };
}
