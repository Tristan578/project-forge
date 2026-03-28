import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Docs site auth gate.
 *
 * When DOCS_AUTH_TOKEN is set, visitors must authenticate with the token
 * via a simple login page. The token is stored in a cookie after login.
 * When DOCS_AUTH_TOKEN is not set (local dev), the site is open.
 */
export function proxy(request: NextRequest) {
  const authToken = process.env.DOCS_AUTH_TOKEN;

  // No token configured — site is open (local dev)
  if (!authToken) {
    return NextResponse.next();
  }

  // Allow the login API route through
  if (request.nextUrl.pathname === '/api/login') {
    return NextResponse.next();
  }

  // Check cookie
  const cookie = request.cookies.get('docs_auth');
  if (cookie?.value === authToken) {
    return NextResponse.next();
  }

  // Check query param (for direct links with token)
  const tokenParam = request.nextUrl.searchParams.get('token');
  if (tokenParam === authToken) {
    const url = request.nextUrl.clone();
    url.searchParams.delete('token');
    const response = NextResponse.redirect(url);
    response.cookies.set('docs_auth', authToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30, // 30 days
      path: '/',
    });
    return response;
  }

  // Not authenticated — show login page
  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = '/login';
  loginUrl.searchParams.set('next', request.nextUrl.pathname);
  return NextResponse.rewrite(loginUrl);
}

export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     * - login page itself
     */
    '/((?!_next/static|_next/image|favicon.ico|login).*)',
  ],
};
