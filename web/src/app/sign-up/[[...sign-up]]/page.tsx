import type { Metadata } from 'next';
import { SignUpClient } from './SignUpClient';

// Force dynamic rendering — Clerk's <SignUp> calls useSession() during SSR,
// which requires ClerkProvider context from a real request.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Sign Up — SpawnForge',
};

export default function SignUpPage() {
  return <SignUpClient />;
}
