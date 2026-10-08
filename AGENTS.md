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
- `scripts/build-content.mjs` — builds the standalone engine and bundled per-zone bootstraps. Runtime script registration uses package files rather than remote/generated executable code.
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
- Config changes update open documents; Off restores native behavior. Refresh existing pages for consistent results when their scripts cached old APIs.
