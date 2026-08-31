---
"web": patch
---

Fix a regression from #9539: the Clerk publishable-key guard rejected a working key that carried surrounding whitespace, failing the docs production deploy. Clerk trims, so the value is trimmed before validation and whitespace is now a non-blocking warning instead of a build failure.
