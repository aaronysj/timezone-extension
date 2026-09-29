import { installTimezone } from './timezone';

const key = Symbol.for('timezone-override.pending');
const root = globalThis as typeof globalThis & { [key: symbol]: string };
if (root[key] !== undefined) installTimezone(root[key]);
delete root[key];
