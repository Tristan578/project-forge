---
"web": patch
---

Migrated `web/vercel.json` to a typed `web/vercel.ts` (via `@vercel/config`). Deploy behavior is unchanged — same install/build commands, output directory, region, disabled git-triggered deploys, and health-monitor cron — but a future bad edit to this config now fails `tsc --noEmit` instead of silently misconfiguring the deploy.
