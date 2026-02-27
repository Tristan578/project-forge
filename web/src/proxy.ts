import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Allowed origins for API requests in production.
 * In development, allow localhost variants.
 */
const ALLOWED_ORIGINS =
  process.env.NODE_ENV === 'production'
    ? [
        'https://genforge.app',
        'https://www.genforge.app',
      ]
    : [
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        'http://localhost:3001',
      ];

// Public routes that don't require authentication
const isPublicRoute = createRouteMatcher([
  '/',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/auth/webhook(.*)',
  '/api/stripe/webhook(.*)',
  '/pricing',
  '/dev(.*)',
  '/play(.*)',
  '/terms(.*)',
  '/privacy(.*)',
  '/community(.*)',
  '/api/community(.*)',
  '/api/docs(.*)',
  '/api-docs(.*)',
  '/api/openapi(.*)',
  '/api/sentry(.*)',
]);

// When CLERK_SECRET_KEY is missing (CI/E2E), skip Clerk auth entirely.
// This allows the dev server to start without Clerk credentials.
const hasClerkKey = !!process.env.CLERK_SECRET_KEY;

/**
 * Shared CORS + security header logic used by both Clerk and non-Clerk paths.
 */
function handleCors(req: NextRequest): NextResponse | null {
  const origin = req.headers.get('origin');
  const { pathname } = req.nextUrl;

  if (pathname.startsWith('/api/')) {
    const isAllowedOrigin =
      !origin ||
      ALLOWED_ORIGINS.includes(origin) ||
      (process.env.NODE_ENV === 'development' && origin.startsWith('http://localhost'));

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
 * Non-Clerk passthrough middleware for CI/E2E (no CLERK_SECRET_KEY set).
 * Applies CORS + security headers but skips authentication.
 */
function passthroughMiddleware(req: NextRequest): NextResponse {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  return addSecurityHeaders(NextResponse.next(), req);
}

export const proxy = hasClerkKey
  ? clerkMiddleware(async (auth, req) => {
      const corsResponse = handleCors(req);
      if (corsResponse) return corsResponse;

      if (!isPublicRoute(req)) {
        await auth.protect();
      }

      return addSecurityHeaders(NextResponse.next(), req);
    })
  : passthroughMiddleware;

export const config = {
  matcher: [
    // Skip Next.js internals, static files, and engine WASM
    '/((?!_next|engine-pkg-webgl2|engine-pkg-webgpu|[^?]*\\.(?:html?|css|js|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)/:path*',
  ],
};
