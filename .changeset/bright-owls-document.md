---
"web": patch
---

Restore the API reference and consented PostHog analytics by admitting their exact external origins in the routes that use them. PostHog needs BOTH of its origins: the ingest host takes the events, and a separate assets host serves every bundle posthog-js loads lazily (session recorder, surveys, exception autocapture, web vitals, remote config), so admitting only the first left those blocked. `posthog.init()` now states `asset_host` explicitly and both it and the policy read one shared constant, so the two cannot drift. Swagger UI assets are version-pinned and its CDN is allowed only on `/api-docs`.
