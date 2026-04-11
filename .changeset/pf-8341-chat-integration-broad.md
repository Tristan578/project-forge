---
'@spawnforge/web': patch
---

test(chat): broaden chat executor integration coverage to all 29 handler domains

- Adds `executorIntegrationBroad.test.ts` with 34 new tests covering every handler domain registered in `executor.ts` (previously only 5 of 29 had integration coverage via `executorIntegration.test.ts`).
- Uses the real Zustand `useEditorStore` instead of `vi.fn()` stubs, exercising the same dispatch path `chatStore.approveToolCalls` uses in production.
- Table-driven representative-tool test (`it.each`) plus a structural guard that fails loudly if a new handler domain is added to `executor.ts` without extending this list.
- End-to-end assertions for `spawn_entity`, `update_transform`, and `get_scene_graph` verify the real store is reached through the executor.
