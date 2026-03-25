import { eq } from 'drizzle-orm';
import { getDb, getNeonSql } from '../db/client';
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
  const db = getDb();
  const email = clerkData.email_addresses[0]?.email_address;
  if (!email) throw new Error('No email found in Clerk data');

  const displayName = [clerkData.first_name, clerkData.last_name].filter(Boolean).join(' ') || null;

  // Upsert user
  const [user] = await db
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
    .returning();

  return user;
}

/** Get user by Clerk ID */
export async function getUserByClerkId(clerkId: string): Promise<User | null> {
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.clerkId, clerkId)).limit(1);
  return user ?? null;
}

/** Get user by internal ID */
export async function getUserById(userId: string): Promise<User | null> {
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return user ?? null;
}

/** Update user tier (called from Stripe webhooks) */
export async function updateUserTier(userId: string, tier: Tier): Promise<void> {
  const db = getDb();
  await db
    .update(users)
    .set({ tier, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

/** Update Stripe customer/subscription IDs */
export async function updateUserStripe(
  userId: string,
  stripeCustomerId: string,
  stripeSubscriptionId?: string
): Promise<void> {
  const db = getDb();
  await db
    .update(users)
    .set({
      stripeCustomerId,
      stripeSubscriptionId: stripeSubscriptionId ?? undefined,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
}

/** Update user display name */
export async function updateDisplayName(
  userId: string,
  displayName: string
): Promise<User> {
  const db = getDb();
  const trimmed = displayName.trim();
  if (trimmed.length === 0) throw new Error('Display name cannot be empty');
  if (trimmed.length > 50) throw new Error('Display name must be 50 characters or less');

  const [user] = await db
    .update(users)
    .set({ displayName: trimmed, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning();

  if (!user) throw new Error('User not found');
  return user;
}

/**
 * Cascading hard delete of a user and all their data.
 *
 * All 18+ DELETE statements are submitted in a single neon sql.transaction()
 * batch so either all rows are removed or none are (PF-976). The reads for
 * game/project IDs happen before the transaction so we can build the
 * per-game delete statements — reads outside the transaction are safe because
 * account deletion is not concurrent with itself.
 */
export async function deleteUserAccount(userId: string): Promise<void> {
  const db = getDb();
  const neonSql = getNeonSql();

  // Read IDs of dependent records before the transaction.
  // These reads are outside the transaction intentionally: the neon-http
  // sql.transaction() API only accepts DML statements (no SELECT inside txn).
  const userGames = await db
    .select({ id: publishedGames.id })
    .from(publishedGames)
    .where(eq(publishedGames.userId, userId));
  const gameIds = userGames.map((g) => g.id);

  const userProjects = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.userId, userId));
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
  }

  // 2. User's own community interactions on other games
  statements.push(neonSql`DELETE FROM game_ratings  WHERE user_id      = ${userId}`);
  statements.push(neonSql`DELETE FROM game_comments WHERE user_id      = ${userId}`);
  statements.push(neonSql`DELETE FROM game_likes    WHERE user_id      = ${userId}`);
  statements.push(neonSql`DELETE FROM game_forks    WHERE user_id      = ${userId}`);
  statements.push(neonSql`DELETE FROM user_follows  WHERE follower_id  = ${userId}`);
  statements.push(neonSql`DELETE FROM user_follows  WHERE following_id = ${userId}`);

  // 3. Marketplace data
  statements.push(neonSql`DELETE FROM asset_reviews      WHERE user_id   = ${userId}`);
  statements.push(neonSql`DELETE FROM asset_purchases    WHERE buyer_id  = ${userId}`);
  statements.push(neonSql`DELETE FROM marketplace_assets WHERE seller_id = ${userId}`);
  statements.push(neonSql`DELETE FROM seller_profiles    WHERE user_id   = ${userId}`);

  // 4. Published games (after community data; only if user had any)
  if (gameIds.length > 0) {
    statements.push(neonSql`DELETE FROM published_games WHERE user_id = ${userId}`);
  }

  // 5. Projects (after published games that may reference them)
  if (projectIds.length > 0) {
    statements.push(neonSql`DELETE FROM projects WHERE user_id = ${userId}`);
  }

  // 6. Generation jobs (references users + projects)
  statements.push(neonSql`DELETE FROM generation_jobs WHERE user_id = ${userId}`);

  // 7. Financial data
  statements.push(neonSql`DELETE FROM cost_log             WHERE user_id = ${userId}`);
  statements.push(neonSql`DELETE FROM credit_transactions  WHERE user_id = ${userId}`);
  statements.push(neonSql`DELETE FROM token_usage          WHERE user_id = ${userId}`);
  statements.push(neonSql`DELETE FROM token_purchases      WHERE user_id = ${userId}`);

  // 8. Keys
  statements.push(neonSql`DELETE FROM api_keys      WHERE user_id = ${userId}`);
  statements.push(neonSql`DELETE FROM provider_keys WHERE user_id = ${userId}`);

  // 9. User record (last — all FK dependents removed above)
  statements.push(neonSql`DELETE FROM users WHERE id = ${userId}`);

  // Execute all statements atomically
  await neonSql.transaction(statements);
}
