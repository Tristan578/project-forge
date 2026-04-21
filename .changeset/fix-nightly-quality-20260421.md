---
"@spawnforge/ui": patch
"web": patch
---

Fix EditorLayout test failure in clean checkouts by adding a `"development"` export condition to `@spawnforge/ui` pointing to TypeScript source. Vitest's jsdom config now resolves the workspace package directly from source without requiring a prior `dist/` build.
