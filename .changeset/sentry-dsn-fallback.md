---
"web": patch
---

Server-side `captureException` now accepts `NEXT_PUBLIC_SENTRY_DSN` as a
fallback, matching the Sentry init and the cron monitor. A deployment carrying
only the public variable used to initialise Sentry and register cron check-ins
while silently dropping every captured exception.
