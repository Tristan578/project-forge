import { eq } from 'drizzle-orm';
import { getDb, getNeonSql, queryWithResilience } from '../db/client';
import {
  users,
  projects,
  publishedGames,
  marketplaceAssets,
} from '../db/schema';
import type { Tier, User } from '../db/schema';
import {
  deleteManyFromR2,
  resolveOwnedAssetKey,
  withStatusSidecars,
  MAX_R2_SWEEP_KEYS,
} from '../storage/r2';
import { captureException, captureMessage } from '../monitoring/sentry-server';

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
 *
 * After the transaction commits, the user's uploaded marketplace objects are
 * removed from R2 on a best-effort basis (PF-9457) — see the notes at that
 * call site for why storage runs last and why it can never fail the deletion.
 */
/**
 * Upper bound on the number of R2 keys one marketplace asset row can generate:
 * a preview object, an asset file object, and the `.status.json` sidecar the
 * asset post-processing Worker writes beside each of them.
 *
 * This is what converts the sweep's key ceiling (MAX_R2_SWEEP_KEYS) into a row
 * ceiling for the read below. Raising it without raising MAX_R2_SWEEP_KEYS
 * shrinks how many assets a single account deletion can clear; the two move
 * together on purpose.
 */
const R2_KEYS_PER_ASSET = 4;

/**
 * Marketplace asset rows one account-deletion sweep will read.
 *
 * A function, not a module-level `const`: evaluating `MAX_R2_SWEEP_KEYS` at
 * import time makes every module that transitively imports user-service crash
 * on load under a `vi.mock('@/lib/storage/r2')` that does not re-export it —
 * which broke the marketplace download route suite when this was a const.
 */
function sellerAssetReadLimit(): number {
  return Math.floor(MAX_R2_SWEEP_KEYS / R2_KEYS_PER_ASSET);
}

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

  // Read the seller's uploaded marketplace objects BEFORE the transaction —
  // the rows carrying the R2 URLs are about to be deleted.
  //
  // Row cap: each asset row contributes at most R2_KEYS_PER_ASSET keys, so
  // reading at most MAX_R2_SWEEP_KEYS / R2_KEYS_PER_ASSET rows guarantees the
  // key list never exceeds what a single sweep will attempt. We deliberately
  // ask for one row MORE than the cap: the extra row is the only way to tell
  // "exactly at the cap" (nothing left behind) from "past the cap" (a tail we
  // will never see). `.limit(cap)` alone cannot distinguish the two, so a
  // seller with exactly `cap` assets would be reported as truncated when
  // nothing was lost — and, worse, the check would have to be `>=`, which is a
  // false positive on the common boundary.
  //
  // A stable ORDER BY makes the rows we do read deterministic. Without it,
  // Postgres may return any `cap` of the seller's rows, so a truncation report
  // could not tell an operator which objects were already handled.
  const sellerAssetLimit = sellerAssetReadLimit();
  const sellerAssetRows = await queryWithResilience(() =>
    getDb()
      .select({
        id: marketplaceAssets.id,
        previewUrl: marketplaceAssets.previewUrl,
        assetFileUrl: marketplaceAssets.assetFileUrl,
      })
      .from(marketplaceAssets)
      .where(eq(marketplaceAssets.sellerId, userId))
      .orderBy(marketplaceAssets.id)
      .limit(sellerAssetLimit + 1)
  );

  // The row cap is the cap that can actually bite. Rows past it never become
  // keys at all, so deleteManyFromR2's own `truncated` flag stays false and the
  // tail would vanish with no signal anywhere. Say so explicitly instead.
  const assetReadTruncated = sellerAssetRows.length > sellerAssetLimit;
  const sellerAssets = assetReadTruncated
    ? sellerAssetRows.slice(0, sellerAssetLimit)
    : sellerAssetRows;

  // Only keys under this user's own assets/{userId}/{assetId}/ prefix are
  // eligible: previewUrl/assetFileUrl are seller-writable through the asset
  // PATCH route, so an unvalidated key would let a departing seller take
  // another seller's objects down with them.
  //
  // Each resolved key is expanded to include its `.status.json` sidecar — the
  // asset post-processing Worker writes one next to every created object and
  // records it nowhere in Postgres, so a DB-driven sweep that skipped it would
  // leave per-user JSON in the bucket after the account is gone.
  const ownedKeys: string[] = [];
  for (const asset of sellerAssets) {
    const previewKey = resolveOwnedAssetKey(asset.previewUrl, userId, asset.id);
    if (previewKey) ownedKeys.push(previewKey);
    const fileKey = resolveOwnedAssetKey(asset.assetFileUrl, userId, asset.id);
    if (fileKey) ownedKeys.push(fileKey);
  }
  const storageKeys = withStatusSidecars(ownedKeys);

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
    // game_reports.game_id FK -> published_games.id (NOT NULL, no cascade):
    // reports filed by OTHER users against this user's games must go before
    // the published_games delete below or the whole transaction rolls back.
    statements.push(neonSql`DELETE FROM game_reports  WHERE game_id  = ${gameId}`);
    // featured_games FK → published_games: must delete before published_games
    statements.push(neonSql`DELETE FROM featured_games WHERE game_id = ${gameId}`);
  }

  // 2. User's own community interactions on other games
  statements.push(neonSql`DELETE FROM game_ratings  WHERE user_id      = ${userId}`);
  statements.push(neonSql`DELETE FROM game_comments WHERE user_id      = ${userId}`);
  statements.push(neonSql`DELETE FROM game_likes    WHERE user_id      = ${userId}`);
  statements.push(neonSql`DELETE FROM game_forks    WHERE user_id      = ${userId}`);
  // game_reports.reporter_id FK -> users.id: reports this user filed against
  // OTHER creators' games. Without this the final `DELETE FROM users` violates
  // the FK and account deletion fails outright.
  statements.push(neonSql`DELETE FROM game_reports WHERE reporter_id = ${userId}`);
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

  // Object storage last, and best-effort (PF-9457).
  //
  // Ordering: the DB transaction commits first. If R2 went first and the
  // transaction then rolled back, a *live* account would be left pointing at
  // files we had already destroyed. Running it after means the only failure
  // mode is an orphaned object, which is recoverable.
  //
  // Best-effort: nothing below is allowed to throw. An account deletion that
  // half-fails because object storage hiccuped is strictly worse than an
  // orphan — the user's data is already gone from the DB and there is nothing
  // useful for the caller to retry. Failures are logged with their keys so an
  // operator can reconcile them (keys stay enumerable by the assets/{userId}/
  // prefix).
  await deleteUserStorageObjects(userId, storageKeys, assetReadTruncated);
}

/**
 * Best-effort removal of a deleted user's R2 objects. Never throws.
 * See the ordering and failure-mode notes at the call site above.
 */
async function deleteUserStorageObjects(
  userId: string,
  keys: string[],
  assetReadTruncated: boolean
): Promise<void> {
  if (assetReadTruncated) {
    const message = `Account deletion read only the first ${sellerAssetReadLimit()} marketplace assets for user ${userId}; objects under assets/${userId}/ beyond that need reconciliation`;
    console.error(message);
    captureMessage(message, 'error');
  }

  if (keys.length === 0) return;

  try {
    const sweep = await deleteManyFromR2(keys);

    if (sweep.failedKeys.length > 0) {
      const message = `Account deletion left ${sweep.failedKeys.length} orphaned R2 object(s) for user ${userId}`;
      console.error(message, {
        userId,
        failedKeys: sweep.failedKeys,
        errors: sweep.errors,
      });
      captureMessage(message, 'error');
    }

    // Defensive second net. The row cap above is sized so this call site can
    // never overflow the sweep's own key ceiling, so in production the read cap
    // is what fires. This branch exists so that changing R2_KEYS_PER_ASSET (or
    // the key shape) without re-deriving the row cap degrades to a loud report
    // rather than a silent drop.
    if (sweep.truncated) {
      const message = `Account deletion R2 sweep truncated at ${MAX_R2_SWEEP_KEYS} keys for user ${userId}; remaining objects under assets/${userId}/ need reconciliation`;
      console.error(message);
      captureMessage(message, 'error');
    }
  } catch (error) {
    // deleteManyFromR2 is documented not to throw; this is belt-and-braces so
    // an unexpected failure can never surface as a failed account deletion.
    console.error('R2 cleanup failed during account deletion', error);
    captureException(error, { scope: 'deleteUserAccount.r2Cleanup', userId, keyCount: keys.length });
  }
}
