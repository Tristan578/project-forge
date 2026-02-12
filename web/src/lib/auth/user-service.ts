import { eq } from 'drizzle-orm';
import { getDb } from '../db/client';
import { users } from '../db/schema';
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
