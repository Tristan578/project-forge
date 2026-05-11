---
"spawnforge": patch
---

Hoist `@vitest/coverage-v8` to workspace root so the root `vitest` binary can resolve it during `--coverage` runs, fixing the nightly quality gate `ERR_MODULE_NOT_FOUND` failure (see #8533).
