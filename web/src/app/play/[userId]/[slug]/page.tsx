import type { Metadata } from 'next';
import { getDb, queryWithResilience } from '@/lib/db/client';
import { publishedGames, users } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { safeAuth } from '@/lib/auth/safe-auth';
import { GamePlayer } from '@/components/play/GamePlayer';

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
    };
  } catch {
    return { title: 'SpawnForge' };
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

  return (
    <GamePlayer
      userId={userId}
      slug={slug}
      isAuthenticated={!!viewerClerkId}
    />
  );
}
