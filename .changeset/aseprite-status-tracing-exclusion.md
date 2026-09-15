---
"web": patch
---

Deploys no longer fail with the `api/bridges/aseprite/status` function exceeding Vercel's 250 MB limit: the four public engine WASM packages are now excluded from every function's file trace instead of only the `execute` route's, since no server function reads them from disk. A test pins the wildcard exclusion.
