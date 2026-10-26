import { build } from 'vite';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileName, tzdataNames } from './timezone-names.mjs';

const watching = process.argv.includes('--watch');
// IIFE builds take one entry each. Separate files: Chrome injects a given file once per document.
for (const [entry, file] of [['main', 'timezone-content.js'], ['temporary', 'timezone-temporary.js']]) {
  await build({ configFile: false, mode: watching ? 'development' : 'production', build: {
    outDir: 'dist', emptyOutDir: false, target: 'chrome125',
    watch: watching ? {} : null, sourcemap: watching, minify: !watching,
    lib: { entry: `src/content/${entry}.ts`, name: 'TimezoneOverride', formats: ['iife'], fileName: () => file },
  } });
}
const zones = new Set([...Intl.supportedValuesOf('timeZone'), 'UTC']);
for (let hours = -14; hours <= 12; hours++) {
  const zone = `Etc/GMT${hours >= 0 ? '+' : ''}${hours}`;
  try { zones.add(new Intl.DateTimeFormat('en', { timeZone: zone }).resolvedOptions().timeZone); } catch {}
}
for (const zone of tzdataNames(createRequire(import.meta.url)('tzdata'))) zones.add(zone);
await fs.rm('dist/timezones', { recursive: true, force: true });
await fs.mkdir('dist/timezones', { recursive: true });
await Promise.all([...zones].map((zone) => fs.writeFile(`dist/timezones/${fileName(zone)}`, `globalThis[Symbol.for('timezone-override.pending')]=${JSON.stringify(zone)};\n`)));
// Shipped-name list so the runtime can reject unknown zones before registration.
await fs.writeFile('dist/timezones/index.json', JSON.stringify([...zones].map(fileName).sort()));
