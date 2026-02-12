import { eq, and } from 'drizzle-orm';
import { getDb } from '../db/client';
import { users, providerKeys } from '../db/schema';
import type { Provider, Tier } from '../db/schema';
import { decryptProviderKey } from './encryption';
import { deductTokens } from '../tokens/service';

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

const PLATFORM_KEY_ENV: Record<Provider, string> = {
  anthropic: 'PLATFORM_ANTHROPIC_KEY',
  meshy: 'PLATFORM_MESHY_KEY',
  hyper3d: 'PLATFORM_HYPER3D_KEY',
  elevenlabs: 'PLATFORM_ELEVENLABS_KEY',
  suno: 'PLATFORM_SUNO_KEY',
};

function getPlatformKey(provider: Provider): string {
  const envVar = PLATFORM_KEY_ENV[provider];
  const key = process.env[envVar];
  if (!key) {
    throw new Error(`Platform key not configured: ${envVar}`);
  }
  return key;
}

/**
 * Resolve which API key to use for a provider call.
 *
 * 1. Check if user has a BYOK key → use it (no token cost)
 * 2. Check if user can use platform keys → deduct tokens first
 * 3. No key available → throw with guidance
 */
export async function resolveApiKey(
  userId: string,
  provider: Provider,
  tokenCost: number,
  operation: string,
  metadata?: Record<string, unknown>
): Promise<ResolvedKey> {
  const db = getDb();

  // 1. Check for BYOK key
  const [byokKey] = await db
    .select()
    .from(providerKeys)
    .where(and(eq(providerKeys.userId, userId), eq(providerKeys.provider, provider)))
    .limit(1);

  if (byokKey) {
    return {
      type: 'byok',
      key: decryptProviderKey(byokKey.encryptedKey, byokKey.iv),
      metered: false,
    };
  }

  // 2. No BYOK — check user tier and token balance
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new Error(`User not found: ${userId}`);

  // Studio tier always has platform key access
  // Other paid tiers can use platform keys if they have addon tokens
  if (user.tier === 'free') {
    throw new ApiKeyError(
      'TIER_NOT_ALLOWED',
      `Free tier cannot use AI generation. Upgrade to Starter and add your own ${provider} API key, or upgrade to Studio for platform keys.`
    );
  }

  const monthlyRemaining = Math.max(0, user.monthlyTokens - user.monthlyTokensUsed);
  const totalAvailable = monthlyRemaining + user.addonTokens;

  if (user.tier !== 'studio' && totalAvailable <= 0) {
    throw new ApiKeyError(
      'NO_KEY_CONFIGURED',
      `No ${provider} API key configured. Add your own key in Settings, ` +
        `upgrade to Studio tier, or purchase add-on tokens.`
    );
  }

  // 3. Platform key path — deduct tokens first
  const deduction = await deductTokens(userId, operation, tokenCost, provider, metadata);
  if (!deduction.success) {
    throw new ApiKeyError(
      'INSUFFICIENT_TOKENS',
      `Insufficient tokens. Need ${tokenCost}, have ${deduction.balance.total}. Purchase more tokens to continue.`
    );
  }

  return {
    type: 'platform',
    key: getPlatformKey(provider),
    metered: true,
    usageId: deduction.usageId,
  };
}

/** Store (or update) a BYOK key for a provider */
export async function storeProviderKey(
  userId: string,
  provider: Provider,
  plainKey: string
): Promise<void> {
  const db = getDb();
  const { encryptProviderKey } = await import('./encryption');
  const { encrypted, iv } = encryptProviderKey(plainKey);

  // Upsert: insert or update on conflict
  await db
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
    });
}

/** Delete a BYOK key for a provider */
export async function deleteProviderKey(userId: string, provider: Provider): Promise<void> {
  const db = getDb();
  await db
    .delete(providerKeys)
    .where(and(eq(providerKeys.userId, userId), eq(providerKeys.provider, provider)));
}

/** List which providers have BYOK keys configured */
export async function listConfiguredProviders(
  userId: string
): Promise<{ provider: Provider; createdAt: Date }[]> {
  const db = getDb();
  const keys = await db
    .select({ provider: providerKeys.provider, createdAt: providerKeys.createdAt })
    .from(providerKeys)
    .where(eq(providerKeys.userId, userId));
  return keys;
}
