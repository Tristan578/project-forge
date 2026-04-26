---
"web": patch
---

Stabilize two recurring nightly-quality-gate failures:

- `AccessibilityPanel` "cleans up keybindings on unmount" was racing the React render cycle under full-suite load. Wrapping the assertion in `vi.waitFor` makes it deterministic without changing component behavior.
- `EditorLayout` test suite failed end-to-end on a fresh clone because `@spawnforge/ui` exports from `dist/` (gitignored). Added a `pretest` step in `web/package.json` that builds the workspace package before vitest runs.
