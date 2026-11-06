---
"web": patch
"@spawnforge/docs": patch
---

Public copy now claims only what production delivers. The Starter, Creator and Studio plan bullets, the FAQ, the About, use-case, compare and blog pages, the site JSON-LD, `llms.txt`/`llms-full.txt` (which also quoted a $99 plan and features that do not exist) and the docs site no longer promise platform-funded asset generation, asset generation through your own provider key, platform AI keys, hosted external-MCP access or AI sprite generation. They say "coming after launch" instead (the Starter bullet renders with the X icon, and "What's New" no longer lists AI asset generation), driven by three flags in `lib/config/publicCapabilities.ts` and pinned by a test.
