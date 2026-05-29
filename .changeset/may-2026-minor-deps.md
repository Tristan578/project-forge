---
'web': patch
---

May 2026 routine minor/patch dependency updates (#8576) plus a `bevy_rapier3d` 0.34 compatibility audit (#8577).

Bumped within existing semver ranges: `@clerk/nextjs` 7.4.2 (and the root tree-wide override + `apps/docs` floor to match), `@neondatabase/serverless` 1.1.0, `@sentry/nextjs` 10.55.0, `@upstash/redis` 1.38.0, `ai` 6.0.193, `next` 16.2.6, `posthog-js` 1.376.4, `stripe` 22.2.0, `zod` 4.4.3, `zustand` 5.0.14, `@playwright/test` 1.60.0, and `vitest`/`@vitest/coverage-v8` 4.1.7 (kept lockstep at root + web).

The `stripe` 22.2.0 bump pins the SDK `ApiVersion` literal to `2026-05-27.dahlia`; updated `stripe-client.ts`, the three billing route tests, and the webhook comment to match (tsc would otherwise fail). No source/runtime behavior change beyond the dependency floors.
