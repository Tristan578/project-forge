---
"web": patch
---

Return a true HTTP 404 for a published-game URL that does not resolve. The `/play/[userId]/[slug]` page previously answered a missing, unpublished, or DB-unavailable game with HTTP 200 and a "Game Not Found" title — a soft-404 that search engines index. It now calls `notFound()` so crawlers and clients receive a real 404 status, with a colocated not-found boundary that preserves the existing "Game Not Found" presentation.
