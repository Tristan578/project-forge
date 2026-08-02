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
now mints one, forwards it to the page, and emits the matching policy; `'unsafe-inline'`
stays dropped. The Clerk Frontend API host is derived from the publishable key rather
than hardcoded, so dev and production instances both resolve correctly, and the decoded
value is validated as a bare hostname before it reaches the header.

Client-supplied `x-nonce`, `Content-Security-Policy` and `Content-Security-Policy-Report-Only`
request headers are stripped on every route, so a caller cannot hand the app a nonce of
their choosing — Next.js reads the nonce from either CSP header name.

Also fixes a related dev-server breakage on the 12 eval-free content routes: Next.js's
Fast Refresh runtime evaluates a string, which threw during module execution and aborted
hydration under `npm run dev`. `'unsafe-eval'` is now admitted for the dev server only,
gated on `NODE_ENV === 'development'`; production builds are unchanged.
