---
"web": patch
"@spawnforge/docs": patch
---

Upgrade Next.js from 16.4.3 to 16.4.5, the current stable release, in the editor and the documentation site, with `eslint-config-next` and `@next/bundle-analyzer` moved to 16.4.5 alongside it. 16.4.5 is the November 2026 Next.js security release. It fixes seven advisories, several of them in the `use cache` caching that the marketing pages use: cross-tenant and cross-user cache disclosure (GHSA-mfr8-8qww-v76h, GHSA-vc7v-qv4w-wrv8, GHSA-rhh4-g77r-r9qj), shared fallback-shell cache poisoning, stale compressed-response framing (GHSA-pc58-hwjq-p385), an HttpOnly cookie exposed through an internal header on Edge routes (GHSA-f3mh-rxg3-f5g2) and an SVG rejection bypass in image optimization (GHSA-7qx7-33qx-rqx2). Nothing in the editor, published games or the docs site looks or behaves differently.
