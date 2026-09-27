---
"web": patch
---

Enabled `exactOptionalPropertyTypes` in `web/tsconfig.json` (follow-up to #7592, which enabled it in `apps/docs`, `mcp-server` and `packages/ui`). This is a type-checking-only change: no runtime behavior changes. Fixed every resulting compile error by widening optional fields to explicitly admit `undefined` where the omitted-vs-undefined distinction was already not meaningful to the code reading them (verified case by case against `??`/`?.`/`!== undefined` usage), by conditional-spreading values into vendor types that don't admit an explicit `undefined` (DOM `fetch`/`Response` options, `@ai-sdk/anthropic`, `dockview-react`, `sonner`, Playwright), and by adding a small `omitUndefinedValues` / `LoosePartial<T>` utility pair for the few call sites that spread a zod-parsed partial patch over existing state, where an explicit `undefined` key would otherwise overwrite a real value on merge.
