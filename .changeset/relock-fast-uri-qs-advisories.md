---
"web": patch
---

Relock `fast-uri` to 3.1.7 (four HIGH SSRF / host-confusion advisories published 2026-09-02 against 3.1.5, reachable through `ajv`) and `qs` to 6.16.0 (two MODERATE advisories, reachable through the MCP server's `express`). Lockfile-only; no manifest ranges changed and no audit waiver added.
