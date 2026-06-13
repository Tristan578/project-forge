import type { Metadata } from 'next';
import { SignUpClient } from './SignUpClient';

export const metadata: Metadata = {
  title: 'Early Access — SpawnForge',
  description:
    "SpawnForge is in development. Join the waitlist for early access and we'll email you when your spot is ready.",
};

export default function SignUpPage() {
  return <SignUpClient />;
}
