'use cache';

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'SpawnForge - AI-Powered Game Creation Platform',
  description:
    'Create 2D and 3D games in your browser with AI. No downloads, no installs. Describe your game and watch it come to life.',
  openGraph: {
    title: 'SpawnForge - Create Games with AI',
    description:
      'The AI-native browser-based game engine. 350 MCP commands, visual scripting, one-click publish.',
    type: 'website',
  },
};

export default async function MarketingLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="min-h-screen overflow-y-auto bg-zinc-950 text-zinc-100">
      {children}
    </div>
  );
}
