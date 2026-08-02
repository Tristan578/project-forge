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
 * no impact on functionality.
 *
 * `/play` goes further: it is dynamically rendered, so it can use a per-request
 * nonce and drop `'unsafe-inline'` entirely. See
 * {@link buildPlayContentSecurityPolicy} — including why that policy could not
 * simply omit inline scripts without a nonce (PF-1018), and why the same
 * approach does not generalize to the statically-cached marketing pages.
 */

/**
 * Whether the eval-free policies must nonetheless admit `'unsafe-eval'` because
 * this is a development server.
 *
 * Next.js's dev-mode Fast Refresh runtime (`@next/react-refresh-utils`) compiles
 * a string with `eval`, and it runs from the `main-app` entry chunk — so a policy
 * without `'unsafe-eval'` does not merely disable hot reload, it throws during
 * module execution and **aborts hydration for the whole page**. That made every
 * eval-free route (the 12 content prefixes, and `/play`) render as dead server
 * HTML under `npm run dev`, which is also why this had to be fixed before
 * PF-1018 could be verified in a browser at all.
 *
 * Strict equality against `'development'` is deliberate: `'test'`, `'production'`
 * and an unset value must all yield `false`, so a production build can never
 * emit `'unsafe-eval'` on a route that scoped it out. `nodeEnv` is a parameter so
 * that contract is directly testable rather than ambient.
 *
 * Note for anyone debugging CSP locally: `@vercel/analytics` and
 * `@vercel/speed-insights` load from `https://va.vercel-scripts.com` **only**
 * under `next dev`, so their two blocked-script console errors are dev-only noise
 * and are deliberately NOT allowlisted. In a real build both resolve to the
 * same-origin `/_vercel/{insights,speed-insights}/script.js`, already covered by
 * `'self'`. Adding the host would be permanent policy surface for a dev-only
 * script that merely console-logs.
 *
 * Which is the general rule: **never validate a CSP change against `next dev`.**
 * The dev server keeps `'unsafe-eval'` and inline scripts alive for Fast Refresh,
 * so a policy that blanks every page in production looks perfectly healthy there
 * (this is exactly how PF-1018 shipped). Repro against a production build:
 *
 *     cd web && npm run build && npx next start
 *     # then load the route in a REAL browser and watch the console —
 *     # curl sees the server HTML and reports success on a page that never hydrates
 */
export function isDevEvalAllowed(nodeEnv: string | undefined = process.env.NODE_ENV): boolean {
  return nodeEnv === 'development';
}

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
/**
 * Route scope for the published-game policy, in Next.js `headers()` `source`
 * syntax. This is the ONE definition of "is this a /play request": the static
 * rule in {@link buildCspRouteRules} is built from it, and {@link isPlayPath} —
 * which the proxy uses to decide whether to mint a nonce — is derived from it
 * via {@link cspSourceToRegExp}. Two writers set the CSP on this route; if they
 * disagreed about which paths it covers, one of them would emit a policy the
 * other never intended for that URL.
 */
export const PLAY_ROUTE_SOURCE = '/play/:path*';

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
 * A Clerk publishable key encodes its Frontend API host: `pk_(test|live)_<b64>`,
 * where the base64 payload decodes to `<host>$`. Decoding it is how the play
 * policy allowlists the EXACT Clerk host this deployment uses — a development
 * instance serves from `<slug>.clerk.accounts.dev`, production from a custom
 * domain such as `clerk.spawnforge.ai`, and hardcoding either one silently
 * breaks the other environment.
 *
 * Returns `null` for a missing/!malformed key, which correctly yields a policy
 * with no Clerk sources: without a publishable key Clerk loads no scripts.
 *
 * The decoded value is validated as a bare hostname. It is interpolated into a
 * header, so a key decoding to `evil.com; script-src *` would otherwise inject a
 * directive — the regex is the guard against that, not a formatting nicety.
 */
export function clerkFrontendApiFromPublishableKey(publishableKey?: string): string | null {
  if (!publishableKey) return null;
  const payload = /^pk_(?:test|live)_(.+)$/.exec(publishableKey)?.[1];
  if (!payload) return null;
  let decoded: string;
  try {
    decoded = atob(payload);
  } catch {
    return null;
  }
  // Clerk terminates the encoded host with '$'; its absence means this is not a
  // key we understand, and guessing at the host is worse than omitting it.
  if (!decoded.endsWith('$')) return null;
  const host = decoded.slice(0, -1);
  return /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(host) ? host : null;
}

export interface PlayCspOptions {
  /** Optional engine CDN origin to allow for `script-src` / `connect-src`. */
  engineCdn?: string;
  /**
   * Per-request nonce. When present, inline scripts are authorized by nonce and
   * `'unsafe-inline'` is omitted. When absent, `'unsafe-inline'` is emitted
   * instead — see the note on the static fallback below.
   */
  nonce?: string;
  /** Clerk publishable key, used to derive the Clerk host to allowlist. */
  clerkPublishableKey?: string;
  /**
   * Admit `'unsafe-eval'` for the dev server's Fast Refresh runtime only.
   * Callers pass {@link isDevEvalAllowed}; never `true` in a production build.
   */
  devUnsafeEval?: boolean;
}

/**
 * Policy for published/played games (`/play/:path*`) — the surface that runs
 * user-generated content, and therefore the one whose policy matters most.
 *
 * ## Why this is nonce-based and the rest of the site is not (PF-1018, #9038)
 *
 * The previous policy was `script-src 'self' 'wasm-unsafe-eval'` with neither a
 * nonce nor `'unsafe-inline'`. Next.js bootstraps App Router hydration with
 * inline `<script>` tags (`self.__next_f.push(...)`), so EVERY published game
 * rendered a blank/stuck page: the server HTML painted, every inline bootstrap
 * script was blocked, and hydration never ran. Nothing threw server-side, so it
 * failed silently in production. (The exact tag count varies with payload size
 * and Next version, so it is deliberately not pinned here.)
 *
 * A nonce is viable here specifically because `/play/[userId]/[slug]` awaits
 * `safeAuth()` and is therefore dynamically rendered. A nonce forces dynamic
 * rendering, which is exactly why the marketing pages keep `'unsafe-inline'`
 * instead (see the module docstring) — they are intentionally static-cached.
 *
 * ## Why not `'strict-dynamic'`
 *
 * It causes host allowlists to be ignored, and this policy relies on host
 * sources (the engine CDN, Clerk). It would also put the engine's dynamic
 * `import()` of the WASM glue on browser-dependent propagation semantics. An
 * explicit allowlist is predictable and directly verifiable.
 *
 * ## The no-nonce fallback, and why BOTH writers must be safe
 *
 * `next.config.ts` emits this policy statically and cannot carry a per-request
 * nonce, so that call omits it and gets `'unsafe-inline'`. That means `/play` has
 * two writers for one header key: this static rule and the proxy's nonce-bearing
 * response header.
 *
 * Which one wins is verified only for the self-hosted/dev router, where the proxy
 * wins (`resolve-routes.js` orders `fsChecker.headers` before `middleware`, and
 * `router-server.js` re-`setHeader`s in that order). Vercel routes through its own
 * edge layer, so that proof does NOT transfer — treat the winner there as unknown
 * until observed on a real deployment:
 *
 *     curl -sI https://<deployment>/play/<userId>/<slug> | grep -i content-security-policy
 *
 * This is deliberately not load-bearing. Both outcomes are safe: the proxy's
 * policy is the nonce-based one, and this static one degrades to the same inline
 * posture the rest of the site already runs. What must never happen is `/play`
 * ending up with NEITHER a nonce nor `'unsafe-inline'` — that is the blank-page
 * regression above — so neither writer may emit a policy without one of the two.
 */
export function buildPlayContentSecurityPolicy({
  engineCdn = '',
  nonce,
  clerkPublishableKey,
  devUnsafeEval = false,
}: PlayCspOptions = {}): string {
  // Fail closed rather than emit a header built from an unexpected value: the
  // nonce is interpolated directly into the directive.
  if (nonce !== undefined && !/^[A-Za-z0-9+/=_-]+$/.test(nonce)) {
    throw new Error('buildPlayContentSecurityPolicy: nonce is not base64');
  }
  const cdn = engineCdn ? ` ${engineCdn}` : '';
  const clerkHost = clerkFrontendApiFromPublishableKey(clerkPublishableKey);
  // The root layout mounts <ClerkProvider> on every route, /play included, so
  // Clerk's script is genuinely loaded here. Omitting it does not stop Clerk
  // mounting — it only makes the load fail.
  const clerk = clerkHost ? ` https://${clerkHost}` : '';
  const scriptAuth = nonce ? ` 'nonce-${nonce}'` : " 'unsafe-inline'";
  // Dev server only — see isDevEvalAllowed. Games themselves never need eval:
  // the engine compiles WASM ('wasm-unsafe-eval') and /play mounts no script
  // sandbox, so this token is absent from every production /play response.
  const devEval = devUnsafeEval ? " 'unsafe-eval'" : '';

  return [
    "default-src 'self'",
    `script-src 'self'${scriptAuth}${devEval} 'wasm-unsafe-eval'${clerk}${cdn}`,
    `connect-src 'self'${clerk}${cdn}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: https://img.clerk.com${clerk}`,
    "font-src 'self' data:",
    // The engine instantiates WASM from a same-origin worker; games may play
    // audio decoded to blob URLs.
    "worker-src 'self' blob:",
    "media-src 'self' blob:",
    `frame-src 'self'${clerk}`,
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export interface CspRouteRule {
  source: string;
  headers: Array<{ key: 'Content-Security-Policy'; value: string }>;
}

/**
 * Every input the play policy needs except the nonce, read from the environment.
 *
 * Both writers of the `/play` CSP call this — `next.config.ts` for the static
 * rule and the proxy for the nonce-bearing response header — so the two policies
 * can differ ONLY in the nonce. Assembling the same object independently at each
 * site is what lets a new field be wired into one writer and forgotten in the
 * other: every field is optional, so the omission is not a type error, and each
 * writer's own tests keep passing while the two headers silently diverge.
 */
export function playCspOptionsFromEnv(): Omit<PlayCspOptions, 'nonce'> {
  return {
    engineCdn: process.env.NEXT_PUBLIC_ENGINE_CDN_URL || '',
    clerkPublishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    devUnsafeEval: isDevEvalAllowed(),
  };
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
export function buildCspRouteRules({
  engineCdn = '',
  clerkPublishableKey,
  devUnsafeEval = isDevEvalAllowed(),
}: Omit<PlayCspOptions, 'nonce'> = {}): CspRouteRule[] {
  const globalCsp = buildContentSecurityPolicy({ allowUnsafeEval: true, engineCdn });
  // The eval-free routes drop 'unsafe-eval' in every real build; under the dev
  // server they must keep it or Fast Refresh's eval aborts hydration.
  const evalFreeCsp = buildContentSecurityPolicy({ allowUnsafeEval: devUnsafeEval, engineCdn });
  // No nonce: a static `headers()` rule cannot carry a per-request value. The
  // proxy emits the nonce-bearing policy that supersedes this one on /play.
  const playCsp = buildPlayContentSecurityPolicy({ engineCdn, clerkPublishableKey, devUnsafeEval });
  const csp = (value: string): CspRouteRule['headers'] => [
    { key: 'Content-Security-Policy', value },
  ];
  return [
    // Global FIRST — see the ordering note above. Last-writer-wins means a rule
    // listed here can only be overridden by a more-specific rule BELOW it.
    { source: '/:path*', headers: csp(globalCsp) },
    // Overrides AFTER the global rule so they are the last writer for their paths.
    { source: PLAY_ROUTE_SOURCE, headers: csp(playCsp) },
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

/** Compiled once — {@link cspSourceToRegExp} returns an unanchored-free, non-global
 * pattern, so `.test()` is stateless and safe to reuse across requests. */
const PLAY_ROUTE_PATTERN = cspSourceToRegExp(PLAY_ROUTE_SOURCE);

/**
 * Does `pathname` fall under the published-game policy? Derived from
 * {@link PLAY_ROUTE_SOURCE} rather than hand-written, so the proxy (which mints
 * the nonce) and `next.config.ts` (which emits the static rule) cannot drift
 * apart on which URLs `/play`'s policy covers.
 *
 * Matches `/play`, `/play/`, and any descendant; NOT `/playground` or
 * `/community/play`.
 */
export function isPlayPath(pathname: string): boolean {
  return PLAY_ROUTE_PATTERN.test(pathname);
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
