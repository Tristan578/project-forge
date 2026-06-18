---
"web": patch
---

Scope `'unsafe-eval'` out of the public content routes' Content-Security-Policy
(#8612, #8634).

The global `script-src` previously granted `'unsafe-eval'` to every route. It is
genuinely required only on the editor surface (`/dev`, `/editor/:path*`), where
the in-editor script sandbox compiles user scripts with the `Function()`
constructor inside a same-origin worker that inherits the document CSP —
`'wasm-unsafe-eval'` does not cover `eval`/`Function`. The CSP builder is now
extracted to `src/lib/security/csp.ts`, and the script-free public content routes
(`/community`, `/blog`, `/about`, `/pricing`, `/docs`, … — the user-generated
-content surface the findings call out) receive a tightened policy with
`'unsafe-eval'` removed, emitted alongside the global policy so browsers enforce
the most-restrictive intersection (the same mechanism `/play` already uses).

`'unsafe-inline'` is retained: it is required by Clerk and Next.js inline
framework scripts, and a nonce-based migration would break this app's statically
rendered pages (the same failure mode that forced SRI removal). Fully dropping
`'unsafe-eval'` everywhere would require re-architecting the script sandbox onto
a cross-origin/blob worker with its own CSP — tracked separately.
