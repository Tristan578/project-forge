---
"web": patch
---

chore(deps): bump npm minor-and-patch group (#8879) + relock @clerk/shared override

Routine minor/patch dependency group update: `@anthropic-ai/sdk` 0.105→0.107, `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` 3.1075→3.1076, `@clerk/nextjs` 7.5.7→7.5.10, `lucide-react` 1.0.1→1.22.0, `posthog-js` 1.395→1.396.2, `svix` 1.96.0→1.96.1, `@axe-core/playwright` 4.11.3→4.12.1, `@tailwindcss/postcss` 4.3.1→4.3.2, `portless` 0.14→0.15.

`@clerk/nextjs` 7.5.10 imports `isAutomatedEnvironment` from `@clerk/shared`, a symbol that only exists in `@clerk/shared` ≥ 4.22.1. The root `overrides` block pinned `@clerk/shared ^4.14.0`, so the build failed with `Export isAutomatedEnvironment doesn't exist in target module`. Bumped the override to `^4.22.1` (and the sibling `@clerk/nextjs` override to `^7.5.10`) and relocked the single root lockfile on Node 24, so the Clerk consumers resolve `@clerk/shared` 4.22.1 (and `@clerk/themes` keeps its compatible 3.47.x) with no invalid nodes.
