---
"web": patch
---

Migrated `web/vercel.json` to a typed `web/vercel.ts` and added `@vercel/config` as a dependency of `web`. Deploy behaviour is unchanged: every value the JSON declared is preserved verbatim — `framework: nextjs`, the `cd .. && npm ci && npm run build --workspace=packages/ui` install command, `npm run build`, the `.next` output directory, the `iad1` region, `git.deploymentEnabled: false`, and the `/api/cron/health-monitor` cron on `*/15 * * * *`. The gain is that a typo'd or removed property now fails `tsc --noEmit` instead of silently misconfiguring the deploy.
