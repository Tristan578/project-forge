import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';
import LandingPage from './(marketing)/page';

export const metadata: Metadata = {
  title: 'SpawnForge - AI-Powered Game Creation Platform',
  description:
    'Create 2D and 3D games in your browser with AI. No downloads, no installs. Describe your game and watch it come to life.',
  keywords: [
    'game engine', 'AI game creation', 'browser game maker', 'game development',
    '2D game engine', '3D game engine', 'no-code game maker', 'WebGPU',
  ],
  openGraph: {
    title: 'SpawnForge - Create Games with AI',
    description:
      'The AI-native browser-based game engine. 350+ MCP commands, visual scripting, one-click publish.',
    type: 'website',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'SpawnForge AI Game Engine' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'SpawnForge - AI-Powered Game Creation',
    description: 'Create games with AI. No downloads, no installs.',
    images: ['/og-image.png'],
  },
};

export default async function Home() {
  const { userId } = await auth();
  if (userId) {
    redirect('/dashboard');
  }
  return <LandingPage />;
}
