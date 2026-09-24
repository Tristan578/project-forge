---
"web": patch
---

Load the engine on `/play` from the engine CDN (#7580).

The public play page hardcoded the same-origin `/engine-pkg-*` path and never consulted `NEXT_PUBLIC_ENGINE_CDN_URL`, so every player downloaded the WASM engine through the Vercel origin while the editor already used the CDN. The play loader now resolves the same ordered list the editor does — the versioned CDN prefix when `NEXT_PUBLIC_ENGINE_VERSION` is set, `/latest/` otherwise, then same-origin — and falls through to the next origin when a load fails or exceeds its own deadline, so a CDN outage (or a stalled CDN) degrades to today's behaviour rather than a broken page. A skipped origin is reported to Sentry from the play page so a misconfigured CDN is visible rather than silently slow. With no CDN configured nothing changes.

Also records, in `docs/decisions/2026-09-23-published-game-hosting.md`, that published games are served through the status-gated play API from the immutable publication snapshot and that a public CDN copy of the scene is a deliberate non-goal, and documents `cdnUrl` (the play-page path) where API consumers can see it.
