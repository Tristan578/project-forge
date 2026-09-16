---
"@spawnforge/ui": minor
"web": minor
---

Add a token-driven `InlineAlert` primitive to `@spawnforge/ui` (warning / error / info variants, optional `id`, `role="alert"` for errors and `role="status"` for warnings and info) and migrate the editor's bespoke inline notice boxes to use it: the generation-unavailable notice, the feedback dialog error, the GDD panel error, the procedural-animation default-bones warning, and the engine init overlay's timeout and failure boxes. Notice colours now come from the shared theme tokens, so light/dark theming is handled once instead of per hardcoded amber/yellow Tailwind literal.
