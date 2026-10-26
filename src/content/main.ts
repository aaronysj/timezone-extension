import { installTimezone } from './timezone';

const key = Symbol.for('timezone-override.pending');
const locked = Symbol.for('timezone-override.temporary-lock');
const root = globalThis as typeof globalThis & { [key: symbol]: string | boolean | undefined };
const pending = root[key] as string | undefined;
delete root[key];
// Config scripts carry a pending zone; the temporary entry (temporary.ts) wins whichever of the two runs first.
if (pending !== undefined && !root[locked]) installTimezone(pending);
