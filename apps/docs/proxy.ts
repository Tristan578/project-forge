import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const isPublicRoute = createRouteMatcher([
  '/',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/webhooks(.*)',
  '/mcp',
  '/mcp/(.*)',
]);

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
