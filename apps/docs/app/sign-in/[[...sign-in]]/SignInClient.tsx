'use client';

import { SignIn } from '@clerk/nextjs';

export function SignInClient() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
      <SignIn />
    </div>
  );
}
