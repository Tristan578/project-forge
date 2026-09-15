import { eq, and } from 'drizzle-orm';
import { getDb, queryWithResilience } from '../db/client';
import { users, providerKeys } from '../db/schema';
import type { Provider } from '../db/schema';
import { decryptProviderKey } from './encryption';
import { deductTokens } from '../tokens/service';
import { PLATFORM_KEY_ENV, getPlatformKeyEnvVar, type RetiredByokProvider } from '../config/providers';
import { TIER_DISPLAY_NAMES } from '../billing/tierPlans';

export interface ResolvedKey {
  type: 'byok' | 'platform';
  key: string;
  metered: boolean;
  usageId?: string;
}

export class ApiKeyError extends Error {
  constructor(
    public code: 'NO_KEY_CONFIGURED' | 'INSUFFICIENT_TOKENS' | 'TIER_NOT_ALLOWED',
    message: string
  ) {
    super(message);
    this.name = 'ApiKeyError';
  }
}

/**
 * Completeness guard: every DB `Provider` EXCEPT the retired ones must have a
 * platform env var in the shared table. Purely a type assertion — erased at
 * compile time — so adding a provider to the DB enum without adding its key
 * here fails `tsc` rather than throwing `undefined` into `process.env[...]` at
 * runtime. Retired providers (Suno, #9522) intentionally have no platform key:
 * the DB enum keeps the historical value but nothing resolves it on the
 * platform path anymore, so they are excluded from the completeness check.
 */
const _PLATFORM_KEY_ENV_COMPLETE = PLATFORM_KEY_ENV satisfies Record<
  Exclude<Provider, RetiredByokProvider>,
  string
>;
void _PLATFORM_KEY_ENV_COMPLETE;

function getPlatformKey(provider: Provider): string {
  // getPlatformKeyEnvVar returns null for a retired/keyless provider (Suno):
  // its platform path is gone, so resolving one throws the same "not
  // configured" error a genuinely-unset key would.
  const envVar = getPlatformKeyEnvVar(provider);
  const key = envVar ? process.env[envVar] : undefined;
  if (!key) {
    throw new Error(`Platform key not configured: ${envVar ?? provider}`);
  }
  return key;
}

/**
 * Resolve which API key to use for a provider call.
 *
 * 1. BYOK key configured → use it (no token cost).
 * 2. No BYOK, tier/balance allows platform keys → resolve the platform key
 *    BEFORE deducting tokens, then deduct. Ordering matters: getPlatformKey()
 *    throws on a missing env var, so resolving first means a server
 *    misconfiguration fails before any balance change — the user is never
 *    charged for a call that can't run (#8597).
 * 3. No key available (starter tier, zero balance, or unconfigured platform
 *    key) → throw with guidance.
 */
export async function resolveApiKey(
  userId: string,
  provider: Provider,
  tokenCost: number,
  operation: string,
  metadata?: Record<string, unknown>
): Promise<ResolvedKey> {
  // 1. Check for BYOK key
  const [byokKey] = await queryWithResilience(() =>
    getDb()
      .select()
      .from(providerKeys)
      .where(and(eq(providerKeys.userId, userId), eq(providerKeys.provider, provider)))
      .limit(1)
  );

  if (byokKey) {
    return {
      type: 'byok',
      key: decryptProviderKey(byokKey.encryptedKey, byokKey.iv),
      metered: false,
    };
  }

  // 2. No BYOK — check user tier and token balance
  const [user] = await queryWithResilience(() =>
    getDb().select().from(users).where(eq(users.id, userId)).limit(1)
  );
  if (!user) throw new Error(`User not found: ${userId}`);

  // Pro tier always has platform key access
  // Other paid tiers can use platform keys if they have addon tokens
  if (user.tier === 'starter') {
    throw new ApiKeyError(
      'TIER_NOT_ALLOWED',
      `The ${TIER_DISPLAY_NAMES.starter} tier cannot use AI generation. Upgrade to ${TIER_DISPLAY_NAMES.hobbyist} and add your own ${provider} API key, or upgrade to ${TIER_DISPLAY_NAMES.pro} for platform keys.`
    );
  }

  const monthlyRemaining = Math.max(0, user.monthlyTokens - user.monthlyTokensUsed);
  const totalAvailable = monthlyRemaining + user.addonTokens;

  if (user.tier !== 'pro' && totalAvailable <= 0) {
    throw new ApiKeyError(
      'NO_KEY_CONFIGURED',
      `No ${provider} API key configured. Add your own key in Settings, ` +
        `upgrade to the ${TIER_DISPLAY_NAMES.pro} tier, or purchase add-on tokens.`
    );
  }

  // 3. Platform key path.
  // Resolve the platform key BEFORE deducting tokens. getPlatformKey throws when
  // the provider's env var is unset (a server misconfiguration). If that throw
  // happened after deductTokens, the user would be charged for a call that can
  // never run and never gets refunded — silent token loss (#8597). Validate the
  // key is present first so a missing key fails before any balance changes.
  const platformKey = getPlatformKey(provider);

  const deduction = await deductTokens(userId, operation, tokenCost, provider, metadata);
  if (!deduction.success) {
    throw new ApiKeyError(
      'INSUFFICIENT_TOKENS',
      `Insufficient tokens. Need ${tokenCost}, have ${deduction.balance.total}. Purchase more tokens to continue.`
    );
  }

  return {
    type: 'platform',
    key: platformKey,
    metered: true,
    usageId: deduction.usageId,
  };
}

/**
 * Resolve a provider key WITHOUT deducting tokens, applying the same
 * BYOK-then-platform precedence as {@link resolveApiKey} — the user's own key
 * first, else the platform env key, else `null`.
 *
 * For a SECONDARY, bundled provider step whose cost is already covered by the
 * primary generation the user paid for: `/api/generate/sprite` resolves the
 * remove.bg key this way to fold background removal into a sprite it already
 * charged for (#9734). It never charges, never checks tier/balance, and returns
 * `null` (rather than throwing) when no key exists, so a deployment or user
 * without a remove.bg key still gets a sprite instead of a failed generation.
 * Do NOT use it for a primary, billable capability — that is `resolveApiKey`.
 */
export async function resolveByokOrPlatformKey(
  userId: string,
  provider: Provider,
): Promise<string | null> {
  const [byokKey] = await queryWithResilience(() =>
    getDb()
      .select()
      .from(providerKeys)
      .where(and(eq(providerKeys.userId, userId), eq(providerKeys.provider, provider)))
      .limit(1)
  );
  if (byokKey) {
    return decryptProviderKey(byokKey.encryptedKey, byokKey.iv);
  }

  const envVar = getPlatformKeyEnvVar(provider);
  const platformKey = envVar ? process.env[envVar] : undefined;
  return platformKey ?? null;
}

/** Store (or update) a BYOK key for a provider */
export async function storeProviderKey(
  userId: string,
  provider: Provider,
  plainKey: string
): Promise<void> {
  const { encryptProviderKey } = await import('./encryption');
  const { encrypted, iv } = encryptProviderKey(plainKey);

  // Upsert: insert or update on conflict.
  // Note: createdAt is reset on key rotation (upsert). A proper updatedAt column
  // would preserve the original creation time, but requires a DB migration.
  await queryWithResilience(() =>
    getDb()
      .insert(providerKeys)
      .values({
        userId,
        provider,
        encryptedKey: encrypted,
        iv,
      })
      .onConflictDoUpdate({
        target: [providerKeys.userId, providerKeys.provider],
        set: {
          encryptedKey: encrypted,
          iv,
          createdAt: new Date(),
        },
      })
  );
}

/** Delete a BYOK key for a provider */
export async function deleteProviderKey(userId: string, provider: Provider): Promise<void> {
  await queryWithResilience(() =>
    getDb()
      .delete(providerKeys)
      .where(and(eq(providerKeys.userId, userId), eq(providerKeys.provider, provider)))
  );
}

/** List which providers have BYOK keys configured */
export async function listConfiguredProviders(
  userId: string
): Promise<{ provider: Provider; createdAt: Date }[]> {
  const keys = await queryWithResilience(() =>
    getDb()
      .select({ provider: providerKeys.provider, createdAt: providerKeys.createdAt })
      .from(providerKeys)
      .where(eq(providerKeys.userId, userId))
  );
  return keys;
}
