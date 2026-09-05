---
"@spawnforge/docs": patch
"web": patch
---

Docs: a malformed `NEXT_PUBLIC_DOCS_URL` no longer throws from `new URL()` while `proxy.ts` and the root layout load; it logs and falls back to the canonical origin. Web: removed the unreachable tool_use/tool_result pair-preservation branch from chat context truncation and replaced the test that could not fail.
