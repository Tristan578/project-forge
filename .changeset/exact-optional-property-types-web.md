---
"web": patch
"@spawnforge/ui": patch
---

Enabled `exactOptionalPropertyTypes` in `web/tsconfig.json` (follow-up to #7592, which enabled it in `apps/docs`, `mcp-server` and `packages/ui`). Fixed every resulting compile error by widening optional fields to explicitly admit `undefined` where the omitted-vs-undefined distinction was already not meaningful to the code reading them (verified case by case against `??`/`?.`/`!== undefined` usage), by conditional-spreading values into vendor types that don't admit an explicit `undefined` (DOM `fetch`/`Response` options, `@ai-sdk/anthropic`, `dockview-react`, `sonner`, Playwright), and by adding a small `omitUndefinedValues` / `LoosePartial<T>` utility pair for patches that may carry an explicit `undefined` key.

Mostly a type-checking change, with these small runtime changes:
- `set_grid_2d` and `set_physics2d` drop explicit-`undefined` keys from the parsed arguments instead of overwriting the existing grid or physics settings with them (zod keeps an input key that is present with `undefined`).
- `generationStore.updateJob` drops explicit-`undefined` keys from the patch before merging, so a patch cannot erase a job's `dbId`, `usageId`, `resultUrl` and so on. No caller cleared a field that way.
- `taskStore.addTask` without a description, and a Twine choice passage with no prompt text, now omit the key instead of storing it with the value `undefined`. Reads see `undefined` either way.

`@spawnforge/ui`: `NumberField`'s `min` and `max`, `Input`'s `error` and `Button`'s `variant` are now typed `T | undefined`, so a consumer compiled with `exactOptionalPropertyTypes` can forward a maybe-undefined value. Passing `undefined` renders the same as omitting the prop (each component already reads them through a destructuring default, `??` or a truthiness check, all of which treat `undefined` and an absent key alike).
