import type { Metadata } from 'next';
import { SignIn } from '@clerk/nextjs';

export const metadata: Metadata = {
  title: 'Sign In — SpawnForge',
};

export default function SignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950">
      <SignIn fallbackRedirectUrl="/" />
    </div>
  );
}
