/** Published-game metadata lookup shared by the play render and response preflight. */
import { getDb, queryWithResilience } from '@/lib/db/client';
import { publishedGames, users } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

/**
 * Fetch game data. Filters for status='published' so drafts never leak via
 * metadata or JSON-LD. Returns null when game is missing, unpublished, or DB
 * is unavailable. Callers may wrap this lookup in React.cache for per-render
 * memoization; the proxy uses it before streaming starts.
 * @param clerkId Public author Clerk identifier.
 * @param slug Published game slug.
 * @returns Published display metadata, or null without an available published game.
 */
export async function loadPublishedGameMetadata(clerkId: string, slug: string) {
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
}
