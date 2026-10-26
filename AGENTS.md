# Timezone Override (Chrome MV3 extension)

## Commands
- `npm run build` — typecheck (`tsc --noEmit`) + Vite build into `dist/` (load `dist/` as unpacked extension).
- `npm run dev` — watches both UI/background and the MAIN-world engine (unminified, sourcemaps); reload the extension in chrome://extensions after changes.
- `npm test` — Vitest unit tests (`tests/`), including native Date comparisons in separate timezone processes.
- `npm run e2e` — builds, then drives a real Chromium via raw CDP (`e2e/run.mjs`). Requires `CHROMIUM=/path/to/binary`
  (Chromium or Chrome for Testing; branded Chrome ignores `--load-extension`). Tests use an isolated headless profile
  (headless keeps `chrome.action.openPopup` working when another app has OS focus).
  `EXT=/path/to/unzipped` runs it against another build (e.g. a store zip) instead of `dist/`.
- Release zips must be rebuilt from the commit being shipped and pass `npm run e2e`; 0.2.0 shipped a stale
  pre-fix build whose popup clock stayed blank whenever Memory Saver had frozen any tab.

## Architecture
- `src/shared/resolve.ts` — pure `resolveTimezone(url, config)`: the single source of truth for which tz a URL gets.
- `src/background/registrations.ts` — compiles resolver precedence into mutually exclusive persistent MAIN-world `document_start` content scripts.
- `src/background/overrider.ts` — registers those scripts and applies configuration changes to existing frame documents.
- `src/content/timezone.ts` — self-contained Date/Intl shim; Chrome serializes it for live updates. Keep all runtime dependencies inside the function.
- `scripts/build-content.mjs` — builds the standalone engine (`timezone-content.js`), the temporary-override entry (`timezone-temporary.js`) and bundled per-zone bootstraps. Runtime script registration uses package files rather than remote/generated executable code.
- `src/background/temporary.ts` — per-tab temporary override: the `temporaryTabs` entries, the sessionStorage marker and the single `temporary-timezone` registration (see Page API coverage);
  `src/shared/temporary.ts` holds the entry type/origin rules shared with the popup. `src/background/status.ts` merges the page probe, the entry and config for `getStatus`.
- `src/background/index.ts` — wiring: navigation/tab events -> resolve -> `overrider.apply`.
- `src/popup`, `src/options` — vanilla TS DOM UI, helpers in `src/ui/dom.ts`. Config lives in `chrome.storage.local` key `config`.
- Toolbar icon reflects `config.mode` globally (`off` grey / `global` teal / `rules` indigo; `updateIcon` in
  `src/background/index.ts`), not per-tab status — that lives in the popup. Keep icon elements minimal: 16px is tiny.
  The SVG template lives in `scripts/icons.mjs`; `node scripts/icons.mjs` writes `assets/{mode}.svg` and
  `public/icons/{mode}-{size}.png` via `@resvg/resvg-js` (MV3 icons must be PNG).

## i18n
- Native `chrome.i18n`: catalogs in `public/_locales/{en,zh_CN,ja,ko}/messages.json`, `en` is `default_locale`.
  Use `t(key, ...subs)` from `src/shared/i18n.ts`; keys are typed from the `en` catalog. No UI copy in source
  (`tests/i18n.test.ts` enforces key parity, no unused keys, no CJK literals).
- Substitutions are positional `$1`..`$9`. Never write two adjacent (`$1$2`): Chrome reads `$1$` as an undeclared
  named placeholder and refuses to load the whole extension.
- Dates/zone names follow `intlLocale()` (the catalog Chrome picked), so zh-TW UI falls back to English consistently.
  Chinese city names show only in a Chinese UI but stay searchable everywhere.
- Tests stub `chrome.i18n` with the zh_CN catalog (`tests/i18n-mock.ts`), so UI assertions use Chinese copy.

## Page API coverage verified by tests
- Product versions use `chrome.scripting` and HTTP(S) host permissions. The user requires no debugger banner; keep the product free of `chrome.debugger`.
- Registered scripts run before page scripts, including under strict page CSP. Iframes follow their own URL rules; inherited-origin frames use Chrome's origin fallback.
- Date local constructors, parsing, getters/setters and default Intl formatting follow the selected zone, including DST folds/gaps. UTC APIs and explicit Intl timezones stay unchanged.
- Workers retain their native timezone. Cached native methods and already-created Intl formatters may retain their original behavior. Keep this limitation visible in Settings and store descriptions.
- Temporary per-tab override (popup, any mode): a content script can only match URLs, never tabs, and the per-tab alternative is `chrome.debugger`, so the tab is
  marked in the page's `sessionStorage` key `timezone-override.temporary` (IANA zone; isolated per tab+origin, kept across reloads, gone with the tab, readable at `document_start`).
  **The background's entry is the source of truth**: `chrome.storage.session` key `temporaryTabs` maps tabId -> `{ origin, timezone }` (`TemporaryTabs`), and a tab only has an override
  while its page origin equals the entry's origin (`temporaryZone`; sessionStorage is per origin, so another scheme or port is another page). The marker is just a transport for reloads and is never trusted by anything else: `Overrider.apply` and `getStatus` use the
  entry (explicit zones; the marked origin and its same-origin/inherited frames follow, cross-origin frames keep config), `installTimezone`/`restoreNative` never read the marker, and stale or forged markers
  (after End, an origin switch, session restore, a page writing the key) are inert. Only the background writes it, via `executeScript` pinned to the top frame's `documentId` (a page still navigating gets an error), after the entry is registered (a refused marker rolls the entry back).
  One registered script `temporary-timezone` (its own file `timezone-temporary.js` from `content/temporary.ts`; hosts of entries, `persistAcrossSessions: false`) makes reloads work from `document_start`: it is the only reader of the marker
  (config scripts run `content/main.ts` with a pending zone and ignore it). It must not share `timezone-content.js`: Chrome injects a file once per document, so a config rule on the same host would swallow it. Its id must not start with `timezone-`, or `Overrider.configure` unregisters it. Other tabs on the same host run it but find no marker.
  The marker is validated with `Intl.DateTimeFormat` and `try/catch` (page-tamperable, throws in sandboxed frames). `TemporaryTabs.sync` runs at every worker start (extension reloads clear session storage but keep the
  registration) and prunes closed tabs; `tabs.onReplaced` moves the entry. A desired temporary zone outranks config even when mode is off; the toolbar icon stays global.
  `getStatus` skips the page probe for pages that run natively (`needsProbe`), since the popup polls every second.
- Temporary override limits: the marker is page-visible, and a page can only change its own Date/Intl with it, which it could do anyway; `sessionStorage.clear()` only costs the document_start path (the commit-time apply re-installs from the entry, late), and "Duplicate tab" copies the marker but has no entry, so the commit-time apply puts it back on config;
  the first activation is injected after load (rendered content and cached Date/Intl stay, a reload makes it complete); workers stay native; it does not survive a browser restart or session restore (entry and registration are gone, the restored marker is inert);
  a stale marker left on an earlier origin of the same tab is inert unless another tab keeps that host registered, in which case the first scripts see it until the commit-time apply corrects it;
  it is removed with the tab or on "End" (only the current origin's marker can be cleaned). e2e verifies the real-browser behavior, including that the marked origin embedded as an iframe under another origin does not see the marker (sessionStorage is partitioned by top-level site).
- Config changes update open documents; Off restores native behavior. Refresh existing pages for consistent results when their scripts cached old APIs.
