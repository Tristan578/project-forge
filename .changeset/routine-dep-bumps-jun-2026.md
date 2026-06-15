---
'web': patch
---

Routine minor/patch dependency bumps from the June 2026 changelog review (no breaking changes): `ai` 6.0.193→6.0.205, `stripe` 22.2.0→22.2.1 (ApiVersion literal `2026-05-27.dahlia` unchanged), `posthog-js` 1.376.4→1.386.6, and `vitest`/`@vitest/coverage-v8` 4.1.7→4.1.8 (co-bumped together — they are reciprocal exact peers — in BOTH the root and `web` manifests so the single hoisted copy stays collapsed; bumping only `web` would split 4.1.7 hoisted / 4.1.8 nested). Root `package-lock.json` regenerated and verified idempotent against the Lockfile Sync gate.

Deferred from this batch (tracked as follow-ups under #8777):
- `next` 16.2.6→16.2.9 — held back. The `apps/docs` workspace still pins `next ^16.2.3` and the bump must be regenerated on the repo's Node 24 toolchain; regenerating the single-root lockfile on Node 25 nests `postcss@8.4.31` under `next`, bypassing the root `next.postcss >=8.5.10` override. Bump alongside `apps/docs` on the CI toolchain.
- `@clerk/nextjs` 7.4.2→7.5.2 — held back. The root `package.json` `overrides` pin `@clerk/nextjs ^7.4.2` / `@clerk/shared ^4.14.0` deliberately, and 7.5.2 pulls `@clerk/shared 4.17.1` which removes `baseTheme` from the `Appearance` type (TS2353 against `web/src/app/layout.tsx`). Requires migrating the Clerk appearance API before the override can lift.
