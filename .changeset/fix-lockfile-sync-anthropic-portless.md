---
"web": patch
---

fix(deps): resolve a root `package-lock.json` drift that broke frozen `npm ci` repo-wide with EUSAGE (the Vercel preview-deploy job and every Quality Gates job that runs `npm ci` as setup).

- `@anthropic-ai/sdk`: the lockfile still resolved `0.93.0` while `web/package.json` declared `^0.100.1` — synced the lockfile to `0.100.1` (no `engines` constraint; no runtime code imports it directly, the Anthropic path goes through `@ai-sdk/anthropic`).
- `portless`: `web/package.json` declares `^0.13.0`, but the root lockfile had drifted — it still pinned the Node-20-era `0.12.0`, which does **not** satisfy `^0.13.0`, so frozen `npm ci` failed with `EUSAGE Missing: portless@0.13.x from lock file`. Regenerated the root lockfile to `portless@0.13.1`, the newest line satisfying `^0.13.0`, which requires Node `>=24`. That is correct for this repo — it targets Node 24 (`.node-version` = `24`, `engines.node` `">=24 <25"`). This is a **forward-fix to match the manifest, not a revert**, and no `dependabot.yml` ignore is involved.

No source change.
