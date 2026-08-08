import type { Metadata } from 'next';
import LandingPage from '@/components/marketing/LandingPage';
import { MCP_COMMAND_COUNT } from '@/lib/mcp/manifestStats';

export const metadata: Metadata = {
  title: 'SpawnForge - AI-Powered Game Creation Platform',
  description:
    'Create 2D and 3D games in your browser with AI. No downloads, no installs. Describe your game and watch it come to life.',
  alternates: { canonical: '/' },
  openGraph: {
    title: 'SpawnForge - Create Games with AI',
    description:
      `The AI-native browser-based game engine. ${MCP_COMMAND_COUNT} MCP commands, visual scripting, one-click publish.`,
    type: 'website',
  },
};

// Auth redirect moved to proxy.ts — landing page can be statically cached.
export default function Home() {
  return <LandingPage />;
}
