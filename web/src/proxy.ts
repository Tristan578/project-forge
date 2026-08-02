import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { buildPlayContentSecurityPolicy, isDevEvalAllowed } from '@/lib/security/csp';

/**
 * Allowed origins for API requests in production.
 * In development, allow localhost variants.
 */
const ALLOWED_ORIGINS =
  process.env.NODE_ENV === 'production'
    ? [
        'https://spawnforge.ai',
        'https://www.spawnforge.ai',
        ...(process.env.STAGING_URL ? [process.env.STAGING_URL] : []),
      ]
    : [
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        'http://localhost:3001',
      ];

/**
 * Shared CORS + security header logic.
 */
function handleCors(req: NextRequest): NextResponse | null {
  const origin = req.headers.get('origin');
  const { pathname } = req.nextUrl;

  if (pathname.startsWith('/api/')) {
    const isAllowedOrigin =
      !origin ||
      ALLOWED_ORIGINS.includes(origin) ||
      (process.env.NODE_ENV === 'development' && (() => {
        try {
          const u = new URL(origin);
          return u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname.endsWith('.localhost');
        } catch { return false; }
      })());

    if (!isAllowedOrigin) {
      return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 });
    }

    if (req.method === 'OPTIONS') {
      return new NextResponse(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': origin || '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Max-Age': '86400',
        },
      });
    }
  }

  return null;
}

/** Request headers a client must never be able to supply — see {@link startResponse}. */
const CLIENT_SPOOFABLE_HEADERS = ['x-nonce', 'content-security-policy'] as const;

/** True for the published-game routes, which get the nonce-based CSP. */
export function isPlayPath(pathname: string): boolean {
  return pathname === '/play' || pathname.startsWith('/play/');
}

/**
 * Create the `NextResponse.next()` that every non-short-circuiting path returns,
 * applying the per-request CSP nonce on `/play` (PF-1018, #9038).
 *
 * ## Why the nonce is set here and not in `next.config.ts`
 *
 * A static `headers()` rule cannot carry a per-request value. `/play` previously
 * got a policy with neither a nonce nor `'unsafe-inline'`, which blocked all of
 * Next.js's inline hydration bootstrap and left every published game blank. The
 * proxy is the only place that can mint a nonce per request; its header wins
 * over the `next.config.ts` rule for the same key, which remains as a fail-safe.
 *
 * The nonce is written to the forwarded REQUEST as both `x-nonce` (read by page
 * code to nonce its own inline `<script>`) and `Content-Security-Policy` (read
 * by Next.js, which stamps the nonce onto its framework and bootstrap scripts).
 *
 * Both of those headers are stripped from client-supplied input on EVERY path,
 * not just `/play` — otherwise a caller could hand the app a nonce of their
 * choosing. Requests carrying neither header (i.e. all normal traffic outside
 * `/play`) skip the rewrite entirely rather than pay for a header copy.
 */
function startResponse(req: NextRequest): NextResponse {
  const isPlay = isPlayPath(req.nextUrl.pathname);
  const hasSpoofed = CLIENT_SPOOFABLE_HEADERS.some((h) => req.headers.has(h));
  if (!isPlay && !hasSpoofed) return NextResponse.next();

  const requestHeaders = new Headers(req.headers);
  for (const header of CLIENT_SPOOFABLE_HEADERS) requestHeaders.delete(header);
  if (!isPlay) return NextResponse.next({ request: { headers: requestHeaders } });

  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = buildPlayContentSecurityPolicy({
    engineCdn: process.env.NEXT_PUBLIC_ENGINE_CDN_URL || '',
    nonce,
    clerkPublishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    devUnsafeEval: isDevEvalAllowed(),
  });
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

function addSecurityHeaders(response: NextResponse, req: NextRequest): NextResponse {
  const origin = req.headers.get('origin');
  const { pathname } = req.nextUrl;

  if (pathname.startsWith('/api/') && origin) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Access-Control-Allow-Credentials', 'true');
  }

  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-XSS-Protection', '1; mode=block');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  return response;
}

/**
 * Non-Clerk passthrough middleware for CI/E2E.
 * Applies CORS + security headers but skips authentication.
 *
 * Exported for the same reason as {@link applyAuthDecision}: this is the branch
 * `buildProxy()` selects whenever Clerk keys are absent or malformed, which is
 * exactly the configuration the DB-less E2E gate runs under. Reaching it through
 * the live `proxy` export is impossible in unit tests (the key check runs once at
 * module load), so without a direct export the `/play` nonce would be proven only
 * on the Clerk path and could silently regress on the one CI actually exercises.
 */
export function passthroughMiddleware(req: NextRequest): NextResponse {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;
  return addSecurityHeaders(startResponse(req), req);
}

/**
 * Public (unauthenticated) route patterns for the Clerk proxy, in Clerk
 * `createRouteMatcher` glob syntax.
 *
 * Exported so the proxy's public-vs-protected decision can be unit-tested
 * against the REAL Clerk matcher (see `proxy.test.ts`) instead of grepping the
 * source. A substring check over the source can't tell a live pattern from one
 * buried in a comment, and — worse — can't catch a missing `(.*)` that would
 * silently stop a subpath like `/api/cron/health-monitor` from matching while
 * the bare `/api/cron` string still appears in the file.
 *
 * `includeDev` adds the `/dev` auth-bypass route. It is only ever true outside
 * production: in production the `/dev` editor requires authentication like any
 * other editor route, to prevent unauthenticated access to the full editor UI
 * (#7915).
 */
export function buildPublicRoutes({ includeDev }: { includeDev: boolean }): string[] {
  const publicRoutes = [
    '/',
    '/sign-in(.*)',
    '/sign-up(.*)',
    '/api/auth/webhook(.*)',
    '/api/stripe/webhook(.*)',
    '/pricing',
    '/play(.*)',
    '/terms(.*)',
    '/privacy(.*)',
    '/community(.*)',
    '/api/community(.*)',
    // Public waitlist capture: the /sign-up page's form posts here WITHOUT a
    // Clerk session — the page exists precisely for unauthenticated visitors.
    // The route self-enforces its abuse controls (IP rate limit + honeypot +
    // idempotent insert), none of which are reachable if the proxy 401s the
    // request first (#8730).
    '/api/waitlist(.*)',
    '/api/docs(.*)',
    '/api-docs(.*)',
    '/api/openapi(.*)',
    '/api/health(.*)',
    '/api/status(.*)',
    // Vercel Cron jobs (e.g. /api/cron/health-monitor, vercel.json crons) carry
    // only a CRON_SECRET bearer token, no Clerk session. The routes enforce that
    // secret themselves (see the cron-self-enforcement guard in proxy.test.ts),
    // so they must bypass the Clerk proxy or the scheduled call 401s before its
    // own auth check runs (#8605).
    '/api/cron(.*)',
    '/api/sentry(.*)',
    '/monitoring(.*)',
    '/llms.txt',
    '/llms-full.txt',
    '/faq(.*)',
    '/about(.*)',
    '/compare(.*)',
    '/use-cases(.*)',
    '/changelog(.*)',
    '/blog(.*)',
  ];
  if (includeDev) {
    publicRoutes.push('/dev(.*)');
  }
  return publicRoutes;
}

/** Minimal shape of Clerk's `auth()` result that the proxy depends on. */
type ProxyAuth = () => Promise<{
  userId: string | null;
  redirectToSignIn: (opts: { returnBackUrl: string }) => Response;
}>;

/**
 * The proxy's per-request auth decision. This is the SINGLE implementation: the
 * production clerkMiddleware callback in buildProxy() delegates straight to it, and
 * proxy.test.ts drives it directly — so the unit tests exercise the exact code that
 * runs in production, with no parallel copy that can silently diverge.
 *
 * It cannot be reached through `proxy` itself in tests: clerkMiddleware is pulled in
 * via a runtime `require()` (to keep Clerk's import-time key validation out of the
 * CI/E2E passthrough path), and the test runner cannot intercept that require to
 * stub auth. Exposing the decision as a pure function — given an `auth` result and
 * an `isPublicRoute` matcher — lets the real 401-vs-redirect logic be exercised with
 * the real Clerk route matcher and no live keys (see `proxy.test.ts`).
 */
export async function applyAuthDecision(
  auth: ProxyAuth,
  req: NextRequest,
  isPublicRoute: (req: NextRequest) => boolean,
): Promise<Response> {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  // Redirect authenticated users from landing page to dashboard.
  // This runs in the proxy so the landing page itself can be statically cached.
  if (req.nextUrl.pathname === '/') {
    const { userId } = await auth();
    if (userId) {
      return NextResponse.redirect(new URL('/dashboard', req.url));
    }
  }

  if (!isPublicRoute(req)) {
    const { userId, redirectToSignIn } = await auth();
    if (!userId) {
      // Browser navigations: redirect to sign-in (preserves the original URL
      // as `redirect_url` so users land back where they started after auth).
      // API requests: return 401 so client code can distinguish unauthenticated
      // from "not found". Clerk's default `auth.protect()` would rewrite browser
      // requests to /404 — bad UX (no recovery path) and breaks the prod smoke
      // test. See #8529.
      if (req.nextUrl.pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      return redirectToSignIn({ returnBackUrl: req.url });
    }
  }

  return addSecurityHeaders(startResponse(req), req);
}

/**
 * Build the proxy middleware.
 *
 * When valid Clerk keys are present, use clerkMiddleware for auth.
 * When keys are missing or invalid (CI/E2E), use passthrough.
 *
 * We use a factory function to avoid importing @clerk/nextjs/server at
 * the top level — Clerk validates keys at import time and throws a fatal
 * error if they are missing or have invalid format.
 */
function buildProxy(): (req: NextRequest) => NextResponse | Promise<NextResponse> {
  const secretKey = process.env.CLERK_SECRET_KEY;
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

  // Both keys must be present and have valid Clerk format prefixes
  if (!secretKey || !publishableKey || !secretKey.startsWith('sk_') || !publishableKey.startsWith('pk_')) {
    return passthroughMiddleware;
  }

  // Keys look valid — import Clerk and build the authenticated middleware.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { clerkMiddleware, createRouteMatcher } = require('@clerk/nextjs/server');

  const isPublicRoute = createRouteMatcher(
    buildPublicRoutes({ includeDev: process.env.NODE_ENV !== 'production' }),
  );

  // The production callback delegates to applyAuthDecision so the unit tests in
  // proxy.test.ts exercise the EXACT logic that runs in production — not a parallel
  // copy that can silently diverge. A single decision implementation is the whole
  // point of #8605 (route tests that never hit the real request path left CI blind).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return clerkMiddleware((auth: any, req: NextRequest) =>
    applyAuthDecision(auth, req, isPublicRoute),
  );
}

export const proxy = buildProxy();

export const config = {
  matcher: [
    // Skip Next.js internals, static files, and engine WASM
    '/((?!_next|monitoring|engine-pkg-webgl2|engine-pkg-webgpu|[^?]*\\.(?:html?|css|js|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)/:path*',
  ],
};
