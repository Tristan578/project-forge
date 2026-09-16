/** Public published-game page, metadata, and nonce-stamped structured data. */
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { loadPublishedGameMetadata } from '@/lib/play/gameMetadata';
import { GAME_NOT_FOUND_PAGE_TITLE } from '@/lib/play/notFoundDocument';
import { safeAuth } from '@/lib/auth/safe-auth';
import { GamePlayer } from '@/components/play/GamePlayer';
import { Breadcrumbs } from '@/components/marketing/Breadcrumbs';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://spawnforge.ai';

/** Asynchronous author/slug route parameters supplied by Next.js. */
interface PlayPageProps {
  /** Author Clerk identifier and published game slug. */
  params: Promise<{ userId: string; slug: string }>;
}

/** Share one lookup between metadata and body within a React server render. */
const getGameData = cache(loadPublishedGameMetadata);

/**
 * Generate dynamic metadata for the published game page.
 * Uses the game title and description for SEO and social sharing.
 * @param props Next.js asynchronous author/slug parameters.
 * @returns Published metadata or the missing-game title without game data.
 */
export async function generateMetadata({
  params,
}: PlayPageProps): Promise<Metadata> {
  const { userId: clerkId, slug } = await params;
  const game = await getGameData(clerkId, slug);

  // Single source of truth for the missing-game title. When the game is null the
  // page body below calls notFound() and Next renders the colocated
  // not-found.tsx for the visible UX; that file deliberately exports no metadata
  // so the 404 <title> is defined here alone.
  if (!game) {
    return { title: GAME_NOT_FOUND_PAGE_TITLE };
  }

  return {
    title: `${game.title} - SpawnForge`,
    description: game.description || `Play ${game.title} on SpawnForge`,
    alternates: { canonical: `/play/${clerkId}/${slug}` },
  };
}

/**
 * /play/[userId]/[slug] -- Public page for playing published games.
 * Server component that renders the client-side game player.
 * No authentication required. Proxy preflight returns a direct document 404
 * before streaming; notFound below also guards a game removed after preflight.
 * @param props Next.js asynchronous author/slug parameters.
 * @returns Published player, breadcrumbs, and escaped structured data.
 * @throws Next.js notFound control flow when no published metadata is available.
 */
export default async function PlayPage({ params }: PlayPageProps) {
  const { userId, slug } = await params;
  const { userId: viewerClerkId } = await safeAuth();

  // /play runs a nonce-based CSP with no 'unsafe-inline' (PF-1018). The JSON-LD
  // tag below does not strictly need this: `type="application/ld+json"` is a
  // data block, not executable script, so `script-src` never gates it (verified
  // in production — two un-nonced ld+json tags produced zero CSP violations).
  // It is stamped anyway because the distinction is subtle and the cost is one
  // attribute: any EXECUTABLE inline <script> added to this page later WOULD be
  // blocked, and the nonce is then already wired. Next.js stamps its own
  // bootstrap scripts from the request CSP header; app-authored tags are not.
  const nonce = (await headers()).get('x-nonce') ?? undefined;

  const game = await getGameData(userId, slug);

  // The proxy preflight handles document 404 status before this streamed render.
  // This guard catches a game removed between that lookup and rendering; Next
  // may already have streamed headers, so it cannot guarantee a new HTTP status.
  // notFound terminates rendering and adds noindex without a game body.
  if (!game) {
    notFound();
  }

  // VideoGame JSON-LD — user-controlled values from DB (title, description).
  // JSON.stringify does NOT escape '<', so we replace it with a Unicode escape to
  // prevent script tag breakout (XSS via </script> in user content).
  // getGameData filters for status='published', so drafts return null.
  const videoGameJsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'VideoGame',
    name: game.title,
    description: game.description || `Play ${game.title} on SpawnForge`,
    url: `${SITE_URL}/play/${userId}/${slug}`,
    gamePlatform: 'Web Browser',
    playMode: 'SinglePlayer',
    applicationCategory: 'Game',
    author: game.authorName
      ? { '@type': 'Person', name: game.authorName }
      : undefined,
    publisher: {
      '@type': 'Organization',
      name: 'SpawnForge',
      url: SITE_URL,
    },
    datePublished: game.createdAt?.toISOString(),
  }).replace(/</g, '\\u003c');

  return (
    <>
      <script
        type="application/ld+json"
        nonce={nonce}
        dangerouslySetInnerHTML={{ __html: videoGameJsonLd }}
      />
      <div className="mx-auto max-w-7xl px-4 pt-4 sm:px-6 lg:px-8">
        <Breadcrumbs
          items={[
            { label: 'Community', href: '/community' },
            { label: game.title, href: `/play/${userId}/${slug}` },
          ]}
        />
      </div>
      <div data-testid="game-player-route-mount">
        <GamePlayer
          userId={userId}
          slug={slug}
          isAuthenticated={!!viewerClerkId}
        />
      </div>
    </>
  );
}
