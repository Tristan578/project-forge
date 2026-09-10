---
"web": patch
---

Upgrade vitest 4 -> 5 across every workspace, as one change (#9959).

Dependabot split the major into two PRs — `vitest` in #9772, `@vitest/coverage-v8` in #9771 — and neither can pass alone: `npm ci` fails with `ERESOLVE` before a single test runs, which is why lint, typecheck and all four suites read red on both. The red was an install failure, not test breakage.

vitest 5's jsdom makes `localStorage` and `document` getter-only on the window, so three test files that assigned over them now use `vi.stubGlobal` instead. One of them, `pwaGenerator.test.ts`, replaced `document` nine times and never restored it, leaking a fake document into every later file in the same worker; it now unstubs in `afterEach`. That leak predates the upgrade — vitest 5 is what made it visible.

No production code changed. Suite counts match the vitest-4 baseline: web 21302, packages/ui 621, apps/docs 178, mcp-server 490.
