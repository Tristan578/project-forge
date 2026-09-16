---
"web": patch
---

Return a literal script-free HTTP404 document for missing or unpublished play URLs before App Router streaming starts. Database lookup failures instead return a no-store HTTP503 with Retry-After and no removal/noindex signal. Preserve proxy authentication cookies and CSP/security headers, omit HEAD bodies, and keep page-level notFound as an absence race guard while propagating lookup failures. Published URLs perform an additional metadata lookup during proxy preflight; metadata and body still share one lookup within their React server render. Separate browser and actual Neon/Drizzle transport regressions distinguish genuine absence from temporary failure.
