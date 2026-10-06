---
"web": patch
"@project-forge/mcp-server": patch
---

Update three dependencies to their patched releases so the npm audit gate passes again. All three patched versions sit inside the ranges the manifests already declare, so this is a lockfile-only change with no application code changes.

- `sharp`, the image-optimisation backend Next.js uses for image handling (installed as a root development dependency and reached by Next.js through its optional dependencies), moves from 0.35.4 to 0.35.5 with libvips 1.3.4. This fixes GHSA-wq5f-xc86-pv6w, a vulnerability in the librsvg library inside sharp's platform binaries (CVE-2026-96889).
- `@modelcontextprotocol/sdk` moves from 1.30.1 to 1.32.0. This fixes GHSA-6qxp-vccf-f47h, where the SDK's OAuth client could send credentials to an authorization server chosen by the MCP server. The SpawnForge MCP server imports only the SDK's server, transport, types and validation modules, never its OAuth client, so nothing it runs changes.
- `shell-quote`, a development-only dependency reached through `@changesets/cli` and its `launch-editor` helper, moves from 1.10.0 to 1.12.0, fixing a command-injection advisory. It never ships in a build.
