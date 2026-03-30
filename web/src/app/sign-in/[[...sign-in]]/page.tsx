import type { Metadata } from 'next';
import { SignInClient } from './SignInClient';

export const metadata: Metadata = {
  title: 'Sign In — SpawnForge',
};

export default function SignInPage() {
  return <SignInClient />;
}
