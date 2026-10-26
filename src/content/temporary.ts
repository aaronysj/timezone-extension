import { installTimezone, markedZone } from './timezone';

// The temporary-only registration's own file: Chrome injects a file once per document, so sharing timezone-content.js
// with a config script on the same host would drop this one. It is the only reader of the page marker.
const zone = markedZone();
if (zone) {
  installTimezone(zone);
  (globalThis as typeof globalThis & { [key: symbol]: boolean })[Symbol.for('timezone-override.temporary-lock')] = true;
}
