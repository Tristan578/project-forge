import type { Metadata } from 'next';
import LandingPage from './(marketing)/page';

export const metadata: Metadata = {
  title: 'SpawnForge - AI-Powered Game Creation Platform',
  description:
    'Create 2D and 3D games in your browser with AI. No downloads, no installs. Describe your game and watch it come to life.',
  alternates: { canonical: '/' },
  openGraph: {
    title: 'SpawnForge - Create Games with AI',
    description:
      'The AI-native browser-based game engine. 350 MCP commands, visual scripting, one-click publish.',
    type: 'website',
  },
};

// Auth redirect moved to proxy.ts — landing page can be statically cached.
export default function Home() {
  return <LandingPage />;
}
