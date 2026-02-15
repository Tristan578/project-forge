import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

/**
 * Allowed origins for API requests in production.
 * In development, allow localhost variants.
 */
const ALLOWED_ORIGINS =
  process.env.NODE_ENV === 'production'
    ? [
        'https://projectforge.app',
        'https://www.projectforge.app',
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
]);

export const proxy = clerkMiddleware(async (auth, req) => {
  const origin = req.headers.get('origin');
  const { pathname } = req.nextUrl;

  // CORS handling for API routes
  if (pathname.startsWith('/api/')) {
    const isAllowedOrigin =
      !origin || // Same-origin requests have no origin header
      ALLOWED_ORIGINS.includes(origin) ||
      (process.env.NODE_ENV === 'development' && origin.startsWith('http://localhost'));

    if (!isAllowedOrigin) {
      return NextResponse.json(
        { error: 'Origin not allowed' },
        { status: 403 }
      );
    }

    // Handle preflight OPTIONS requests
    if (req.method === 'OPTIONS') {
      return new NextResponse(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': origin || '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Max-Age': '86400', // 24 hours
        },
      });
    }
  }

  // Clerk authentication for protected routes
  if (!isPublicRoute(req)) {
    await auth.protect();
  }

  // Continue with the request and add security headers
  const response = NextResponse.next();

  // Add CORS headers to API requests
  if (pathname.startsWith('/api/') && origin) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Access-Control-Allow-Credentials', 'true');
  }

  // Add security headers to all responses
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-XSS-Protection', '1; mode=block');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=()'
  );

  return response;
});

export const config = {
  matcher: [
    // Skip Next.js internals, static files, and engine WASM
    '/((?!_next|engine-pkg-webgl2|engine-pkg-webgpu|[^?]*\\.(?:html?|css|js|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)/:path*',
  ],
};
