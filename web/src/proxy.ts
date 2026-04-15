import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

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
 */
function passthroughMiddleware(req: NextRequest): NextResponse {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;
  return addSecurityHeaders(NextResponse.next(), req);
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

  // /dev route bypasses auth for local development only.
  // In production, /dev requires authentication like any other editor route
  // to prevent unauthenticated access to the full editor UI (#7915).
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
    '/api/docs(.*)',
    '/api-docs(.*)',
    '/api/openapi(.*)',
    '/api/health(.*)',
    '/api/status(.*)',
    '/api/sentry(.*)',
    '/monitoring(.*)',
  ];
  if (process.env.NODE_ENV !== 'production') {
    publicRoutes.push('/dev(.*)');
  }
  const isPublicRoute = createRouteMatcher(publicRoutes);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return clerkMiddleware(async (auth: any, req: NextRequest) => {
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
      await auth.protect();
    }

    return addSecurityHeaders(NextResponse.next(), req);
  });
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
