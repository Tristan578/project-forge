import type { Metadata } from 'next';
import { getDb, queryWithResilience } from '@/lib/db/client';
import { publishedGames, users } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { safeAuth } from '@/lib/auth/safe-auth';
import { GamePlayer } from '@/components/play/GamePlayer';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://spawnforge.ai';

interface PlayPageProps {
  params: Promise<{ userId: string; slug: string }>;
}

/**
 * Generate dynamic metadata for the published game page.
 * Uses the game title and description for SEO and social sharing.
 */
export async function generateMetadata({
  params,
}: PlayPageProps): Promise<Metadata> {
  const { userId: clerkId, slug } = await params;

  try {
    const [user] = await queryWithResilience(() => getDb()
      .select({ id: users.id })
      .from(users)
      .where(eq(users.clerkId, clerkId))
      .limit(1));

    if (!user) {
      return { title: 'Game Not Found - SpawnForge' };
    }

    const [game] = await queryWithResilience(() => getDb()
      .select({ title: publishedGames.title, description: publishedGames.description })
      .from(publishedGames)
      .where(
        and(
          eq(publishedGames.userId, user.id),
          eq(publishedGames.slug, slug)
        )
      )
      .limit(1));

    if (!game) {
      return { title: 'Game Not Found - SpawnForge' };
    }

    return {
      title: `${game.title} - SpawnForge`,
      description: game.description || `Play ${game.title} on SpawnForge`,
      alternates: { canonical: `/play/${clerkId}/${slug}` },
    };
  } catch {
    return { title: 'SpawnForge' };
  }
}

/**
 * Fetch game data for VideoGame JSON-LD.
 * Returns null if game not found or DB unavailable.
 */
async function getGameData(clerkId: string, slug: string) {
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
      authorName: user.displayName,
      createdAt: game.createdAt,
    };
  } catch {
    return null;
  }
}

/**
 * /play/[userId]/[slug] -- Public page for playing published games.
 * Server component that renders the client-side game player.
 * No authentication required.
 */
export default async function PlayPage({ params }: PlayPageProps) {
  const { userId, slug } = await params;
  const { userId: viewerClerkId } = await safeAuth();

  const gameData = await getGameData(userId, slug);

  // VideoGame JSON-LD — user-controlled values from DB (title, description).
  // JSON.stringify does NOT escape '<', so we replace it with < to
  // prevent script tag breakout (XSS via </script> in user content).
  const videoGameJsonLd = gameData
    ? JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'VideoGame',
        name: gameData.title,
        description: gameData.description || `Play ${gameData.title} on SpawnForge`,
        url: `${SITE_URL}/play/${userId}/${slug}`,
        gamePlatform: 'Web Browser',
        playMode: 'SinglePlayer',
        applicationCategory: 'Game',
        author: gameData.authorName
          ? { '@type': 'Person', name: gameData.authorName }
          : undefined,
        publisher: {
          '@type': 'Organization',
          name: 'SpawnForge',
          url: SITE_URL,
        },
        datePublished: gameData.createdAt?.toISOString(),
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
      <GamePlayer
        userId={userId}
        slug={slug}
        isAuthenticated={!!viewerClerkId}
      />
    </>
  );
}
