---
"web": patch
---

Fix published games rendering blank at `/play/*` (PF-1018).

The `/play` Content-Security-Policy set `script-src 'self' 'wasm-unsafe-eval'` with
neither a nonce nor `'unsafe-inline'`. Next.js bootstraps App Router hydration with
inline `<script>` tags, so every one of them was blocked: the server HTML painted and
hydration never ran, leaving every published game stuck on a blank/loading page. It
failed silently — nothing threw server-side.

`/play` is dynamically rendered, so it can carry a real per-request nonce. The proxy
now mints one, forwards it to the page, and emits the matching policy.

Scope note: this does not yet prove `'unsafe-inline'` is gone from `/play` in
production. `next.config.ts` also emits a static rule for that header — including a
global `/:path*` rule that already carries `'unsafe-inline'` site-wide — and which
writer the browser sees on Vercel is unverified (preview deployments sit behind SSO,
which redirects before middleware runs, so it could not be measured). The guaranteed
bound is that `/play` either runs the nonce policy or runs the same inline posture as
every other page — parity, never a regression — and cannot lose both, which is what
caused the blank page. Measuring the real winner is tracked separately.

The proxy also now runs on every `/play` URL: the matcher's static-file extension
exclusion previously skipped a user-chosen game slug ending in `.html`/`.js`/`.css`,
which rendered a real HTML document with no nonce and no header stripping.

The Clerk Frontend API host is derived from the publishable key rather
than hardcoded, so dev and production instances both resolve correctly, and the decoded
value is validated as a bare hostname before it reaches the header.

Client-supplied `x-nonce`, `Content-Security-Policy` and `Content-Security-Policy-Report-Only`
request headers are stripped on every route, so a caller cannot hand the app a nonce of
their choosing — Next.js reads the nonce from either CSP header name.

Also fixes a related dev-server breakage on the 12 eval-free content routes: Next.js's
Fast Refresh runtime evaluates a string, which threw during module execution and aborted
hydration under `npm run dev`. `'unsafe-eval'` is now admitted for the dev server only,
gated on `NODE_ENV === 'development'`; production builds are unchanged.
