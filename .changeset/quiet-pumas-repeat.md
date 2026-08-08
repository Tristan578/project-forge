---
"web": patch
---

Bound the outbound fan-out driven by the public `/health` page, fix healthy services rendering as "Unknown", and tighten the Clerk public-route patterns.

Rendering `/health` costs four outbound probes (Neon, engine CDN, Clerk, Anthropic). All three surfaces that can trigger it — the page, `GET /api/health` and `GET /api/status` — now read through a shared, in-flight-deduped report cache and charge a single shared fan-out budget, and only on a cache miss: a cached report is free to serve, so it no longer spends an allowance it never consumed. Over budget the two API routes return an honest 429 with `Retry-After`, while the page degrades to a neutral shell that polls `/api/health`.

Separately, the dashboard now translates the public `'up'` status back to the internal `'healthy'` at the client boundary. Without it, every healthy service card flipped from green "Healthy" to gray "Unknown" on the first 30s poll. Public-route patterns are now declared as an exact path plus a `/(.*)` subtree, since Clerk's vendored matcher treats a bare `(.*)` as a suffix wildcard with no path-segment boundary.
