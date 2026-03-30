'use client';

import { SignIn } from '@clerk/nextjs';

export function SignInClient() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950">
      <SignIn fallbackRedirectUrl="/" />
    </div>
  );
}
