import type { Metadata } from 'next';
import { cache } from 'react';
import { getDb, queryWithResilience } from '@/lib/db/client';
import { publishedGames, users } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { safeAuth } from '@/lib/auth/safe-auth';
import { GamePlayer } from '@/components/play/GamePlayer';
import { Breadcrumbs } from '@/components/marketing/Breadcrumbs';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://spawnforge.ai';

interface PlayPageProps {
  params: Promise<{ userId: string; slug: string }>;
}

/**
 * Fetch game data. Filters for status='published' so drafts never leak via
 * metadata or JSON-LD. Returns null when game is missing, unpublished, or DB
 * is unavailable. React.cache memoizes per-request so generateMetadata and the
 * page body share a single round-trip.
 */
const getGameData = cache(async (clerkId: string, slug: string) => {
  try {
    const [user] = await queryWithResilience(() => getDb()
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(eq(users.clerkId, clerkId))
      .limit(1));
    if (!user) return null;

    const [game] = await queryWithResilience(() => getDb()
      .select({
        title: publishedGames.title,
        description: publishedGames.description,
        createdAt: publishedGames.createdAt,
      })
      .from(publishedGames)
      .where(
        and(
          eq(publishedGames.userId, user.id),
          eq(publishedGames.slug, slug),
          eq(publishedGames.status, 'published')
        )
      )
      .limit(1));
    if (!game) return null;

    return {
      title: game.title,
      description: game.description,
      createdAt: game.createdAt,
      authorName: user.displayName,
    };
  } catch {
    return null;
  }
});

/**
 * Generate dynamic metadata for the published game page.
 * Uses the game title and description for SEO and social sharing.
 */
export async function generateMetadata({
  params,
}: PlayPageProps): Promise<Metadata> {
  const { userId: clerkId, slug } = await params;
  const game = await getGameData(clerkId, slug);

  if (!game) {
    return { title: 'Game Not Found - SpawnForge' };
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
 * No authentication required.
 */
export default async function PlayPage({ params }: PlayPageProps) {
  const { userId, slug } = await params;
  const { userId: viewerClerkId } = await safeAuth();

  const game = await getGameData(userId, slug);

  // VideoGame JSON-LD — user-controlled values from DB (title, description).
  // JSON.stringify does NOT escape '<', so we replace it with < to
  // prevent script tag breakout (XSS via </script> in user content).
  // getGameData filters for status='published', so drafts return null.
  const videoGameJsonLd = game
    ? JSON.stringify({
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
      }).replace(/</g, '\\u003c')
    : null;

  return (
    <>
      {videoGameJsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: videoGameJsonLd }}
        />
      )}
      <div className="mx-auto max-w-7xl px-4 pt-4 sm:px-6 lg:px-8">
        <Breadcrumbs
          items={[
            { label: 'Community', href: '/community' },
            ...(game?.title
              ? [{ label: game.title, href: `/play/${userId}/${slug}` }]
              : []),
          ]}
        />
      </div>
      <GamePlayer
        userId={userId}
        slug={slug}
        isAuthenticated={!!viewerClerkId}
      />
    </>
  );
}
