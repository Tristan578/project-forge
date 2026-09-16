---
"web": patch
---

Return a literal script-free HTTP404 document for missing, unpublished, or database-unavailable play URLs before App Router streaming starts. Preserve proxy authentication and CSP/security headers, omit HEAD bodies, and keep page-level notFound as a race guard. Published URLs perform an additional metadata lookup during proxy preflight; metadata and body still share one lookup within their React server render. Browser regressions now verify document/crawler/HEAD404, the actual error presentation, and absence of player/game metadata.
