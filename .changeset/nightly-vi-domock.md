---
"spawnforge": patch
---

Stabilize the nightly quality gate by replacing nested `vi.mock()` calls with `vi.doMock()` in 4 test files. `vi.mock` is statically hoisted to module scope by Vitest, so re-registering inside a function body after `vi.resetModules()` becomes a hard error in newer Vitest versions. The non-hoisted `vi.doMock()` is the correct primitive when re-registering after a module reset.

Affected test files:
- `src/app/api/bridges/aseprite/execute/route.test.ts`
- `src/lib/auth/__tests__/edge-cases.test.ts`
- `src/lib/bridges/__tests__/bridgeManager.test.ts`
- `src/lib/rateLimit/__tests__/distributed.test.ts`

No production behavior changes; tests pass with identical assertions.
