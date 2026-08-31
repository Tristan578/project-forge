---
"web": patch
---

Fail the build when `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is set to a value that cannot work (#9044). A missing key still builds fine and degrades to "auth is not configured"; a malformed one — the whole `NAME=value` assignment pasted as the value, a secret key, stray whitespace — now names the specific mistake at build time instead of silently shipping a dead sign-in surface.
