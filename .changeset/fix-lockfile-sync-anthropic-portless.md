---
"web": patch
---

fix(deps): resolve `package-lock.json` drift that broke `npm ci` (used by the Vercel preview-deploy job) repo-wide with EUSAGE.

- `@anthropic-ai/sdk`: lockfile still resolved `0.93.0` while `web/package.json` declared `^0.100.1` — synced the lockfile to `0.100.1` (no `engines` constraint; no runtime code imports it directly, the Anthropic path goes through `@ai-sdk/anthropic`).
- `portless`: a Dependabot bump set `web/package.json` to `^0.13.1`, but `portless@0.13.1` requires Node `>=24` while this repo targets Node 20 (`.nvmrc`, `engines ">=20 <25"`, all CI `node-version: 20`). The lockfile had never moved off the Node-20-compatible `0.12.0`. Reverted the declaration to `^0.12.0` to match, and added a `dependabot.yml` ignore for `portless >=0.13.1` so it can still advance to `0.13.0` (Node `>=20`) but won't re-grab the Node-24-only line until the repo adopts Node 24.

No source change.
