---
"web": patch
---

Scope `'unsafe-eval'` out of the public content routes' and `/play`'s
Content-Security-Policy (#8612, #8634).

The global `script-src` previously granted `'unsafe-eval'` to every route. It is
genuinely required only on the editor surface (`/dev`, `/editor/:path*`), where
the in-editor script sandbox compiles user scripts with the `Function()`
constructor inside a same-origin worker that inherits the document CSP —
`'wasm-unsafe-eval'` does not cover `eval`/`Function`. The CSP builder is now
extracted to `src/lib/security/csp.ts`, and the script-free public content routes
(`/community`, `/blog`, `/about`, `/pricing`, `/docs`, … — the user-generated
-content surface the findings call out) plus the published-game surface (`/play`)
receive tightened, eval-free policies.

The route scoping had to be corrected to actually take effect. Next.js applies
every matching `headers()` rule and the **last** writer of a duplicate header key
wins — it is not a browser-style intersection of multiple CSP headers. The
tightened overrides were previously listed *before* the permissive global
`/:path*` rule, so the global rule silently overrode them and `'unsafe-eval'`
stayed live on both the content routes and `/play`. The ordered rule list is now
the single source of truth in `src/lib/security/csp.ts` (global first, overrides
after) with the ordering + per-route effective policy unit-tested, so a future
reordering fails CI instead of silently reopening the hole.

`'unsafe-inline'` is retained on the editor/content routes: it is required by
Clerk and Next.js inline framework scripts, and a nonce-based migration would
break this app's statically rendered pages (the same failure mode that forced SRI
removal). `/play` carries neither `'unsafe-eval'` nor `'unsafe-inline'` since a
played game runs only first-party code + WASM. Fully dropping `'unsafe-eval'`
everywhere would require re-architecting the editor script sandbox onto a
cross-origin/blob worker with its own CSP — tracked separately.
