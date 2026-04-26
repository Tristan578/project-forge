---
"web": patch
---

Stabilize two recurring nightly-quality-gate failures:

- `AccessibilityPanel` "cleans up keybindings on unmount" was racing the React render cycle under full-suite load. Wrapping the assertion in `vi.waitFor` makes it deterministic without changing component behavior.
- `EditorLayout` test suite failed end-to-end on a fresh clone because `@spawnforge/ui` exports from `dist/` (gitignored). Extracted the workspace build into a `build:ui` script and wired `pretest`, `pretest:changed`, and `pretest:watch` hooks so every test variant — not just `npm run test` — guarantees the package is built before vitest runs.
