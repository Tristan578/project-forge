---
"web": patch
"@project-forge/mcp-server": patch
"@spawnforge/docs": patch
---

Update two transitive dependencies to their patched releases so the npm audit gate passes again: `source-map-js` from 1.2.1 to 1.2.2 (GHSA-68fv-2mgg-jv7q, an event-loop denial of service through indexed source-map section offsets; reached through postcss in the web and docs builds) and `proxy-addr` from 2.0.7 to 2.0.8 (GHSA-jqcg-44mw-7w3h, IP spoofing through an IPv4-mapped IPv6 trust subnet; reached through express in the MCP server). Both bumps stay inside the ranges postcss and express already declare, so this is a lockfile-only change: no `package.json` range moves, nothing else in the tree resolves differently, and no application code changes. The only runtime change is the two patches themselves. `source-map-js` runs in the Tailwind/PostCSS build step and never ships in a bundle; `proxy-addr` is reached only through the MCP SDK's express dependency, whose OAuth router the MCP server does not import, so neither patched code path is exercised by first-party code.
