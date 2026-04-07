---
"web": minor
---

Make creditTransactions inserts idempotent under retry with unique index and onConflictDoNothing. Add WASM CDN redundancy: fetchWithRetry with exponential backoff, same-origin fallback from Vercel static assets, retry button on InitOverlay error state, and PostHog/Sentry monitoring for CDN fallback events.
