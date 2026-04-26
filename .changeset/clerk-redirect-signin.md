---
"web": patch
---

Fix protected routes (`/dashboard`, `/dev`, `/settings`, `/editor`, etc.) returning hard 404 to signed-out browser visitors. Clerk v3+ middleware made `auth.protect()` rewrite to `/404` by default (route-enumeration mitigation), which left users with no recovery path. The proxy now calls `redirectToSignIn({ returnBackUrl })` for browser nav and returns 401 JSON for `/api/*` requests, restoring the original UX and unblocking the production smoke test. Resolves #8529.
