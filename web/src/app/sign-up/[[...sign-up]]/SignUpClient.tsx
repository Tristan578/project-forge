'use client';

import { SignUp } from '@clerk/nextjs';

export function SignUpClient() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950">
      <SignUp fallbackRedirectUrl="/" />
    </div>
  );
}
