---
"web": patch
"@project-forge/mcp-server": patch
---

Update three dependencies to their patched releases so the npm audit gate passes again, all inside the ranges the manifests already declare, so this is a lockfile-only change with no application code changes. `sharp`, the image-optimisation backend behind Next.js image handling, moves from 0.35.4 to 0.35.5 (bundled libvips 1.3.4) and fixes GHSA-wq5f-xc86-pv6w, a vulnerability in the librsvg library inside its platform binaries (CVE-2026-96889). `@modelcontextprotocol/sdk` moves from 1.30.1 to 1.32.0 and fixes GHSA-6qxp-vccf-f47h, where the SDK's OAuth client could send credentials to an authorization server chosen by the MCP server; the SpawnForge MCP server does not use that OAuth client, so nothing it runs changes. `shell-quote`, a development-only dependency of Next.js's open-in-editor helper, moves from 1.10.0 to 1.12.0 and fixes a command-injection advisory; it never ships in a build.
