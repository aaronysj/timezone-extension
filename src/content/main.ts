import { installTimezone, markedZone } from './timezone';

const key = Symbol.for('timezone-override.pending');
const locked = Symbol.for('timezone-override.temporary');
const root = globalThis as typeof globalThis & { [key: symbol]: string | boolean | undefined };
const pending = root[key] as string | undefined;
delete root[key];
// Config scripts carry a pending zone. Only the temporary-only script (none) honors the page marker, so hosts without a
// live temporary registration ignore it. Whichever of the two runs first, the marker's zone is the one left installed.
if (pending === undefined) {
  const zone = markedZone();
  if (zone) { installTimezone(zone); root[locked] = true; }
} else if (!root[locked]) installTimezone(pending);
