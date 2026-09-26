/**
 * Anthropic Workload Identity Federation for the platform chat key (#8858).
 *
 * Exchanges the Vercel-issued OIDC JWT for a short-lived Anthropic access token
 * bound to a service account, so a leaked environment variable is no longer a
 * credential that works forever. `ANTHROPIC_API_KEY` stays the fallback: every
 * failure here returns `null` and the caller uses the static key, so this
 * module can never be the reason a chat request fails.
 *
 * DORMANT unless all three `ANTHROPIC_WIF_*` variables in
 * `@/lib/config/anthropicWif` are set — then no network call is made at all.
 *
 * The exchange contract, from
 * https://platform.claude.com/docs/en/manage-claude/wif-reference (fetched
 * 2026-09-24):
 *   request   `POST /v1/oauth/token`, JSON body `grant_type`
 *             (`urn:ietf:params:oauth:grant-type:jwt-bearer`), `assertion`,
 *             `federation_rule_id`, `organization_id`, `service_account_id`,
 *             and `workspace_id` when the rule spans several workspaces;
 *   response  `access_token` ("prefixed `sk-ant-oat01-...`. Pass it as
 *             `Authorization: Bearer <token>`"), `token_type` ("Always
 *             `Bearer`"), `expires_in` (seconds), `scope`.
 * So the credential is a Bearer token and belongs in the AI SDK's `authToken`,
 * never `apiKey` (which the SDK sends as `x-api-key`).
 *
 * The installed `@ai-sdk/anthropic` has no federation support and only takes a
 * concrete string, so the exchange is done here. `@anthropic-ai/sdk`, whose
 * `oidcFederationProvider` the docs show, is not a dependency of this repo.
 *
 * SECRETS: neither the OIDC JWT nor the minted token may appear in a log line,
 * a thrown message or a Sentry event (PF-828 / #8596). Every error this module
 * constructs has fixed text, and the one place an error could quote the
 * response body — a malformed JSON body, whose `SyntaxError` message embeds a
 * slice of the input — is replaced before it can be captured.
 */
import * as Sentry from '@sentry/nextjs';
import {
  ANTHROPIC_WIF_REQUIRED_ENV,
  ANTHROPIC_WIF_WORKSPACE_ENV,
  isAnthropicWifConfigured,
} from '@/lib/config/anthropicWif';

export interface WifCredential {
  credential: string;
  scheme: 'apiKey' | 'authToken';
  /** Epoch milliseconds at which the credential stops being valid. */
  expiresAt: number;
}

/** Auth fields for `createAnthropic()`. Exactly one is set by this module. */
export interface AnthropicClientAuth {
  apiKey?: string;
  authToken?: string;
}

/** https://platform.claude.com/docs/en/manage-claude/wif-reference#token-exchange-request */
export const ANTHROPIC_TOKEN_EXCHANGE_URL = 'https://api.anthropic.com/v1/oauth/token';
export const JWT_BEARER_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:jwt-bearer';

/**
 * Re-exchange this long before expiry. Required (#8858): without it a token can
 * expire mid-request on an instance whose clock has drifted.
 */
export const CACHE_SKEW_MS = 60_000;

/**
 * After a failed exchange, skip the next attempts for this long and use the
 * static key straight away. Without it a broken federation config makes EVERY
 * chat request wait on a failing network call and emit a Sentry event.
 */
export const FAILURE_BACKOFF_MS = 60_000;

/** Bound on the exchange call — a hung endpoint must not hang chat. */
export const EXCHANGE_TIMEOUT_MS = 5_000;

interface WifConfig {
  federationRuleId: string;
  organizationId: string;
  serviceAccountId: string;
  workspaceId?: string;
}

// Module-scoped, per function instance, never persisted (#8858 guardrail).
let cached: (WifCredential & { configKey: string }) | null = null;
let backoffUntil = 0;
/**
 * Every token this instance minted and has not yet seen expire, so
 * `anthropicClientAuthForKey()` can tell a minted Bearer token from an API key
 * by identity instead of by guessing from its prefix.
 */
const minted = new Map<string, number>();

function readWifConfig(): WifConfig | null {
  if (!isAnthropicWifConfigured()) return null;
  const workspaceId = process.env[ANTHROPIC_WIF_WORKSPACE_ENV];
  return {
    federationRuleId: process.env[ANTHROPIC_WIF_REQUIRED_ENV.federationRuleId] as string,
    organizationId: process.env[ANTHROPIC_WIF_REQUIRED_ENV.organizationId] as string,
    serviceAccountId: process.env[ANTHROPIC_WIF_REQUIRED_ENV.serviceAccountId] as string,
    ...(workspaceId ? { workspaceId } : {}),
  };
}

function configKeyOf(config: WifConfig): string {
  return [config.federationRuleId, config.organizationId, config.serviceAccountId, config.workspaceId ?? ''].join('|');
}

/**
 * The Vercel OIDC JWT for this invocation. Same lookup as `@vercel/oidc`'s
 * `getVercelOidcTokenSync()` (v3.2.0): the `x-vercel-oidc-token` request header
 * exposed through the runtime's request context, then `VERCEL_OIDC_TOKEN`
 * (build time, and local dev after `vercel env pull`). Inlined because
 * `@vercel/oidc` is only a transitive dependency here; declaring it would add a
 * dependency for a two-line read.
 */
function trimmedNonEmpty(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed;
}

function readVercelOidcToken(): string {
  const store = (globalThis as Record<symbol, unknown>)[Symbol.for('@vercel/request-context')] as
    | { get?: () => { headers?: Record<string, string | undefined> } | undefined }
    | undefined;
  const fromHeader = trimmedNonEmpty(store?.get?.()?.headers?.['x-vercel-oidc-token']);
  const token = fromHeader ?? trimmedNonEmpty(process.env.VERCEL_OIDC_TOKEN);
  if (!token) {
    throw new Error('Anthropic WIF: no Vercel OIDC token (x-vercel-oidc-token header or VERCEL_OIDC_TOKEN)');
  }
  return token;
}

async function exchange(config: WifConfig, assertion: string): Promise<WifCredential> {
  const response = await fetch(ANTHROPIC_TOKEN_EXCHANGE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: JWT_BEARER_GRANT_TYPE,
      assertion,
      federation_rule_id: config.federationRuleId,
      organization_id: config.organizationId,
      service_account_id: config.serviceAccountId,
      ...(config.workspaceId ? { workspace_id: config.workspaceId } : {}),
    }),
    signal: AbortSignal.timeout(EXCHANGE_TIMEOUT_MS),
  });

  if (!response.ok) {
    // The status is the diagnostic; the body is not read — every assertion
    // denial is the same opaque 401 "Authentication failed", and the reason
    // lives in the Console's authentication history (wif-reference#errors).
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`Anthropic WIF token exchange failed: HTTP ${response.status}`);
  }

  let body: unknown;
  try {
    body = JSON.parse(await response.text());
  } catch {
    // Never rethrow the SyntaxError: its message quotes the input, which on a
    // 200 is the body that carries the access token.
    throw new Error('Anthropic WIF token exchange returned a non-JSON body');
  }

  const fields = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const { access_token: accessToken, token_type: tokenType, expires_in: expiresIn } = fields;
  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    throw new Error('Anthropic WIF token exchange response has no access_token');
  }
  // RFC 6749 §5.1: token_type is case-insensitive.
  if (typeof tokenType !== 'string' || tokenType.toLowerCase() !== 'bearer') {
    throw new Error('Anthropic WIF token exchange response is not a Bearer token');
  }
  if (typeof expiresIn !== 'number' || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new Error('Anthropic WIF token exchange response has no valid expires_in');
  }

  return { credential: accessToken, scheme: 'authToken', expiresAt: Date.now() + expiresIn * 1000 };
}

/**
 * The federated Anthropic credential, or `null` when federation is not
 * configured (no network call) or when anything in the exchange fails (reported
 * to Sentry). Cached until `CACHE_SKEW_MS` before expiry.
 */
export async function getAnthropicCredential(): Promise<WifCredential | null> {
  const config = readWifConfig();
  if (!config) return null;

  const configKey = configKeyOf(config);
  const now = Date.now();
  if (cached && cached.configKey === configKey && now < cached.expiresAt - CACHE_SKEW_MS) {
    return { credential: cached.credential, scheme: cached.scheme, expiresAt: cached.expiresAt };
  }
  if (now < backoffUntil) return null;

  try {
    const credential = await exchange(config, readVercelOidcToken());
    cached = { ...credential, configKey };
    for (const [token, expiresAt] of minted) {
      if (expiresAt <= now) minted.delete(token);
    }
    minted.set(credential.credential, credential.expiresAt);
    return credential;
  } catch (err) {
    backoffUntil = Date.now() + FAILURE_BACKOFF_MS;
    // ONLY the caught error — no context object, so nothing in scope here can
    // ride along into the event.
    Sentry.captureException(err);
    return null;
  }
}

/**
 * Auth for the direct Anthropic client: the federated Bearer token when
 * available, else the static `ANTHROPIC_API_KEY` exactly as the SDK's default
 * singleton reads it (undefined when unset, so the SDK still raises its own
 * "API key is missing" error rather than sending an empty header).
 */
export async function resolveAnthropicClientAuth(): Promise<AnthropicClientAuth> {
  const credential = await getAnthropicCredential();
  if (credential) return { [credential.scheme]: credential.credential };
  return { apiKey: process.env.ANTHROPIC_API_KEY };
}

/**
 * Map a key string from `resolveApiKey(…, 'anthropic', …)` to client auth.
 *
 * `getPlatformKey('anthropic')` can now return a minted Bearer token, and a
 * caller that passes it as `apiKey` sends it as `x-api-key`, which Anthropic
 * rejects. Only a token THIS module minted maps to `authToken`; anything else —
 * a BYOK key, the static platform key — keeps the `apiKey` it always used.
 */
export function anthropicClientAuthForKey(key: string): AnthropicClientAuth {
  return minted.has(key) ? { authToken: key } : { apiKey: key };
}

/** Test seam: drop the cached credential, the backoff and the minted set. */
export function resetAnthropicCredentialCache(): void {
  cached = null;
  backoffUntil = 0;
  minted.clear();
}
