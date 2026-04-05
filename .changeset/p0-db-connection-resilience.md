---
"spawnforge": minor
---

Add DB connection resilience infrastructure: wrap all 48+ raw getDb() callsites with queryWithResilience (circuit breaker + retry), add Upstash sliding-window DB rate limiter, 503 graceful degradation handler, client-side 503 toast with auto-retry, health endpoint circuit breaker stats. Fix P1 quick wins: silent Redis fallback now reports to Sentry, tsc OOM on Node 25.x, single-HTML export CDN failure, export scene data completeness.
