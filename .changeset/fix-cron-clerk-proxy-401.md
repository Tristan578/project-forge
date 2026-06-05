---
"web": patch
---

Allow Vercel Cron routes (`/api/cron/*`) through the Clerk proxy so the scheduled health-monitor isn't 401'd before its own `CRON_SECRET` check runs (#8605). The cron routes remain self-protected by their bearer secret.
