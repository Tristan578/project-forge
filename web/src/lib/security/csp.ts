/**
 * Content-Security-Policy construction for the SpawnForge web app.
 *
 * Extracted from `next.config.ts` so the policy can be unit-tested and so the
 * per-route scoping logic has a single source of truth.
 *
 * ## Why `'unsafe-eval'` cannot simply be removed (#8612, #8634)
 *
 * The in-editor scripting feature compiles user-authored game scripts with the
 * `Function(...)` constructor inside a **same-origin** Web Worker
 * (`scriptWorker.ts` → `compileScript()`). A same-origin worker inherits the
 * owner document's CSP, and `'wasm-unsafe-eval'` permits **only** WebAssembly
 * compilation — it does NOT cover `eval` / `Function`. So the routes that mount
 * the editor (`/dev`, `/editor/:path*`) genuinely require `'unsafe-eval'`;
 * dropping it there silently breaks all in-editor scripting. The audit findings
 * assumed `'unsafe-eval'` was only needed for WASM — it is not.
 *
 * ## Why `'unsafe-inline'` cannot simply be removed
 *
 * Clerk's sign-in/sign-up widgets and Next.js's framework bootstrap scripts emit
 * inline `<script>` tags. The standard mitigation is a per-request nonce, but
 * this app statically renders its public/marketing pages (and the landing page
 * is intentionally cached), and a nonce-based policy breaks static inline
 * scripts — the same class of failure that forced SRI to be removed
 * (see `next.config.ts`). Until the sandbox is re-architected onto a
 * cross-origin/blob worker with its own CSP, `'unsafe-inline'` is retained.
 *
 * ## What we CAN do, and do here
 *
 * Scope `'unsafe-eval'` down to only the editor routes. The script sandbox runs
 * on `/dev` and `/editor/:path*` only; every other route — including the
 * user-generated-content surfaces the findings call out (e.g. `/community`) —
 * never compiles scripts and therefore does not need `'unsafe-eval'`. Removing
 * it there shrinks the string-to-code attack surface as defense-in-depth, with
 * no impact on functionality. The `/play` route already runs a strict,
 * eval-free policy (see `next.config.ts`).
 */

export interface CspOptions {
  /**
   * Whether to include `'unsafe-eval'` in `script-src`. Required ONLY on routes
   * that mount the editor's `Function()`-based script sandbox.
   */
  allowUnsafeEval: boolean;
  /** Optional engine CDN origin to allow for `script-src` / `connect-src`. */
  engineCdn?: string;
}

/**
 * Build the application Content-Security-Policy header value.
 *
 * The returned policy is identical regardless of `allowUnsafeEval` EXCEPT for
 * the presence of the `'unsafe-eval'` token in `script-src` — keeping the delta
 * to a single token minimizes the blast radius of per-route scoping.
 */
export function buildContentSecurityPolicy({ allowUnsafeEval, engineCdn = '' }: CspOptions): string {
  const cdnDirective = engineCdn ? ` ${engineCdn}` : '';
  const evalToken = allowUnsafeEval ? " 'unsafe-eval'" : '';

  const directives = [
    "default-src 'self'",
    // 'unsafe-eval' is gated by allowUnsafeEval — see module docstring: it is
    // required by the same-origin script-sandbox worker's Function() compiler on
    // editor routes, NOT by WASM (WASM uses 'wasm-unsafe-eval'). 'unsafe-inline'
    // is required by Clerk + Next.js inline framework scripts.
    `script-src 'self'${evalToken} 'unsafe-inline' 'wasm-unsafe-eval' https://*.clerk.accounts.dev https://clerk.spawnforge.ai https://challenges.cloudflare.com${cdnDirective}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://img.clerk.com https://clerk.spawnforge.ai",
    "font-src 'self' data:",
    `connect-src 'self' https://*.clerk.accounts.dev https://clerk.spawnforge.ai https://api.anthropic.com https://api.meshy.ai https://api.elevenlabs.io https://studio-api.suno.ai https://api.hyper3d.ai${cdnDirective}`,
    "frame-src 'self' https://*.clerk.accounts.dev https://clerk.spawnforge.ai https://challenges.cloudflare.com",
    "worker-src 'self' blob:",
    "media-src 'self' blob:",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];

  return directives.join('; ');
}

/**
 * Public/content route prefixes that never mount the editor script sandbox and
 * therefore receive the eval-free (tightened) CSP. Browsers enforce every CSP
 * header present on a response as an intersection, so emitting the tightened
 * policy alongside the permissive global policy yields the most-restrictive
 * (eval-free) result on these routes — the same mechanism `/play` relies on.
 *
 * Editor routes (`/dev`, `/editor/:path*`) are deliberately absent so they keep
 * the global policy's `'unsafe-eval'`.
 */
export const EVAL_FREE_ROUTE_SOURCES: string[] = [
  '/community/:path*',
  '/blog/:path*',
  '/about/:path*',
  '/pricing/:path*',
  '/faq/:path*',
  '/compare/:path*',
  '/use-cases/:path*',
  '/changelog/:path*',
  '/terms/:path*',
  '/privacy/:path*',
  '/docs/:path*',
  '/api-docs/:path*',
];
