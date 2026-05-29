import type { Metadata } from 'next';
import { SignUpClient } from './SignUpClient';

export const metadata: Metadata = {
  title: 'Early Access — SpawnForge',
  description:
    'SpawnForge is currently in development. Release details and timeline will be published soon.',
};

export default function SignUpPage() {
  return <SignUpClient />;
}
