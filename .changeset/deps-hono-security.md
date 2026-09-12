---
"web": patch
---

Update `hono` to 4.13.7, closing three moderate advisories, and refresh `posthog-js`, `zod` and `@playwright/test`.

The Hono bump needed a manifest change, not just a lockfile refresh: a root `overrides` entry pinned it to an exact `4.13.0`, so no amount of `npm update` could move it. That pin is now a floor (`>=4.13.5`), matching how every sibling security override is written, so future patches flow without a manual bump.
