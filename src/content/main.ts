import { installTimezone } from './timezone';

const key = Symbol.for('timezone-override.pending');
const root = globalThis as typeof globalThis & { [key: symbol]: string };
installTimezone(root[key] ?? null);
delete root[key];
