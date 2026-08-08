import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

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
];

const isPublicRoute = createRouteMatcher(PUBLIC_ROUTES);

function passThrough() {
  return NextResponse.next();
}

const clerkHandler = clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export default async function proxy(request: NextRequest) {
  // Without Clerk keys, allow all access (dev/CI)
  if (!process.env.CLERK_SECRET_KEY) {
    return passThrough();
  }

  // Wrap clerkMiddleware so a misconfigured Clerk instance doesn't 500 the entire site
  try {
    return await clerkHandler(request, {} as any);
  } catch (err) {
    console.error('[proxy] clerkMiddleware threw — allowing request through:', err);
    return passThrough();
  }
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
