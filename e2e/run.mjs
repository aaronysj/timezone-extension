// End-to-end check against a real Chromium with the built extension loaded (`npm run build` first).
// No CDP client touches the test tab: pages report to this server and navigate themselves,
// so the only debugger on the tab is the extension's own.
//
// Usage: CHROMIUM=/path/to/chromium npm run e2e
// Branded Google Chrome ignores --load-extension since v137; use Chromium / Chrome for Testing.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const EXT = path.resolve(import.meta.dirname, '../dist');
const CHROMIUM = process.env.CHROMIUM;
if (!CHROMIUM) throw new Error('Set CHROMIUM to a Chromium / Chrome for Testing binary');
const SYSTEM_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- test server -----------------------------------------------------------
const reports = new Map(); // step -> documents that reported (a reload yields 2)
const reportWaiters = new Map();
const nextWaiters = new Map();

const page = (host, other, step) => `<!doctype html><script>
  const out = { step: '${step}', early: Intl.DateTimeFormat().resolvedOptions().timeZone };
  const w = new Worker(URL.createObjectURL(new Blob(['postMessage(Intl.DateTimeFormat().resolvedOptions().timeZone)'])));
  const within = (p) => Promise.race([p, new Promise((r) => setTimeout(() => r('TIMEOUT'), 4000))]);
  const post = (d) => fetch('/report', { method: 'POST', body: JSON.stringify(d) });
  const frame = new Promise((r) => addEventListener('message', (e) => e.data.frame && r(e.data.frame)));
  const worker = new Promise((r) => (w.onmessage = (e) => r(e.data)));
  const load = new Promise((r) => addEventListener('load', () => r(true)));
  (async () => {
    [out.frame, out.worker, out.load] = await Promise.all([frame, worker, load].map(within));
    await post(out);
    for (;;) {
      const n = await (await fetch('/next?s=' + out.step)).json();
      if (!n.live) return void (location.href = n.url);
      await post({ step: n.live, live: Intl.DateTimeFormat().resolvedOptions().timeZone });
      out.step = n.live;
    }
  })();
</script><iframe src="http://${other}/frame"></iframe>`;

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
  if (url.pathname === '/frame')
    return res.end(`<script>parent.postMessage({ frame: Intl.DateTimeFormat().resolvedOptions().timeZone }, '*')</script>`);
  const { port } = server.address();
  const other = req.headers.host.startsWith('localhost') ? `127.0.0.1:${port}` : `localhost:${port}`;
  res.end(page(req.headers.host, other, url.searchParams.get('s')));
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
  `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check',
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

let sw;
for (let i = 0; i < 100 && !sw; i++, await sleep(100))
  sw = (await cdp('Target.getTargets')).result.targetInfos.find((t) => t.type === 'service_worker' && t.url.endsWith('/background.js'));
if (!sw) throw new Error('extension service worker not found');
const { sessionId } = (await cdp('Target.attachToTarget', { targetId: sw.targetId, flatten: true })).result;
const evalSW = async (expression) =>
  (await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId)).result?.result?.value;
for (let i = 0; i < 50 && !(await evalSW('!!globalThis.chrome?.storage')); i++) await sleep(100);
const setConfig = async (config) => { await evalSW(`chrome.storage.local.set({ config: ${JSON.stringify(config)} })`); await sleep(300); };
const include = (pattern, timezone) => ({ id: pattern, enabled: true, action: 'include', match: 'suffix', pattern, timezone });
const exclude = (pattern) => ({ id: `x-${pattern}`, enabled: true, action: 'exclude', match: 'exact', pattern });

// ---- scenarios ---------------------------------------------------------------
const results = [];
function expectAll(name, r, tz) {
  const actual = { early: r.early, frame: r.frame, worker: r.worker, load: r.load };
  const expected = { early: tz, frame: tz, worker: tz, load: true };
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  results.push(pass);
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${r.docs > 1 ? ' (reloaded)' : ''}: ${JSON.stringify(actual)}`);
}
function expectEq(name, actual, expected) {
  const pass = actual === expected;
  results.push(pass);
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}: ${actual}${pass ? '' : ` (expected ${expected})`}`);
}

const watchdog = setTimeout(() => { console.log('TIMEOUT'); browser.kill(); process.exit(1); }, 60000);
try {
  await setConfig({ mode: 'global', timezone: 'Asia/Tokyo', rules: [] });
  await cdp('Target.createTarget', { url: `${IP}/p?s=1` });
  expectAll('global: new tab', await report('1'), 'Asia/Tokyo');

  await setConfig({ mode: 'rules', timezone: 'Asia/Tokyo', rules: [include('localhost', 'America/New_York')] });
  await proceed('1', { url: `${IP}/p?s=2` });
  expectAll('rules: unmatched host', await report('2'), SYSTEM_TZ);
  await proceed('2', { url: `${LOCAL}/p?s=3` });
  expectAll('rules: navigate into matched host', await report('3'), 'America/New_York');
  await proceed('3', { url: `${LOCAL}/p?s=4` });
  expectAll('rules: matched -> matched', await report('4'), 'America/New_York');
  await proceed('4', { url: `${IP}/p?s=5` });
  expectAll('rules: matched -> unmatched', await report('5'), SYSTEM_TZ);

  await setConfig({ mode: 'rules', timezone: 'Asia/Tokyo', rules: [include('localhost'), exclude('localhost')] });
  await proceed('5', { url: `${LOCAL}/p?s=6` });
  expectAll('rules: exclude beats include', await report('6'), SYSTEM_TZ);

  await setConfig({ mode: 'global', timezone: 'Europe/London', rules: [] });
  await proceed('6', { live: '7' });
  expectEq('live: open page picks up config change', (await report('7')).live, 'Europe/London');
  await proceed('7', { url: `${IP}/p?s=8` });
  expectAll('global: after live change', await report('8'), 'Europe/London');

  await setConfig({ mode: 'off', timezone: 'Europe/London', rules: [] });
  await proceed('8', { url: `${LOCAL}/p?s=9` });
  expectAll('off: system timezone', await report('9'), SYSTEM_TZ);
} finally {
  clearTimeout(watchdog);
  browser.kill();
  server.close();
}
console.log(results.every(Boolean) ? 'ALL PASS' : 'SOME FAILED');
process.exit(results.every(Boolean) ? 0 : 1);
