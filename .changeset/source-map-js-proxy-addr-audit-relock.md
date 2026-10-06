---
"web": patch
"@project-forge/mcp-server": patch
---

Update two transitive dependencies to their patched releases so the npm audit gate passes again: `source-map-js` from 1.2.1 to 1.2.2 (GHSA-68fv-2mgg-jv7q, an event-loop denial of service through indexed source-map section offsets; reached through postcss in the web build) and `proxy-addr` from 2.0.7 to 2.0.8 (GHSA-jqcg-44mw-7w3h, IP spoofing through an IPv4-mapped IPv6 trust subnet; reached through express in the MCP server). Both bumps stay inside the ranges the dependents already declare, so nothing about what either package runs changes.
