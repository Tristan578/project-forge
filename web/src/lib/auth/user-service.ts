import { eq } from 'drizzle-orm';
import { getDb, getNeonSql, queryWithResilience } from '../db/client';
import {
  users,
  projects,
  publishedGames,
} from '../db/schema';
import type { Tier, User } from '../db/schema';

/** Find or create a user from Clerk webhook data */
export async function syncUserFromClerk(clerkData: {
  id: string;
  email_addresses: { email_address: string }[];
  first_name?: string | null;
  last_name?: string | null;
}): Promise<User> {
  const email = clerkData.email_addresses[0]?.email_address;
  if (!email) throw new Error('No email found in Clerk data');

  const displayName = [clerkData.first_name, clerkData.last_name].filter(Boolean).join(' ') || null;

  // Upsert user
  const [user] = await queryWithResilience(() =>
    getDb()
      .insert(users)
      .values({
        clerkId: clerkData.id,
        email,
        displayName,
      })
      .onConflictDoUpdate({
        target: users.clerkId,
        set: {
          email,
          displayName,
          updatedAt: new Date(),
        },
      })
      .returning()
  );

  return user;
}

/** Get user by Clerk ID */
export async function getUserByClerkId(clerkId: string): Promise<User | null> {
  const [user] = await queryWithResilience(() =>
    getDb().select().from(users).where(eq(users.clerkId, clerkId)).limit(1)
  );
  return user ?? null;
}

/** Get user by internal ID */
export async function getUserById(userId: string): Promise<User | null> {
  const [user] = await queryWithResilience(() =>
    getDb().select().from(users).where(eq(users.id, userId)).limit(1)
  );
  return user ?? null;
}

/** Update user tier (called from Stripe webhooks) */
export async function updateUserTier(userId: string, tier: Tier): Promise<void> {
  await queryWithResilience(() =>
    getDb()
      .update(users)
      .set({ tier, updatedAt: new Date() })
      .where(eq(users.id, userId))
  );
}

/** Update Stripe customer/subscription IDs */
export async function updateUserStripe(
  userId: string,
  stripeCustomerId: string,
  stripeSubscriptionId?: string
): Promise<void> {
  await queryWithResilience(() =>
    getDb()
      .update(users)
      .set({
        stripeCustomerId,
        stripeSubscriptionId: stripeSubscriptionId ?? undefined,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
  );
}

/** Update user display name */
export async function updateDisplayName(
  userId: string,
  displayName: string
): Promise<User> {
  const trimmed = displayName.trim();
  if (trimmed.length === 0) throw new Error('Display name cannot be empty');
  if (trimmed.length > 50) throw new Error('Display name must be 50 characters or less');

  const [user] = await queryWithResilience(() =>
    getDb()
      .update(users)
      .set({ displayName: trimmed, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning()
  );

  if (!user) throw new Error('User not found');
  return user;
}

/**
 * Cascading hard delete of a user and all their data.
 *
 * All DELETE statements are submitted in a single neon sql.transaction()
 * batch so either all rows are removed or none are (PF-976). The reads for
 * game/project IDs happen before the transaction so we can build the
 * per-game delete statements — reads outside the transaction are safe because
 * account deletion is not concurrent with itself.
 *
 * Deletion order enforces FK constraints:
 *   community data on games
 *   → user's own community interactions
 *   → other users' reviews/purchases on this user's marketplace assets
 *   → user's own marketplace interactions
 *   → marketplace_assets / seller_profiles
 *   → featured_games (FK → published_games)
 *   → published_games
 *   → generation_jobs (FK → projects)
 *   → projects
 *   → financial / key data
 *   → users
 */
export async function deleteUserAccount(userId: string): Promise<void> {
  const neonSql = getNeonSql();

  // Read IDs of dependent records before the transaction.
  // These reads are outside the transaction intentionally: the neon-http
  // sql.transaction() API only accepts DML statements (no SELECT inside txn).
  const userGames = await queryWithResilience(() =>
    getDb()
      .select({ id: publishedGames.id })
      .from(publishedGames)
      .where(eq(publishedGames.userId, userId))
  );
  const gameIds = userGames.map((g) => g.id);

  const userProjects = await queryWithResilience(() =>
    getDb()
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.userId, userId))
  );
  const projectIds = userProjects.map((p) => p.id);

  // Build the full list of DELETE statements in dependency order.
  // All statements are sent to Postgres in a single BEGIN/COMMIT batch.
  // If any statement errors, Postgres rolls back the entire transaction.
  const statements: ReturnType<typeof neonSql>[] = [];

  // 1. Community data on user's games (per-game deletes)
  for (const gameId of gameIds) {
    statements.push(neonSql`DELETE FROM game_ratings  WHERE game_id  = ${gameId}`);
    statements.push(neonSql`DELETE FROM game_comments WHERE game_id  = ${gameId}`);
    statements.push(neonSql`DELETE FROM game_likes    WHERE game_id  = ${gameId}`);
    statements.push(neonSql`DELETE FROM game_tags     WHERE game_id  = ${gameId}`);
    statements.push(neonSql`DELETE FROM game_forks    WHERE original_game_id = ${gameId}`);
    // featured_games FK → published_games: must delete before published_games
    statements.push(neonSql`DELETE FROM featured_games WHERE game_id = ${gameId}`);
  }

  // 2. User's own community interactions on other games
  statements.push(neonSql`DELETE FROM game_ratings  WHERE user_id      = ${userId}`);
  statements.push(neonSql`DELETE FROM game_comments WHERE user_id      = ${userId}`);
  statements.push(neonSql`DELETE FROM game_likes    WHERE user_id      = ${userId}`);
  statements.push(neonSql`DELETE FROM game_forks    WHERE user_id      = ${userId}`);
  statements.push(neonSql`DELETE FROM user_follows  WHERE follower_id  = ${userId}`);
  statements.push(neonSql`DELETE FROM user_follows  WHERE following_id = ${userId}`);

  // 3. Other users' reviews and purchases on THIS user's marketplace assets
  //    (FK: asset_reviews.asset_id → marketplace_assets.id,
  //         asset_purchases.asset_id → marketplace_assets.id)
  //    Must precede the marketplace_assets delete below.
  statements.push(
    neonSql`DELETE FROM asset_reviews   WHERE asset_id IN (SELECT id FROM marketplace_assets WHERE seller_id = ${userId})`,
  );
  statements.push(
    neonSql`DELETE FROM asset_purchases WHERE asset_id IN (SELECT id FROM marketplace_assets WHERE seller_id = ${userId})`,
  );

  // 4. User's own marketplace interactions (reviews/purchases on other sellers' assets)
  statements.push(neonSql`DELETE FROM asset_reviews   WHERE user_id  = ${userId}`);
  statements.push(neonSql`DELETE FROM asset_purchases WHERE buyer_id = ${userId}`);

  // 5. Marketplace assets and profile (after all dependent rows removed)
  statements.push(neonSql`DELETE FROM marketplace_assets WHERE seller_id = ${userId}`);
  statements.push(neonSql`DELETE FROM seller_profiles    WHERE user_id   = ${userId}`);

  // 6. Published games (after community data and featured_games; only if user had any)
  if (gameIds.length > 0) {
    statements.push(neonSql`DELETE FROM published_games WHERE user_id = ${userId}`);
  }

  // 7. Generation jobs — must come BEFORE projects because generation_jobs.project_id
  //    is a FK that references projects.id. Deleting projects first causes a FK violation.
  statements.push(
    neonSql`DELETE FROM generation_jobs WHERE project_id IN (SELECT id FROM projects WHERE user_id = ${userId})`,
  );
  // Catch-all: jobs that reference the user directly but may not be linked to a project
  statements.push(neonSql`DELETE FROM generation_jobs WHERE user_id = ${userId}`);

  // 8. Projects (after generation_jobs)
  if (projectIds.length > 0) {
    statements.push(neonSql`DELETE FROM projects WHERE user_id = ${userId}`);
  }

  // 9. Financial data
  statements.push(neonSql`DELETE FROM cost_log             WHERE user_id = ${userId}`);
  statements.push(neonSql`DELETE FROM credit_transactions  WHERE user_id = ${userId}`);
  statements.push(neonSql`DELETE FROM token_usage          WHERE user_id = ${userId}`);
  statements.push(neonSql`DELETE FROM token_purchases      WHERE user_id = ${userId}`);

  // 10. Keys
  statements.push(neonSql`DELETE FROM api_keys      WHERE user_id = ${userId}`);
  statements.push(neonSql`DELETE FROM provider_keys WHERE user_id = ${userId}`);

  // 11. Feedback and moderation appeals (FK references users.id)
  statements.push(neonSql`DELETE FROM feedback            WHERE user_id = ${userId}`);
  statements.push(neonSql`DELETE FROM moderation_appeals  WHERE user_id = ${userId}`);

  // 12. User record (last — all FK dependents removed above)
  statements.push(neonSql`DELETE FROM users WHERE id = ${userId}`);

  // Execute all statements atomically
  await queryWithResilience(() => neonSql.transaction(statements));
}
