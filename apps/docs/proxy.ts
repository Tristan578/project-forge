import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

/**
 * Docs site auth gate using Clerk.
 *
 * All pages require Clerk authentication. Unauthenticated users are
 * redirected to the Clerk sign-in page. In local dev without Clerk keys,
 * the site is open (clerkMiddleware passes through gracefully).
 *
 * Future: add admin/internal role check to restrict to SpawnForge team members.
 */

const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/webhooks(.*)',
]);

export default clerkMiddleware(async (auth, request) => {
  // In development without Clerk keys, allow all access
  if (!process.env.CLERK_SECRET_KEY) {
    return NextResponse.next();
  }

  if (!isPublicRoute(request)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
