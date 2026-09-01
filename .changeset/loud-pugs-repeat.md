---
"web": patch
---

Take the minor/patch dependency group bump (32 packages), and carry the two fixes it needs to be green. Stripe 22.6.0 pins a new `ApiVersion` literal, so the hardcoded `apiVersion` string moves to `2026-08-26.dahlia` at all five sites that must agree (the client, the three billing route tests, and the webhook comment) — a stale literal is a TypeScript error, not a runtime one, so it took the production build and every E2E job down with it. Separately, `@sentry/nextjs` 10.72 began loading its build-time webpack plugin from the runtime server entry, and that plugin picks a browser code path whenever a global `document` exists; under jsdom it hands `fileURLToPath()` an `http:` URL and every one of the 132 test files that reaches Sentry fails at import. The vitest setup now stubs that build-only module, which nothing under `src/` uses.
