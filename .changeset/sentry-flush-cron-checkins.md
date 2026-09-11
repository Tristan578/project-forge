---
"web": patch
---

Flush Sentry's transport before a cron handler returns, so terminal check-ins actually send.

Vercel freezes a serverless function the moment its response returns, and Sentry's transport is asynchronous — so `withCronMonitor` recorded the terminal check-in and the process was frozen before it left. Sentry saw an `in_progress` check-in with no terminal one and reported "A timeout check-in was detected" every 15 minutes for 7 days, during which the health monitor read as quiet rather than unhealthy.

The flush runs in a `finally` so it covers the throw path too, and can never mask the handler's own result or error.
