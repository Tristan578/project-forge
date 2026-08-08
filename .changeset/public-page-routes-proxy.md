---
"web": patch
---

Make `/docs`, `/health`, `/robots.txt`, `/sitemap.xml` and the root/pricing OpenGraph images reachable without a session. Each rendered for anonymous visitors by design but was missing from the proxy's public-route matcher, so every one of them redirected to sign-in. `/health` now serves a shared TTL-cached health report with in-flight request dedup, so the public dashboard cannot amplify one inbound request into ten outbound service probes; `/api/status` uses the same cache.
