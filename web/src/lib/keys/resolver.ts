import { eq, and } from 'drizzle-orm';
import { getDb, queryWithResilience } from '../db/client';
import { users, providerKeys } from '../db/schema';
import type { Provider } from '../db/schema';
import { decryptProviderKey } from './encryption';
import { deductTokens } from '../tokens/service';
import {
  PLATFORM_KEY_ENV,
  getPlatformKeyEnvVar,
  GATEWAY_KEY_ENV,
  isResolverGatewayCapability,
  isVercelRuntime,
  type ProviderCapability,
  type RetiredByokProvider,
} from '../config/providers';
import { TIER_DISPLAY_NAMES } from '../billing/tierPlans';
import { effectiveTier, spendableTokensOf } from '../ai/tierAccess';
import type { Tier } from '@/lib/db/schema';
import { STATUS_CHECK_OPERATION } from './statusCheckOperation';

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

function getPlatformKey(provider: Provider, capability?: ProviderCapability): string {
  // A resolver-gateway capability (image/embedding, #9523) resolves the single
  // AI_GATEWAY_API_KEY instead of the provider's PLATFORM_* var, and never
  // falls back to it: those capabilities have no direct platform path anymore,
  // so a direct key present but the gateway key absent must still fail rather
  // than silently route around the gateway. `isResolverGatewayCapability` reads
  // RESOLVER_GATEWAY_CAPABILITIES — the SAME routing the availability gates
  // apply through CAPABILITY_ENV_VARS — so key resolution and feature gating
  // cannot disagree (lesson 1). `chat` is deliberately NOT in that set: it is
  // gateway-served but also has direct/OpenRouter/GitHub-Models backends, so
  // forcing it here 500'd every direct-Anthropic deployment when the gateway
  // key was unset (#10074). Only the platform path is affected; the BYOK check
  // in resolveApiKey runs first and is keyed on the provider, so a user's own
  // OpenAI key still wins.
  if (capability && isResolverGatewayCapability(capability)) {
    const gatewayKey = process.env[GATEWAY_KEY_ENV.vercelGateway];
    if (gatewayKey) return gatewayKey;
    // Vercel OIDC auto-auth: on a Vercel runtime the AI Gateway needs no
    // explicit key — the runtime injects an OIDC token — so return the empty
    // key the gateway client reads as "use OIDC" (mirroring
    // vercelGatewayBackend.isConfigured()/getApiKey()), rather than 500ing an
    // OIDC-only deployment the gateway backend would have served (#10074).
    if (isVercelRuntime()) return '';
    throw new Error(`Platform key not configured: ${GATEWAY_KEY_ENV.vercelGateway}`);
  }

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
 *
 * Exception to 2-3: a status poll (`tokenCost` 0 AND `operation`
 * `STATUS_CHECK_OPERATION`) gets the platform key with no tier or balance
 * check and no deduction — the polled job was paid for at creation. Its tier
 * control is the route's poll gate, `panelTierGateResponseForPoll`.
 *
 * `capability` is optional and affects only the platform path: when it is a
 * resolver-gateway capability (image/embedding, #9523 — NOT chat, see
 * `RESOLVER_GATEWAY_CAPABILITIES`) the platform key resolves to
 * AI_GATEWAY_API_KEY rather than the provider's PLATFORM_* var, or to the empty
 * key on a Vercel OIDC runtime. BYOK precedence, tier gating, token deduction
 * and the ResolvedKey shape are identical on both routes — the gateway changes
 * only WHICH platform secret is read, so token accounting and the circuit
 * breaker (both keyed on `provider`) behave the same. Existing 5-arg callers
 * omit it and keep the direct route. An empty key is an OIDC sentinel; a future
 * consumer must use a gateway endpoint/model adapter and OIDC-aware SDK.
 * This function does not authenticate an upstream HTTP request.
 * @param userId Internal user whose stored credentials and balance are checked.
 * @param provider Provider used for BYOK lookup and ledger attribution.
 * @param tokenCost Platform token charge, applied after credential resolution.
 * @param operation Ledger operation name.
 * @param metadata Optional server-derived billing metadata.
 * @param capability Optional server-derived capability selecting credential policy.
 * @returns Stored unmetered BYOK credential or metered platform credential and usage ID.
 * @throws ApiKeyError for tier or balance restrictions; Error for missing user or credentials.
 */
export async function resolveApiKey(
  userId: string,
  provider: Provider,
  tokenCost: number,
  operation: string,
  metadata?: Record<string, unknown>,
  capability?: ProviderCapability
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

  // Status poll of an already-paid job (#7715). The job's tokens were
  // deducted when it was CREATED, so the live balance says nothing about
  // whether its result may be read. A trial starter whose one generation
  // spent the whole grant, or a hobbyist left at exactly 0, would otherwise be
  // refused here on every poll: the client never receives the result, and the
  // durable webhook finalizes the paid job as failed and refunds it. So a
  // zero-cost STATUS_CHECK_OPERATION skips the tier and balance checks below,
  // and it neither deducts nor records usage. The only tier control left for
  // polls is the per-route poll gate (`panelTierGateResponseForPoll` in
  // `@/lib/api/panelTierGate`), which still refuses a $0 account on a
  // creator-or-above panel and a starter that never held tokens on every
  // hobbyist panel. It is NOT a job-ownership check: the status routes do not
  // bind jobId to the caller (pre-existing, tracked in #10262). BYOK was already preferred above, and
  // `getPlatformKey` still throws when the platform key is not configured.
  // BOTH halves are required: a charged call named `status_check`, or a free
  // call named anything else, still goes through every check.
  if (tokenCost === 0 && operation === STATUS_CHECK_OPERATION) {
    return { type: 'platform', key: getPlatformKey(provider, capability), metered: true };
  }

  // Pro tier always has platform key access. Other paid tiers can use
  // platform keys while they have tokens. A starter account with spendable
  // tokens (the signup trial grant, #7715) is treated as hobbyist here, the
  // same rule `/api/chat` and the editor's panel gate apply; once the tokens
  // are spent it is a starter account again and the message below applies.
  if (effectiveTier(user.tier as Tier, spendableTokensOf(user)) === 'starter') {
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
  const platformKey = getPlatformKey(provider, capability);

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
 * @param userId Internal user ID whose encrypted BYOK key is queried.
 * @param provider Secondary provider to resolve.
 * @returns Decrypted BYOK or platform key, or null when neither is configured.
 * @throws Lookup and decryption errors; callers choose whether to degrade.
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
