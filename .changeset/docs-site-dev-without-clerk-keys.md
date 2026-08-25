---
"@spawnforge/docs": patch
---

The documentation site starts again in local development without Clerk keys. Its
root layout wrapped the page in Clerk's provider unconditionally, which used to
be harmless — a missing key quietly took Clerk's keyless path. The current Clerk
release turns that same path into a hard error, so `npm run dev` failed outright
for anyone who had not set up Clerk locally. The layout now checks for a
well-formed key first, exactly as the main app has always done.

The `/sign-in` route is covered too. It is public, and it renders Clerk's sign-in
widget, which needs the provider the layout now skips — so guarding the layout
alone would have moved the failure to that one route instead of removing it. It
now explains that authentication is not configured rather than erroring.
