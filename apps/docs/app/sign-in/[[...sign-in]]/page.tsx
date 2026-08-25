import type { Metadata } from 'next';
import { hasValidClerkKey } from '../../../lib/clerk';
import { SignInClient } from './SignInClient';

// Clerk's <SignIn> calls useSession() during SSR, which needs ClerkProvider
// context from a real request. Mirrors web/src/app/sign-in.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Sign In',
};

export default function SignInPage() {
  // /sign-in is public, so it is reachable in a checkout with no Clerk keys —
  // and app/layout.tsx does not render <ClerkProvider> there, so <SignIn /> would
  // throw. Render an explanation instead of crashing the route.
  if (!hasValidClerkKey()) {
    return (
      <main>
        <h1>Sign-in is unavailable</h1>
        <p>
          This deployment has no Clerk publishable key configured, so
          authentication is disabled. Set <code>NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY</code>{' '}
          to enable it.
        </p>
        <p>
          <a href="/">Back to the documentation</a>
        </p>
      </main>
    );
  }

  return <SignInClient />;
}
