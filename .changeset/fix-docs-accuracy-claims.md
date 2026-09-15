---
"web": patch
---

Correct stale accuracy claims in the marketing use-cases pages and project docs: the RPG use-case now advertises the true count of drag-and-drop game components (13, not 12) and names only real components (Checkpoint and DialogueTrigger in place of the non-existent Inventory and NPC). The root README and CONTRIBUTING now describe the project as source-available (matching the BSL 1.1 LICENSE) rather than open-source and state that four WASM binaries are built per release, and the docs README documents the environment variable the code actually reads (NEXT_PUBLIC_DOCS_URL) and drops a build-dependency claim that no longer applies. A new test keeps the component count and named examples in sync with the engine's registry.
