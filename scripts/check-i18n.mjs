import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || import.meta.dirname + '/..');
const localeRoot = path.join(root, 'public/_locales');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public/manifest.json'), 'utf8'));
const catalogs = Object.fromEntries(fs.readdirSync(localeRoot).map(locale => [locale,
  JSON.parse(fs.readFileSync(path.join(localeRoot, locale, 'messages.json'), 'utf8'))]));
const baseline = catalogs[manifest.default_locale];
const errors = [];
const fail = (where, message) => errors.push(`${where}: ${message}`);
const parameters = message => [...new Set([...message.matchAll(/\$([1-9])/g)].map(m => Number(m[1])))].sort();

if (!baseline) throw new Error('default_locale must have a catalog');
for (const [locale, catalog] of Object.entries(catalogs)) {
  for (const key of new Set([...Object.keys(baseline), ...Object.keys(catalog)])) {
    const where = `${locale}.${key}`;
    const message = catalog[key]?.message;
    if (typeof message !== 'string' || !message.trim()) { fail(where, 'missing or empty message'); continue; }
    if (!baseline[key]) { fail(where, 'key absent from default catalog'); continue; }
    // This project uses direct positional substitutions, not named placeholders.
    if (/\$\w+\$/.test(message) || message.replace(/\$\$|\$[1-9](?!\d)/g, '').includes('$'))
      fail(where, 'invalid placeholder; use $1..$9 or $$');
    if (parameters(message).join() !== parameters(baseline[key].message).join())
      fail(where, 'substitutions differ from default catalog');
  }
  const tag = Intl.getCanonicalLocales(locale.replaceAll('_', '-'))[0];
  if (catalog.locale?.message !== tag) fail(locale, `locale metadata must equal ${tag}`);
}
for (const match of JSON.stringify(manifest).matchAll(/__MSG_(\w+)__/g)) {
  const key = match[1];
  if (!baseline[key]) fail('manifest', `missing key ${key}`);
  else if (parameters(baseline[key].message).length) fail('manifest', `${key} cannot require substitutions`);
}

if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else console.log(`i18n validated: ${Object.keys(catalogs).length} locales, ${Object.keys(baseline).length} messages`);
