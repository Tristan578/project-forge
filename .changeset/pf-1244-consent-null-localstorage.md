---
"web": patch
---

Fix a crash on accepting cookie consent in Android WebViews that have DOM storage disabled. `hasConsented()` guarded only against a missing `window`, so a `window` whose `localStorage` is `null` threw `TypeError: Cannot read properties of null (reading 'getItem')` from PostHogProvider's storage listener. It now reads through `safeGetItem()`, which covers both that case and SSR, and denies consent rather than throwing.
