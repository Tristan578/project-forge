---
"@spawnforge/ui": minor
"web": patch
---

Modal dialogs now lock page scroll while open. Until now no modal in the app locked scroll on its own; a `body { overflow: hidden }` rule happened to mask this everywhere until PF-1017 (#9037) correctly scoped it to editor routes, which un-masked the defect on every public page. `Dialog` now uses a new, ref-counted `useScrollLock` hook that locks `document.documentElement` (never `body`, to avoid reopening the exact viewport bug PF-1017 fixed) for as long as at least one dialog is open, and restores the page's prior scroll state only when the last stacked dialog closes. Where the browser draws a classic (space-taking) scrollbar, the lock pads the page by the scrollbar's width so in-flow content does not jump sideways when a dialog opens; `position: fixed` elements anchored to the right edge (such as the cookie banner) are not compensated and still shift by the scrollbar width while a dialog is open.

`useScrollLock(locked: boolean)` is new public API, exported from `@spawnforge/ui` so a hand-rolled overlay can take the same shared, ref-counted lock; that new export is why this is a minor bump for the package. `ScrollArea` now applies `overscroll-behavior: contain` for every consumer, so scrolling past the end of any scroll area no longer scrolls the page behind it, and it accepts a `ref` to its scroll container.

`Dialog`'s body content now renders through `ScrollArea` and the panel is capped at `85dvh` (the visible viewport, so it does not run under a mobile browser's toolbar), so a dialog with tall content scrolls internally instead of growing past the viewport. While that body overflows it is a focusable region named by the dialog title, so keyboard users can Tab to it and scroll it with the arrow keys; when a dialog opens, focus still goes to its first control, not to the scroll region. The quick-start dialog's approval gates no longer put a second scroll box inside the dialog: their summary scrolls with the dialog body, and the token cost with the Build it / Approve and Cancel buttons stays pinned to the bottom of the visible area.

This PR covers the shared `Dialog` primitive only. The ~13 ad-hoc, hand-rolled `fixed inset-0` overlays elsewhere in the app (community/marketplace/dashboard/settings/onboarding) do not yet consume this primitive and are unaffected; that migration is tracked separately.
