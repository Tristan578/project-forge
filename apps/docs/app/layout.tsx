import './globals.css';
import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import { DOCS_URL } from '../lib/site';

export const dynamic = 'force-dynamic';

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

// Clerk validates key format at runtime — skip wrapping when the key is missing
// or malformed. This mirrors the guard web/src/app/layout.tsx has always carried;
// this layout was the one Clerk entry point in the tree without it.
//
// It became load-bearing in @clerk/nextjs 7.8.0 (on main since #9374). Through
// 7.7.5 a missing key in local development took Clerk's keyless branch and
// rendered fine, so an unguarded <ClerkProvider> was harmless. 7.8.0 added a
// `throwMissingPublishableKeyError()` at the top of that same branch
// (dist/esm/app-router/server/ClerkProvider.js), and the branch is entered
// exactly when `canUseKeyless` holds — development, not CI. So `npm run dev` in
// apps/docs now throws for any developer without Clerk keys, while CI (where
// isAutomatedEnvironment() is true) never reaches it. See #9378.
const clerkKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '';
const hasValidClerkKey = clerkKey.startsWith('pk_test_') || clerkKey.startsWith('pk_live_');

export default function RootLayout({ children }: { children: ReactNode }) {
  // Clerk Core 3 (@clerk/nextjs v7) requires <ClerkProvider> INSIDE <body>, not
  // wrapped around <html> — the Next.js 16 cache-components work made the old
  // outer placement a hydration hazard. web/src/app/layout.tsx already does it
  // this way; this layout was still on the pre-Core-3 shape.
  return (
    <html lang="en" className="dark">
      <body>{hasValidClerkKey ? <ClerkProvider>{children}</ClerkProvider> : children}</body>
    </html>
  );
}
