/** Keep public Docs available while protected routes require working authentication. */
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import type { NextRequest, NextFetchEvent } from 'next/server';
import { DOCS_URL, resolveDocsUrl } from './lib/site';

/**
 * Every pattern is an exact path plus an explicit `/(.*)` subtree. Clerk's
 * `createRouteMatcher` delegates to a vendored pathToRegexp in which a bare
 * `X(.*)` is a case-insensitive SUFFIX wildcard with no path-segment boundary —
 * `/sign-in(.*)` would also make a future `/sign-internal` public. The default
 * here is to protect, so a route becomes public by being listed: the bare form
 * silently exempts any later sibling that merely shares a name prefix.
 *
 * `/robots.txt` and `/sitemap.xml` are listed because the `config.matcher` below
 * only exempts `_next` and the favicon — without these two entries a crawler
 * fetching either one receives a 307 to sign-in, which makes the sitemap
 * `app/sitemap.ts` builds undiscoverable and the crawl policy in
 * `app/robots.ts` unreadable.
 */
export const PUBLIC_ROUTES = [
  '/',
  '/robots.txt',
  '/sitemap.xml',
  '/sign-in',
  '/sign-in/(.*)',
  '/sign-up',
  '/sign-up/(.*)',
  '/api/webhooks',
  '/api/webhooks/(.*)',
  '/mcp',
  '/mcp/(.*)',
  // The capability matrix (#9720) exists so a prospective creator can read what
  // works before signing up; gating it behind a session would defeat it.
  '/capability-matrix',
];

const isPublicRoute = createRouteMatcher(PUBLIC_ROUTES);

/**
 * Origins whose Clerk session tokens the docs deployment accepts — Clerk's
 * `authorizedParties`, checked against the token's `azp` claim (#9630). The
 * canonical docs origin plus whatever Vercel says this deployment is served
 * as, so preview deployments keep signing in; localhost outside production.
 */
export function buildAuthorizedParties(env: NodeJS.ProcessEnv = process.env): string[] {
  // This runs at module scope (see `clerkHandler` below), so the parse must not
  // throw: resolveDocsUrl swaps a malformed NEXT_PUBLIC_DOCS_URL for the canonical
  // origin instead of taking the whole site down on load.
  const docsUrl = env.NEXT_PUBLIC_DOCS_URL === undefined ? DOCS_URL : resolveDocsUrl(env.NEXT_PUBLIC_DOCS_URL);
  const parties = new Set<string>([new URL(docsUrl).origin]);
  for (const host of [env.VERCEL_URL, env.VERCEL_BRANCH_URL, env.VERCEL_PROJECT_PRODUCTION_URL]) {
    if (host) parties.add(`https://${host.replace(/^https?:\/\//, '')}`);
  }
  if (env.NODE_ENV !== 'production') {
    parties.add('http://localhost:3000');
    parties.add('http://localhost:3001');
  }
  return [...parties];
}

function passThrough() {
  return NextResponse.next();
}

const clerkHandler = clerkMiddleware(
  async (auth, req) => {
    if (!isPublicRoute(req)) {
      await auth.protect();
    }
  },
  { authorizedParties: buildAuthorizedParties() },
);

/**
 * Keep public docs available during an authentication outage. Protected routes
 * never fall through: missing production credentials and middleware exceptions
 * return a non-cacheable 503. Only local development/CI with NODE_ENV other than
 * production supports unrestricted no-Clerk access.
 * @param request Incoming Docs request used to identify the public-route boundary.
 * @param event Next fetch event forwarded to Clerk for middleware lifecycle handling.
 * @returns Clerk authentication response, public/development pass-through, or
 * a non-cacheable 503 when protected production authentication is unavailable.
 */
export default async function proxy(request: NextRequest, event: NextFetchEvent) {
  const authenticationUnavailable = () => NextResponse.json(
    { error: 'Authentication temporarily unavailable' },
    { status: 503, headers: { 'Cache-Control': 'no-store' } },
  );
  if (!process.env.CLERK_SECRET_KEY) {
    return process.env.NODE_ENV !== 'production' || isPublicRoute(request)
      ? passThrough()
      : authenticationUnavailable();
  }

  try {
    return await clerkHandler(request, event);
  } catch {
    // Provider exceptions may contain tokens or connection details. Emit only
    // a fixed identifier; never stringify or pass the raw exception to logs.
    console.error('[docs-auth] middleware_unavailable');
    return isPublicRoute(request) ? passThrough() : authenticationUnavailable();
  }
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
