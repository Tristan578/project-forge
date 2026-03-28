import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function POST(request: NextRequest) {
  const authToken = process.env.DOCS_AUTH_TOKEN;

  if (!authToken) {
    // No auth configured — redirect home
    return NextResponse.redirect(new URL('/', request.url));
  }

  const formData = await request.formData();
  const token = formData.get('token') as string | null;
  const next = (formData.get('next') as string | null) || '/';

  if (token === authToken) {
    const redirectUrl = new URL(next, request.url);
    const response = NextResponse.redirect(redirectUrl);
    response.cookies.set('docs_auth', authToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30, // 30 days
      path: '/',
    });
    return response;
  }

  // Invalid token — redirect back to login with error
  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('error', 'invalid');
  loginUrl.searchParams.set('next', next);
  return NextResponse.redirect(loginUrl);
}
