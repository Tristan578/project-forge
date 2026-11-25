---
"web": patch
---

Raise the root `sharp` manifest floor from ^0.35.4 to ^0.35.5, the release that fixes GHSA-wq5f-xc86-pv6w, so a lockfile-less install or a future relock cannot resolve a vulnerable sharp. The lockfile already resolved 0.35.5; only its root manifest entry changed. The `@modelcontextprotocol/sdk` floor in `mcp-server` is already ^1.32.2, above the requested ^1.32.0, so it is unchanged.
