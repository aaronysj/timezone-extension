import { installTimezone } from './timezone';

const key = Symbol.for('timezone-override.pending');
const controller = Symbol.for('timezone-override.controller');
const root = globalThis as typeof globalThis & { [key: symbol]: string };
// Without a pending zone this is the temporary-only script: it installs from the page marker, but must not
// reset a controller that a config script already set up in this frame.
if (root[key] !== undefined || !(controller in root)) installTimezone(root[key] ?? null);
delete root[key];
