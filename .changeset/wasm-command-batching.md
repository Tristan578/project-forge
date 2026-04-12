---
'spawnforge': minor
---

Expose WASM command batching to JS: `sendCommandBatch` on useEngine hook, `dispatchCommandBatch` on store/context interfaces. Migrated entitySetupExecutor and autoPolishExecutor to batch dispatch with sequential fallback.
