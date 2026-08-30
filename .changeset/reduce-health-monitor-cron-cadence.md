---
"web": patch
---

Reduce the `/api/cron/health-monitor` Vercel cron from every 5 minutes to every 15 minutes (#9531), cutting ~5,760 function invocations per month. The registry mirror in `cronMonitors.ts` moves in lockstep, and the parity suite now asserts a 4-runs-per-hour ceiling for every declared cron.
