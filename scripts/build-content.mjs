import { build } from 'vite';
import fs from 'node:fs/promises';

const watching = process.argv.includes('--watch');
await build({ configFile: false, mode: watching ? 'development' : 'production', build: {
  outDir: 'dist', emptyOutDir: false, target: 'chrome125',
  watch: watching ? {} : null, sourcemap: watching, minify: !watching,
  lib: { entry: 'src/content/main.ts', name: 'TimezoneOverride', formats: ['iife'], fileName: () => 'timezone-content.js' },
} });
const zones = new Set([...Intl.supportedValuesOf('timeZone'), 'UTC']);
for (let hours = -14; hours <= 12; hours++) {
  const zone = `Etc/GMT${hours >= 0 ? '+' : ''}${hours}`;
  try { zones.add(new Intl.DateTimeFormat('en', { timeZone: zone }).resolvedOptions().timeZone); } catch {}
}
await fs.mkdir('dist/timezones', { recursive: true });
await Promise.all([...zones].map((zone) => fs.writeFile(`dist/timezones/${zone.replace(/[^a-zA-Z0-9-]/g, '_')}.js`, `globalThis[Symbol.for('timezone-override.pending')]=${JSON.stringify(zone)};\n`)));
