# Timezone Override (Chrome MV3 extension)

## Commands
- `npm run build` — typecheck (`tsc --noEmit`) + Vite build into `dist/` (load `dist/` as unpacked extension).
- `npm run dev` — `vite build --watch` (unminified, sourcemaps); reload the extension in chrome://extensions after changes.
- `npm test` — Vitest unit tests (`tests/`), covers rule resolution and config parsing.
- `npm run e2e` — builds, then drives a real Chromium via raw CDP (`e2e/run.mjs`). Requires `CHROMIUM=/path/to/binary`
  (Chromium or Chrome for Testing; branded Chrome ignores `--load-extension`). Do NOT drive the test tab with
  Playwright/Puppeteer: their own auto-attach deadlocks OOPIF loading once the extension's debugger auto-attaches too.

## Architecture
- `src/shared/resolve.ts` — pure `resolveTimezone(url, config)`: the single source of truth for which tz a URL gets.
- `src/background/overrider.ts` — owns all `chrome.debugger` sessions; `Emulation.setTimezoneOverride` on the tab,
  flat auto-attach (`waitForDebuggerOnStart`) to push the override into OOPIFs before they run.
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

## CDP facts verified by e2e (don't regress)
- Timezone override is renderer-process wide: dedicated workers inherit it. Only set it on `iframe` children;
  setting it on workers leaves stale per-process overrides ("Timezone override is already in effect").
- Emulation state persists across navigations of an attached tab, including cross-process ones.
- A fresh attach can lose the race against fast navigations; `reloadIfLate` reloads once if the new document
  already has `<script>` elements.
