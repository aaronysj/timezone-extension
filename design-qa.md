# Rule row design QA

final result: passed

Scope: the selected option 2, refined with an explicit exact/suffix scope menu. Existing general settings, rule resolution, locale support, and explicit Save and Apply flow are preserved.

## Evidence and normalization

- Source: projectless outputs/rule-row-designs/2-refined-scope.png, 1680 × 936.
- Implementation: outputs/rule-row-designs/implementation-scope.png, normal 1280 × 720 viewport screenshot, component panel 1036 CSS px wide.
- Same interaction state: first row's suffix scope menu is open, second row uses exact matching, three Shanghai rules, unsaved draft. The generated reference's `goder.com` typo is corrected to the existing product's `qoder.com`. Live clocks necessarily differ.
- Combined full-region evidence: comparison-final.png. Source panel and implementation panel normalized to 530px width using browser-rendered image frames. This is a single comparison input containing both artifacts.
- Combined readable detail evidence: comparison-focused.png. Source scaled to the implementation's panel density (1082/1680); implementation remains at its captured CSS size. Crop covers switches, domain typography, scope control, the expanded menu, and timezone entry.
- Additional states: implementation-timezone.png, implementation-mobile.png, production-options.png. Full-page production screenshot is density-scaled by the browser capture service; it is functional context only, not the fidelity comparison input.

## Findings, fixes, and final review

1. P2, initial column rhythm: the timezone column began too far right and used an excessively wide trigger. comparison-initial.png showed this drift. Changed the desktop grid to 38px / 1.15fr / 1.1fr / 140px / 94px, capped the zone trigger at 230px, and increased domain/scope font sizes. Recaptured and compared using comparison-final.png and comparison-focused.png. Resolved.
2. P2, initial comparison state mismatch: initial implementation was clean while source showed an unsaved draft. Recaptured with a staged exact-scope change, then reopened the first scope menu. Resolved in comparison-final.png.
3. P2, unified timezone interaction: an unfiltered first-open picker was visually excessive, and its inherited hint implied immediate application. Added an initial current/Tokyo/system shortlist while typed searches still search all zones, and a draft-specific hint. implementation-timezone.png confirms the three-entry initial state and explicit save wording. Resolved.

Required fidelity surfaces:

- Fonts/typography: system/PingFang fallback matches the reference's sans UI; 22px section heading, 16px semibold domain, 13px scope, tabular clocks. Long domains wrap; timezone labels truncate without hiding the offset. Focused comparison confirms a readable hierarchy.
- Spacing/layout: compact summary rows, aligned switches/domains/timezones/time/actions, restrained separators and panel padding. Scope and timezone popovers use the native top layer and viewport clamping. Existing add-scope checkbox intentionally adds a small amount of vertical space beyond the image's simplified add form.
- Colors/tokens: inherited cool paper, white surface, muted slate, teal selection and switches. System-timezone semantic tint retained; no new palette.
- Images/assets: no raster assets required. Bundled MIT Phosphor icons are real vector library assets, https://github.com/phosphor-icons/core. Reference's hand-drawn chevron/check style differs slightly in stroke (P3, acceptable).
- Copy/content: scope options explicitly explain exact hostname versus hostname plus all subdomains. All changes stay in a draft. No hardcoded Chinese UI copy; new keys ship in English, Chinese, Japanese, Korean. Preserve the real domains and live clocks.

## Interaction and responsive checks

Browser verified exact/suffix selection, a custom timezone search with keyboard commit, Save and Apply, domain editing, discard, deletion and undo. Preview saved-state readout showed zero storage writes before Save and one write after Save. Clean console on the production-bundle page.

At 390 × 844, document scrollWidth equals 390. Timezone popover measured x=58, width=320, y≈388, height≈330, inside the viewport. Temporary viewport override reset. 97 automated tests pass; production build passes. Browser uses a fixture Chrome storage API; native installed extension reload and its debugger application were not performed in this QA.

Implementation checklist: all P0/P1/P2 findings resolved; both overall and focused post-fix comparisons reviewed; primary interactions verified; local preview remains running. Remaining P3: exact icon stroke and native popover placement differ slightly from the generated mock; these do not impair the selected design or task flow.
