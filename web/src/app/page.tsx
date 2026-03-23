import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import type { Metadata } from 'next';
import LandingPage from './(marketing)/page';

export const metadata: Metadata = {
  title: 'SpawnForge - AI-Powered Game Creation Platform',
  description:
    'Create 2D and 3D games in your browser with AI. No downloads, no installs. Describe your game and watch it come to life.',
  openGraph: {
    title: 'SpawnForge - Create Games with AI',
    description:
      'The AI-native browser-based game engine. 327+ MCP commands, visual scripting, one-click publish.',
    type: 'website',
  },
};

export default async function Home() {
  const { userId } = await auth();
  if (userId) {
    redirect('/dashboard');
  }
  return <LandingPage />;
}
