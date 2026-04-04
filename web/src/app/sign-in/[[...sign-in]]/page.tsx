import type { Metadata } from 'next';
import { SignInClient } from './SignInClient';

// Force dynamic rendering — Clerk's <SignIn> calls useSession() during SSR,
// which requires ClerkProvider context from a real request. Without this,
// static prerendering fails for bot crawlers (SPAWNFORGE-AI-2).
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Sign In — SpawnForge',
};

export default function SignInPage() {
  return <SignInClient />;
}
