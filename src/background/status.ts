import type { Config } from '../shared/config';
import type { TabStatus } from '../shared/messages';
import { type Resolution, hostnameOf, resolveTimezone } from '../shared/resolve';

/** Merges the page probe with config. `temporary` is the background's own entry for this tab and outranks config, even when the mode is off. */
export function tabStatus(url: string | undefined, config: Config, probe: { applied: string | null; error?: string }, temporary: string | null, configurationError?: string): TabStatus {
  const desired: Resolution | null = temporary ? { timezone: temporary } : url ? resolveTimezone(url, config) : null;
  if (!desired) return { desired: null, applied: null, temporary: null };
  const status = { ...probe };
  try {
    if (status.applied === new Intl.DateTimeFormat('en', { timeZone: desired.timezone }).resolvedOptions().timeZone) status.applied = desired.timezone;
  } catch (error) { status.error = String(error); }
  // A registration failure belongs to the config path; a working temporary override does not depend on it.
  return { desired, ...status, temporary, ...(configurationError && !temporary ? { error: configurationError } : {}) };
}

/** Whether the page must be asked what it runs: with no override and no configured zone it is native, and the poll should not inject into it. */
export function needsProbe(url: string | undefined, config: Config, temporary: string | null): boolean {
  return !!url && !!hostnameOf(url) && !!(temporary || resolveTimezone(url, config));
}
