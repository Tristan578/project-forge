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
 * therefore receive the eval-free (tightened) CSP.
 *
 * Editor routes (`/dev`, `/editor/:path*`) are deliberately absent so they keep
 * the global policy's `'unsafe-eval'`, which their `Function()`-based script
 * sandbox requires.
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

/**
 * Locked-down policy for published/played games (`/play/:path*`). A played game
 * runs only first-party code + WASM, so script-src carries neither
 * `'unsafe-eval'` nor `'unsafe-inline'` (it does not mount Clerk or the editor).
 * Kept independent of {@link EVAL_FREE_ROUTE_SOURCES} because the game surface
 * needs a strictly smaller allowlist than the marketing/content routes.
 */
export function buildPlayContentSecurityPolicy(engineCdn = ''): string {
  const cdn = engineCdn ? ` ${engineCdn}` : '';
  return [
    "default-src 'self'",
    `script-src 'self' 'wasm-unsafe-eval'${cdn}`,
    `connect-src 'self'${cdn}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "frame-ancestors 'none'",
  ].join('; ');
}

export interface CspRouteRule {
  source: string;
  headers: Array<{ key: 'Content-Security-Policy'; value: string }>;
}

/**
 * Build the ORDERED list of Content-Security-Policy route rules consumed by
 * `next.config.ts#headers()`. This is the single source of truth for CSP route
 * scoping so the ordering contract below can be unit-tested.
 *
 * ## Ordering is load-bearing (#8634, #8612)
 *
 * Next.js applies EVERY matching `headers()` rule, and when two matching rules
 * set the same header key the LAST one in the returned array wins (documented
 * "Header Overriding Behavior"). It is NOT a browser-style intersection of
 * multiple CSP headers — Next emits exactly one CSP header, the last writer's.
 *
 * Therefore the permissive global (`/:path*`) rule MUST come FIRST and the
 * tightened per-route overrides (`/play`, the content routes) MUST come AFTER
 * it, so each override is the last writer for its own paths and actually takes
 * effect. The previous ordering (overrides before the global rule) was silently
 * a no-op: the global rule overrode every tightened policy, leaving
 * `'unsafe-eval'` live on the public content routes AND on `/play`.
 */
export function buildCspRouteRules({ engineCdn = '' }: { engineCdn?: string } = {}): CspRouteRule[] {
  const globalCsp = buildContentSecurityPolicy({ allowUnsafeEval: true, engineCdn });
  const evalFreeCsp = buildContentSecurityPolicy({ allowUnsafeEval: false, engineCdn });
  const playCsp = buildPlayContentSecurityPolicy(engineCdn);
  const csp = (value: string): CspRouteRule['headers'] => [
    { key: 'Content-Security-Policy', value },
  ];
  return [
    // Global FIRST — see the ordering note above. Last-writer-wins means a rule
    // listed here can only be overridden by a more-specific rule BELOW it.
    { source: '/:path*', headers: csp(globalCsp) },
    // Overrides AFTER the global rule so they are the last writer for their paths.
    { source: '/play/:path*', headers: csp(playCsp) },
    ...EVAL_FREE_ROUTE_SOURCES.map((source) => ({ source, headers: csp(evalFreeCsp) })),
  ];
}

/**
 * Convert a Next.js header `source` pattern to a RegExp, mirroring the subset of
 * path-to-regexp semantics this app uses: `/:name*` wildcard segments and
 * `:name` single segments. This documents (and lets tests assert) the matching
 * Next performs at runtime; it is NOT used in the request path (Next compiles
 * the `source` patterns itself).
 */
export function cspSourceToRegExp(source: string): RegExp {
  const body = source
    .replace(/\/:[A-Za-z0-9_]+\*/g, '(?:/.*)?') // "/:path*" → optional trailing segments
    .replace(/:[A-Za-z0-9_]+/g, '[^/]+'); // ":name" → exactly one path segment
  return new RegExp(`^${body}/?$`);
}

/**
 * Resolve the CSP that actually applies to `path`, simulating Next.js
 * last-writer-wins over the ordered {@link buildCspRouteRules} output. Returns
 * `undefined` when no rule matches.
 */
export function effectiveCspForPath(rules: CspRouteRule[], path: string): string | undefined {
  let value: string | undefined;
  for (const rule of rules) {
    if (!cspSourceToRegExp(rule.source).test(path)) continue;
    const header = rule.headers.find((h) => h.key === 'Content-Security-Policy');
    if (header) value = header.value; // last writer wins — mirrors Next.js
  }
  return value;
}
