import { eq } from 'drizzle-orm';
import { getDb } from '../db/client';
import {
  users,
  apiKeys,
  providerKeys,
  tokenUsage,
  tokenPurchases,
  projects,
  publishedGames,
  costLog,
  creditTransactions,
  gameRatings,
  gameComments,
  gameLikes,
  gameForks,
  gameTags,
  userFollows,
  assetReviews,
  assetPurchases,
  sellerProfiles,
  marketplaceAssets,
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

/** Cascading hard delete of a user and all their data */
export async function deleteUserAccount(userId: string): Promise<void> {
  const db = getDb();

  // Get user's published game IDs for dependent table cleanup
  const userGames = await db
    .select({ id: publishedGames.id })
    .from(publishedGames)
    .where(eq(publishedGames.userId, userId));
  const gameIds = userGames.map((g) => g.id);

  // Get user's project IDs for dependent table cleanup
  const userProjects = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.userId, userId));
  const projectIds = userProjects.map((p) => p.id);

  // Delete in dependency order (children first)

  // 1. Community data on user's games
  if (gameIds.length > 0) {
    for (const gameId of gameIds) {
      await db.delete(gameRatings).where(eq(gameRatings.gameId, gameId));
      await db.delete(gameComments).where(eq(gameComments.gameId, gameId));
      await db.delete(gameLikes).where(eq(gameLikes.gameId, gameId));
      await db.delete(gameTags).where(eq(gameTags.gameId, gameId));
      await db.delete(gameForks).where(eq(gameForks.originalGameId, gameId));
    }
  }

  // 2. User's own community interactions on other games
  await db.delete(gameRatings).where(eq(gameRatings.userId, userId));
  await db.delete(gameComments).where(eq(gameComments.userId, userId));
  await db.delete(gameLikes).where(eq(gameLikes.userId, userId));
  await db.delete(gameForks).where(eq(gameForks.userId, userId));
  await db.delete(userFollows).where(eq(userFollows.followerId, userId));
  await db.delete(userFollows).where(eq(userFollows.followingId, userId));

  // 3. Marketplace data
  await db.delete(assetReviews).where(eq(assetReviews.userId, userId));
  await db.delete(assetPurchases).where(eq(assetPurchases.buyerId, userId));
  await db.delete(marketplaceAssets).where(eq(marketplaceAssets.sellerId, userId));
  await db.delete(sellerProfiles).where(eq(sellerProfiles.userId, userId));

  // 4. Published games (after community data is cleaned)
  if (gameIds.length > 0) {
    await db.delete(publishedGames).where(eq(publishedGames.userId, userId));
  }

  // 5. Projects (after published games that reference them)
  if (projectIds.length > 0) {
    await db.delete(projects).where(eq(projects.userId, userId));
  }

  // 6. Financial data
  await db.delete(costLog).where(eq(costLog.userId, userId));
  await db.delete(creditTransactions).where(eq(creditTransactions.userId, userId));
  await db.delete(tokenUsage).where(eq(tokenUsage.userId, userId));
  await db.delete(tokenPurchases).where(eq(tokenPurchases.userId, userId));

  // 7. Keys
  await db.delete(apiKeys).where(eq(apiKeys.userId, userId));
  await db.delete(providerKeys).where(eq(providerKeys.userId, userId));

  // 8. User record
  await db.delete(users).where(eq(users.id, userId));
}
