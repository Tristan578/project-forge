import './globals.css';
import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import { DOCS_URL } from '../lib/site';
import { hasValidClerkKey } from '../lib/clerk';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  metadataBase: new URL(DOCS_URL),
  title: {
    default: 'SpawnForge Documentation',
    template: '%s | SpawnForge Docs',
  },
  // Count-free on purpose: the previous "350 commands across 41 categories"
  // was a hard-coded number nothing compared against the manifest, and it
  // rotted. The measured count lives in the pages that read the manifest and
  // in docs/capability-matrix.md, which a test pins (#9720).
  description:
    'API reference, MCP command documentation, a per-entry-point capability matrix, and getting started guides for SpawnForge — the AI-powered game creation platform.',
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
//
// The predicate lives in lib/clerk.ts because the /sign-in route has to gate on
// the same value — it renders <SignIn />, which needs the provider this skips.

export default function RootLayout({ children }: { children: ReactNode }) {
  // Clerk Core 3 (@clerk/nextjs v7) requires <ClerkProvider> INSIDE <body>, not
  // wrapped around <html> — the Next.js 16 cache-components work made the old
  // outer placement a hydration hazard. web/src/app/layout.tsx already does it
  // this way; this layout was still on the pre-Core-3 shape.
  return (
    <html lang="en" className="dark">
      <body>{hasValidClerkKey() ? <ClerkProvider>{children}</ClerkProvider> : children}</body>
    </html>
  );
}
