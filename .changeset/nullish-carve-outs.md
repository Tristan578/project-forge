---
"web": patch
---

Audit the two `prefer-nullish-coalescing` ESLint carve-outs (`ignorePrimitives.string`, `ignoreIfStatements`) and remove both, converting 73 of 204 live findings to `??`/`??=` and annotating the remaining 131 with a site-specific reason. No intentional runtime behavior change; the full test suite caught one pair of sites (a WASM manifest hash and build-id fallback in `useEngine.ts`) where the conversion would have been a real regression, and those were reverted to `||` before landing.
