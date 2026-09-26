---
"web": patch
---

Migrated `web/vercel.json` to a typed `web/vercel.ts` (via `@vercel/config`), carrying over the same install/build commands, output directory, region, disabled git-triggered deploys, and health-monitor cron — so a future bad edit to this config now fails `tsc --noEmit` instead of silently misconfiguring the deploy.
