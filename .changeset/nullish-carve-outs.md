---
"web": patch
---

Audit the two `prefer-nullish-coalescing` ESLint carve-outs (`ignorePrimitives.string`, `ignoreIfStatements`) and remove both. Of 204 live findings, 64 are converted to `??`/`??=`, 135 stay `||` with a site-specific reason, and 5 are replaced by a type check. The full test suite caught one pair of sites (a WASM manifest hash and build-id fallback in `useEngine.ts`) where the conversion would have been a real regression; those stay `||`. Two behaviour fixes came out of review: importing a script library file now keeps only a string `description` and the string entries of a `tags` array, instead of storing whatever the file held and failing on the next search; and chat token estimates count an array `tool_result` body by its content instead of as `"[object Object]"`.
