// End-to-end check against a real Chromium with the built extension loaded (`npm run build` first).
// Pages report to this server and navigate themselves. CDP only controls the
// isolated test browser and extension service worker; the extension never debugs tabs.
//
// Usage: CHROMIUM=/path/to/chromium npm run e2e
// Branded Google Chrome ignores --load-extension since v137; use Chromium / Chrome for Testing.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const EXT = path.resolve(process.env.EXT ?? path.join(import.meta.dirname, '../dist'));
const CHROMIUM = process.env.CHROMIUM;
if (!CHROMIUM) throw new Error('Set CHROMIUM to a Chromium / Chrome for Testing binary');
const SYSTEM_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- test server -----------------------------------------------------------
const reports = new Map(); // step -> documents that reported (a reload yields 2)
const reportWaiters = new Map();
const nextWaiters = new Map();

const testScript = (other, step) => `
  const out = { step: '${step}', early: Intl.DateTimeFormat().resolvedOptions().timeZone };
  out.offset = new Date('2026-01-01T12:00:00Z').getTimezoneOffset();
  out.hour = new Date('2026-01-01T12:00:00Z').getHours();
  out.parse = Date.parse('2026-01-01T12:00:00');
  const w = new Worker(URL.createObjectURL(new Blob(['postMessage(Intl.DateTimeFormat().resolvedOptions().timeZone)'])));
  const within = (p) => Promise.race([p, new Promise((r) => setTimeout(() => r('TIMEOUT'), 4000))]);
  const post = (d) => fetch('/report', { method: 'POST', body: JSON.stringify(d) });
  const frame = new Promise((r) => addEventListener('message', (e) => e.data.frame && r(e.data.frame)));
  const inherited = new Promise((r) => addEventListener('message', (e) => e.data.inherited && r(e.data.inherited)));
  const worker = new Promise((r) => (w.onmessage = (e) => r(e.data)));
  const load = new Promise((r) => addEventListener('load', () => r(true)));
  (async () => {
    [out.frame, out.worker, out.load, out.inherited] = await Promise.all([frame, worker, load, inherited].map(within));
    await post(out);
    for (;;) {
      const n = await (await fetch('/next?s=' + out.step)).json();
      if (!n.live) return void (location.href = n.url);
      await post({ step: n.live, live: Intl.DateTimeFormat().resolvedOptions().timeZone });
      out.step = n.live;
    }
  })();
`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/report') {
    let body = '';
    for await (const c of req) body += c;
    const d = JSON.parse(body);
    const docs = reports.get(d.step) ?? [];
    docs.push(d);
    reports.set(d.step, docs);
    // Give a possible reload time to produce a second report, then take the last one.
    if (docs.length === 1) setTimeout(() => reportWaiters.get(d.step)?.({ ...docs.at(-1), docs: docs.length }), 1500);
    return res.end();
  }
  if (url.pathname === '/next') {
    const v = await new Promise((r) => nextWaiters.set(url.searchParams.get('s'), r));
    return res.end(JSON.stringify(v));
  }
  res.setHeader('content-type', 'text/html');
  res.setHeader('content-security-policy', "script-src 'self'; worker-src blob:; frame-src http://localhost:* http://127.0.0.1:*");
  if (url.pathname === '/frame')
    return res.end('<script src="/frame.js"></script>');
  if (url.pathname === '/inherited.js') {
    res.setHeader('content-type', 'application/javascript');
    return res.end("parent.postMessage({inherited: Intl.DateTimeFormat().resolvedOptions().timeZone}, '*')");
  }
  if (url.pathname === '/frame.js') {
    res.setHeader('content-type', 'application/javascript');
    return res.end("parent.postMessage({frame: Intl.DateTimeFormat().resolvedOptions().timeZone}, '*')");
  }
  const { port } = server.address();
  const other = req.headers.host.startsWith('localhost') ? `127.0.0.1:${port}` : `localhost:${port}`;
  if (url.pathname === '/test.js') {
    res.setHeader('content-type', 'application/javascript');
    return res.end(testScript(other, url.searchParams.get('s')));
  }
  res.end(`<!doctype html><script src="/test.js?s=${url.searchParams.get('s')}"></script><iframe src="http://${other}/frame"></iframe><iframe srcdoc='<script src="/inherited.js"></script>'></iframe>`);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const { port } = server.address();
const LOCAL = `http://localhost:${port}`;
const IP = `http://127.0.0.1:${port}`;

const report = (step) => new Promise((r) => reportWaiters.set(step, r));
async function proceed(step, value) {
  while (!nextWaiters.has(step)) await sleep(20);
  nextWaiters.get(step)(value);
  nextWaiters.delete(step);
}

// ---- browser + extension service worker over raw CDP ------------------------
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tz-e2e-'));
const browser = spawn(CHROMIUM, [
  `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', '--headless=new',
  `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
const wsUrl = await new Promise((r) => browser.stderr.on('data', (d) => { const m = String(d).match(/ws:\/\/\S+/); if (m) r(m[0]); }));
const ws = new WebSocket(wsUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0;
const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); pending.get(m.id)?.(m); pending.delete(m.id); };
const cdp = (method, params = {}, sessionId) =>
  new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params, sessionId })); });

const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
const names = manifest.default_locale
  ? fs.readdirSync(path.join(EXT, '_locales')).map((locale) =>
    JSON.parse(fs.readFileSync(path.join(EXT, '_locales', locale, 'messages.json'), 'utf8'))[
      manifest.name.replace(/^__MSG_(.*)__$/, '$1')
    ].message)
  : [manifest.name];
let sessionId, extensionId;
for (let i = 0; i < 100 && !sessionId; i++, await sleep(100)) {
  const candidates = (await cdp('Target.getTargets')).result.targetInfos.filter(
    (t) => t.type === 'service_worker' && t.url.endsWith('/background.js'));
  for (const candidate of candidates) {
    const attached = (await cdp('Target.attachToTarget', { targetId: candidate.targetId, flatten: true })).result;
    const actual = (await cdp('Runtime.evaluate', {
      expression: 'chrome.runtime.getManifest()', returnByValue: true,
    }, attached.sessionId)).result?.result?.value;
    // Chromium also ships component extensions with a background.js worker.
    if (actual?.version === manifest.version && names.includes(actual.name)) {
      sessionId = attached.sessionId;
      extensionId = new URL(candidate.url).host;
      break;
    }
    await cdp('Target.detachFromTarget', { sessionId: attached.sessionId });
  }
}
if (!sessionId) throw new Error('extension service worker not found');
const evalSW = async (expression) =>
  (await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId)).result?.result?.value;
for (let i = 0; i < 50 && !(await evalSW('!!globalThis.chrome?.storage')); i++) await sleep(100);
const setConfig = async (config) => { await evalSW(`chrome.storage.local.set({ config: ${JSON.stringify(config)} })`); await sleep(300); };
const include = (pattern, timezone) => ({ id: pattern, enabled: true, action: 'include', match: 'suffix', pattern, timezone });
const exclude = (pattern) => ({ id: `x-${pattern}`, enabled: true, action: 'exclude', match: 'exact', pattern });

// ---- scenarios ---------------------------------------------------------------
const results = [];
function expectAll(name, r, tz, frame = tz) {
  const native = spawnSync(process.execPath, ['-e', "console.log(JSON.stringify({offset:new Date('2026-01-01T12:00:00Z').getTimezoneOffset(),hour:new Date('2026-01-01T12:00:00Z').getHours(),parse:Date.parse('2026-01-01T12:00:00')}))"], {env: {...process.env, TZ: tz}, encoding:'utf8'});
  const actual = { early: r.early, frame: r.frame, worker: r.worker, load: r.load, inherited:r.inherited, offset:r.offset, hour:r.hour, parse:r.parse };
  const expected = { early: tz, frame, worker: SYSTEM_TZ, load: true, inherited:tz, ...JSON.parse(native.stdout) };
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  results.push(pass);
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${r.docs > 1 ? ' (reloaded)' : ''}: ${JSON.stringify(actual)}`);
}
function expectEq(name, actual, expected) {
  const pass = actual === expected;
  results.push(pass);
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}: ${actual}${pass ? '' : ` (expected ${expected})`}`);
}

const watchdog = setTimeout(() => { console.log('TIMEOUT'); browser.kill(); process.exit(1); }, 120000);
try {
  expectEq('no debugger permission', manifest.permissions.includes('debugger'), false);
  const missing = await evalSW(`(async () => {
    const zones = [...Intl.supportedValuesOf('timeZone'), 'UTC', 'Etc/GMT+12', 'Etc/GMT-14'];
    const missing = await Promise.all(zones.map(async zone => {
      const canonical = Intl.DateTimeFormat('en', {timeZone:zone}).resolvedOptions().timeZone;
      try {const r = await fetch(chrome.runtime.getURL('timezones/' + canonical.replace(/[^a-zA-Z0-9-]/g, '_') + '.js')); return r.ok ? null : canonical} catch {return canonical}
    })); return missing.filter(Boolean);
  })()`);
  expectEq('all browser-supported timezone bootstraps packaged', JSON.stringify(missing), '[]');
  await setConfig({ mode: 'global', timezone: 'Asia/Tokyo', rules: [] });
  await cdp('Target.createTarget', { url: `${IP}/p?s=1` });
  expectAll('global: new tab', await report('1'), 'Asia/Tokyo');

  await setConfig({ mode: 'rules', timezone: 'Asia/Tokyo', rules: [include('localhost', 'America/New_York')] });
  await proceed('1', { url: `${IP}/p?s=2` });
  expectAll('rules: unmatched host', await report('2'), SYSTEM_TZ, 'America/New_York');
  await proceed('2', { url: `${LOCAL}/p?s=3` });
  expectAll('rules: navigate into matched host', await report('3'), 'America/New_York', SYSTEM_TZ);
  await proceed('3', { url: `${LOCAL}/p?s=4` });
  expectAll('rules: matched -> matched', await report('4'), 'America/New_York', SYSTEM_TZ);
  await proceed('4', { url: `${IP}/p?s=5` });
  expectAll('rules: matched -> unmatched', await report('5'), SYSTEM_TZ, 'America/New_York');

  await setConfig({ mode: 'rules', timezone: 'Asia/Tokyo', rules: [include('localhost'), exclude('localhost')] });
  await proceed('5', { url: `${LOCAL}/p?s=6` });
  expectAll('rules: exclude beats include', await report('6'), SYSTEM_TZ);

  await setConfig({ mode: 'global', timezone: 'Europe/London', rules: [] });
  await proceed('6', { live: '7' });
  expectEq('live: open page picks up config change', (await report('7')).live, 'Europe/London');
  await proceed('7', { url: `${IP}/p?s=8` });
  expectAll('global: after live change', await report('8'), 'Europe/London');

  await setConfig({ mode: 'off', timezone: 'Europe/London', rules: [] });
  await proceed('8', { live: 'off-live' });
  expectEq('off: existing page restores system timezone', (await report('off-live')).live, SYSTEM_TZ);
  await proceed('off-live', { url: `${LOCAL}/p?s=9` });
  expectAll('off: system timezone', await report('9'), SYSTEM_TZ);
  await setConfig({mode:'rules',timezone:'UTC',rules:[include('localhost','Asia/Tokyo'), {...include('localhost','America/New_York'), id:'exact',match:'exact'}, include('127.0.0.1','Europe/London')]});
  await proceed('9', {url: `${LOCAL}/p?s=10`});
  expectAll('rules: exact beats suffix before first script', await report('10'), 'America/New_York', 'Europe/London');
  await setConfig({mode:'rules',timezone:'UTC',rules:[include('localhost','Asia/Tokyo'), exclude('localhost'), include('127.0.0.1','Europe/London')]});
  await proceed('10', {url: `${LOCAL}/p?s=11`});
  expectAll('rules: exclusion does not disable a different-origin iframe', await report('11'), SYSTEM_TZ, 'Europe/London');

  // ---- temporary per-tab override (mode off / rules; page sessionStorage marker + `temporary-timezone` registration) ----
  // The SW cannot message itself, so an extension page (options) plays the popup's part.
  const optionsTarget = (await cdp('Target.createTarget', { url: `chrome-extension://${extensionId}/options.html` })).result.targetId;
  const { sessionId: optionsSession } = (await cdp('Target.attachToTarget', { targetId: optionsTarget, flatten: true })).result;
  const tabIdOf = (step) => evalSW(`chrome.tabs.query({}).then((tabs) => tabs.find((tab) => tab.url.includes('s=${step}'))?.id)`);
  const setTemporary = async (tabId, timezone) => (await cdp('Runtime.evaluate', { awaitPromise: true, returnByValue: true,
    expression: `chrome.runtime.sendMessage({ type: 'setTemporary', tabId: ${tabId}, timezone: ${JSON.stringify(timezone)} })` }, optionsSession)).result?.result?.value;
  const statusOf = async (tabId) => (await cdp('Runtime.evaluate', { awaitPromise: true, returnByValue: true,
    expression: `chrome.runtime.sendMessage({ type: 'getStatus', tabId: ${tabId} }).then((r) => JSON.stringify({ desired: r.desired, applied: r.applied, temporary: r.temporary }))` }, optionsSession)).result?.result?.value;
  const registered = () => evalSW(`chrome.scripting.getRegisteredContentScripts().then((scripts) => scripts.map((script) => script.id).sort().join())`);
  const markerOf = (tabId) => evalSW(`chrome.scripting.executeScript({ target: { tabId: ${tabId} }, world: 'MAIN', func: () => sessionStorage.getItem('timezone-override.temporary') }).then(([r]) => r.result)`);

  await setConfig({ mode: 'off', timezone: 'Europe/London', rules: [] });
  const tabA = await tabIdOf('11');
  expectEq('temporary: nothing registered before use', await registered(), '');
  const ok = await setTemporary(tabA, 'Asia/Tokyo');
  expectEq('temporary: setTemporary succeeds in mode off', ok, null);
  await proceed('11', { live: 't-live' });
  expectEq('temporary: open page switches live while config is off', (await report('t-live')).live, 'Asia/Tokyo');
  expectEq('temporary: registration is separate from timezone- scripts', await registered(), 'temporary-timezone');
  await proceed('t-live', { url: `${LOCAL}/p?s=t-reload` });
  expectAll('temporary: refresh applies from document_start; srcdoc follows, cross-origin iframe keeps config', await report('t-reload'), 'Asia/Tokyo', SYSTEM_TZ);

  expectEq('temporary: getStatus reports the override as desired while config is off', await statusOf(tabA),
    JSON.stringify({ desired: { timezone: 'Asia/Tokyo', temporary: true }, applied: 'Asia/Tokyo', temporary: 'Asia/Tokyo' }));

  await cdp('Target.createTarget', { url: `${LOCAL}/p?s=t-other` });
  expectAll('temporary: another tab on the same host stays on the system timezone', await report('t-other'), SYSTEM_TZ);

  await setConfig({ mode: 'rules', timezone: 'Europe/London', rules: [exclude('localhost')] });
  await proceed('t-reload', { live: 't-excluded' });
  expectEq('temporary: wins when config excludes the host (live)', (await report('t-excluded')).live, 'Asia/Tokyo');
  await setConfig({ mode: 'rules', timezone: 'Europe/London', rules: [include('localhost', 'America/New_York')] });
  await proceed('t-excluded', { live: 't-included' });
  expectEq('temporary: wins when config includes the host (live)', (await report('t-included')).live, 'Asia/Tokyo');
  await proceed('t-included', { url: `${LOCAL}/p?s=t-included-nav` });
  expectAll('temporary: wins over an include rule from document_start', await report('t-included-nav'), 'Asia/Tokyo', SYSTEM_TZ);
  await proceed('t-other', { live: 't-other-live' });
  expectEq('temporary: the other tab follows the include rule, not the override', (await report('t-other-live')).live, 'America/New_York');

  await setTemporary(tabA, null);
  await proceed('t-included-nav', { live: 't-ended' });
  expectEq('temporary: ending restores config (include rule) live', (await report('t-ended')).live, 'America/New_York');
  expectEq('temporary: ending removes the marker', await markerOf(tabA), null);
  expectEq('temporary: ending unregisters the script', await registered(), 'timezone-rule-0');
  await proceed('t-ended', { url: `${LOCAL}/p?s=t-ended-nav` });
  expectAll('temporary: refresh after ending follows config again', await report('t-ended-nav'), 'America/New_York', SYSTEM_TZ);

  await setTemporary(tabA, 'Asia/Tokyo');
  await proceed('t-ended-nav', { url: `${IP}/p?s=t-away` });
  const away = await report('t-away');
  expectEq('temporary: navigating to another origin falls back to config', away.early, SYSTEM_TZ);
  // sessionStorage is partitioned by top-level site, so the marked origin embedded elsewhere in this tab does not see the marker (config says New York).
  expectEq('temporary: iframe of the marked origin under another origin keeps config', away.frame, 'America/New_York');
  expectEq('temporary: registration stays until the tab closes', await registered(), 'temporary-timezone,timezone-rule-0');
  const tabTarget = (await cdp('Target.getTargets')).result.targetInfos.find((target) => target.url.includes('s=t-away'));
  await cdp('Target.closeTarget', { targetId: tabTarget.targetId });
  let leftover = '';
  for (let i = 0; i < 20; i++, await sleep(100)) if ((leftover = await registered()) === 'timezone-rule-0') break;
  expectEq('temporary: closing the tab removes the registration', leftover, 'timezone-rule-0');
  expectEq('temporary: session store is empty after closing', await evalSW(`chrome.storage.session.get('temporaryTabs').then((r) => JSON.stringify(r.temporaryTabs))`), '{}');
  await cdp('Target.closeTarget', { targetId: optionsTarget });

  // Chrome freezes background tabs (Memory Saver); injecting there waits for a thaw and must not stall later changes.
  await evalSW(`(() => { const set = chrome.action.setIcon.bind(chrome.action); chrome.action.setIcon = (d) => { globalThis.icon = d.path[16]; return set(d); }; })()`);
  const frozen = (await cdp('Target.createTarget', { url: `${IP}/p?s=frozen` })).result.targetId;
  await report('frozen');
  const { sessionId: frozenSession } = (await cdp('Target.attachToTarget', { targetId: frozen, flatten: true })).result;
  await cdp('Page.setWebLifecycleState', { state: 'frozen' }, frozenSession);
  await setConfig({ mode: 'global', timezone: 'Europe/London', rules: [] });
  expectEq('frozen tab: icon follows rules -> global', await evalSW('globalThis.icon'), 'icons/global-16.png');
  await setConfig({ mode: 'rules', timezone: 'Europe/London', rules: [include('localhost', 'Asia/Tokyo')] });
  expectEq('frozen tab: icon follows global -> rules', await evalSW('globalThis.icon'), 'icons/rules-16.png');
  await sleep(700);
  expectEq('frozen tab: later config still registers', await evalSW(`chrome.scripting.getRegisteredContentScripts().then(s => s.filter(x => x.id.startsWith('timezone-')).map(x => x.js[0]).join())`), 'timezones/Asia_Tokyo.js');
  // The popup must show the clock and a settled status even while another tab is frozen.
  await setConfig({ mode: 'global', timezone: 'Asia/Tokyo', rules: [] });
  await cdp('Target.createTarget', { url: `${IP}/p?s=popup` });
  await report('popup');
  // openPopup needs a focused window, which another app can take; focus it and retry until the popup target appears.
  let popup;
  for (let i = 0; i < 50 && !popup; i++, await sleep(200)) {
    if (i % 5 === 0) await evalSW(`chrome.windows.getLastFocused().then((w) => chrome.windows.update(w.id, { focused: true })).then((w) => chrome.action.openPopup({ windowId: w.id })).catch(() => {})`);
    popup = (await cdp('Target.getTargets')).result.targetInfos.find((t) => t.url.endsWith('/popup.html'));
  }
  if (!popup) throw new Error('popup did not open');
  const { sessionId: popupSession } = (await cdp('Target.attachToTarget', { targetId: popup.targetId, flatten: true })).result;
  await sleep(3000);
  const popupState = (await cdp('Runtime.evaluate', { returnByValue: true, expression:
    `[document.querySelector('.now-time')?.textContent ?? '', document.querySelector('.now-city')?.title, document.querySelector('.state')?.className].join('|')` }, popupSession)).result.result.value;
  expectEq('frozen tab: popup shows clock and settles status', popupState.replace(/^\d\d:\d\d/, 'HH:MM'), 'HH:MM|Asia/Tokyo|state ok');
  await setConfig({ mode: 'off', timezone: 'Europe/London', rules: [] });
  expectEq('frozen tab: icon follows rules -> off', await evalSW('globalThis.icon'), 'icons/off-16.png');
} finally {
  clearTimeout(watchdog);
  browser.kill();
  server.close();
}
console.log(results.every(Boolean) ? 'ALL PASS' : 'SOME FAILED');
process.exit(results.every(Boolean) ? 0 : 1);
