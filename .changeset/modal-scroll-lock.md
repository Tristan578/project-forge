---
"@spawnforge/ui": patch
"web": patch
---

Modal dialogs now lock page scroll while open. Until now no modal in the app locked scroll on its own; a `body { overflow: hidden }` rule happened to mask this everywhere until PF-1017 (#9037) correctly scoped it to editor routes, which un-masked the defect on every public page. `Dialog` now uses a new, ref-counted `useScrollLock` hook that locks `document.documentElement` (never `body`, to avoid reopening the exact viewport bug PF-1017 fixed) for as long as at least one dialog is open, and restores the page's prior scroll state only when the last stacked dialog closes. Where the browser draws a classic (space-taking) scrollbar, the lock pads the page by the scrollbar's width so the content does not jump sideways when a dialog opens. `Dialog`'s body content now renders through `ScrollArea` and the panel is capped at `85vh`, so a dialog with tall content scrolls internally (and its scroll no longer chains into the locked document) instead of growing past the viewport.

This PR covers the shared `Dialog` primitive only. The ~13 ad-hoc, hand-rolled `fixed inset-0` overlays elsewhere in the app (community/marketplace/dashboard/settings/onboarding) do not yet consume this primitive and are unaffected; that migration is tracked separately.
