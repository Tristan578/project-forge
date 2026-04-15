import './globals.css';
import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { ClerkProvider } from '@clerk/nextjs';

export const dynamic = 'force-dynamic';

const DOCS_URL = process.env.NEXT_PUBLIC_DOCS_URL ?? 'https://docs.spawnforge.ai';

export const metadata: Metadata = {
  metadataBase: new URL(DOCS_URL),
  title: {
    default: 'SpawnForge Documentation',
    template: '%s | SpawnForge Docs',
  },
  description:
    'API reference, MCP command documentation, and getting started guides for SpawnForge — the AI-powered game creation platform. 350 commands across 41 categories.',
  openGraph: {
    title: 'SpawnForge Documentation',
    description:
      'MCP command reference and API docs for SpawnForge — the AI-native browser game engine.',
    siteName: 'SpawnForge Docs',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en" className="dark">
        <body>{children}</body>
      </html>
    </ClerkProvider>
  );
}
