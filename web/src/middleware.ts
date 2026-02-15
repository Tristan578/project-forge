import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Allowed origins for API requests in production.
 * In development, allow localhost variants.
 */
const ALLOWED_ORIGINS =
  process.env.NODE_ENV === 'production'
    ? [
        'https://projectforge.app',
        'https://www.projectforge.app',
        // Add your production domains here
      ]
    : [
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        'http://localhost:3001',
      ];

/**
 * Middleware for CORS and security headers.
 * Runs on all API routes.
 */
export function middleware(request: NextRequest) {
  const origin = request.headers.get('origin');
  const { pathname } = request.nextUrl;

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
    if (request.method === 'OPTIONS') {
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

    // Add CORS headers to actual requests
    const response = NextResponse.next();

    if (origin) {
      response.headers.set('Access-Control-Allow-Origin', origin);
      response.headers.set('Access-Control-Allow-Credentials', 'true');
    }

    // Add security headers
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('X-Frame-Options', 'DENY');
    response.headers.set('X-XSS-Protection', '1; mode=block');
    response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.headers.set(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=()'
    );

    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: '/api/:path*',
};
