/**
 * Centralized environment variable validation.
 *
 * Call `validateEnvironment()` at app startup (e.g. from `instrumentation.ts`)
 * to fail fast with clear error messages instead of crashing on the first
 * user request that touches an unconfigured service.
 *
 * Required vars throw in production/staging when missing.
 * Optional vars are documented with their defaults.
 */

// Import from the crypto-free format module, NOT from `@/lib/keys/encryption`:
// validateEnv is loaded via instrumentation.ts `register()`, which runs in the
// edge runtime too, where node `crypto` (pulled in by encryption.ts) is unavailable.
import { MASTER_KEY_HEX } from '@/lib/keys/masterKeyFormat';
import { ASSET_STORAGE_ENV } from '@/lib/config/assetStorage';
import {
  ANTHROPIC_WIF_REQUIRED_ENV,
  ANTHROPIC_WIF_REQUIRED_ENV_NAMES,
  ANTHROPIC_WIF_WORKSPACE_ENV,
  missingAnthropicWifEnv,
} from '@/lib/config/anthropicWif';

/** Descriptor for a required environment variable. */
interface RequiredVar {
  key: string;
  description: string;
}

/** Descriptor for an optional environment variable with a default. */
interface OptionalVar {
  key: string;
  description: string;
  defaultValue: string;
}

/** Required environment variables — app will not start without these in production. */
const REQUIRED_VARS: RequiredVar[] = [
  { key: 'DATABASE_URL', description: 'Neon PostgreSQL connection string' },
  { key: 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', description: 'Clerk publishable key for auth' },
  { key: 'CLERK_SECRET_KEY', description: 'Clerk secret key for server-side auth' },
  { key: 'STRIPE_SECRET_KEY', description: 'Stripe secret key for payments' },
  { key: 'STRIPE_WEBHOOK_SECRET', description: 'Stripe webhook verification secret' },
  { key: 'UPSTASH_REDIS_REST_URL', description: 'Upstash Redis URL for distributed rate limiting' },
  { key: 'UPSTASH_REDIS_REST_TOKEN', description: 'Upstash Redis token for distributed rate limiting' },
  { key: 'ENCRYPTION_MASTER_KEY', description: '64-hex-char master key for BYOK AES-256-GCM encryption' },
];

/** Optional environment variables — app works without these, using defaults. */
const OPTIONAL_VARS: OptionalVar[] = [
  {
    key: 'ANTHROPIC_API_KEY',
    description: 'Anthropic API key for direct AI calls (AI Gateway OIDC is preferred)',
    defaultValue: '',
  },
  // Anthropic Workload Identity Federation (#8858) — all three or none; see
  // `@/lib/config/anthropicWif` and docs/guides/anthropic-wif-setup.md. Unset,
  // the direct chat client uses ANTHROPIC_API_KEY exactly as before.
  {
    key: ANTHROPIC_WIF_REQUIRED_ENV.federationRuleId,
    description: 'Anthropic WIF federation rule ID (fdrl_...) for the token exchange',
    defaultValue: '',
  },
  {
    key: ANTHROPIC_WIF_REQUIRED_ENV.organizationId,
    description: 'Anthropic organization UUID for the WIF token exchange',
    defaultValue: '',
  },
  {
    key: ANTHROPIC_WIF_REQUIRED_ENV.serviceAccountId,
    description: 'Anthropic service account ID (svac_...) the federated token acts as',
    defaultValue: '',
  },
  {
    key: ANTHROPIC_WIF_WORKSPACE_ENV,
    description: 'Anthropic workspace (wrkspc_... or default); needed only when the WIF rule spans several workspaces',
    defaultValue: '',
  },
  {
    key: 'NEXT_PUBLIC_APP_URL',
    description: 'Application URL for redirects',
    defaultValue: 'http://localhost:3000',
  },
  {
    key: 'NEXT_PUBLIC_ENGINE_CDN_URL',
    description: 'WASM engine CDN URL',
    defaultValue: '',
  },
  {
    key: 'DB_RATE_LIMIT_PER_SECOND',
    description: 'Maximum database operations per second across instances',
    defaultValue: '80',
  },
  {
    key: 'SENTRY_DSN',
    description: 'Sentry DSN for server-side error monitoring',
    defaultValue: '',
  },
  {
    key: 'NEXT_PUBLIC_SENTRY_DSN',
    description: 'Sentry DSN for client-side error monitoring',
    defaultValue: '',
  },
  {
    key: 'NEXT_PUBLIC_POSTHOG_KEY',
    description: 'PostHog project API key for product analytics',
    defaultValue: '',
  },
  {
    // Not `CLOUDFLARE_ACCOUNT_ID` — that name is read by nothing in this tree.
    // `lib/storage/r2.ts` (the only R2 consumer) reads the ASSET_* namespace,
    // and `lib/config/assetStorage.ts` is the single source of those names.
    key: ASSET_STORAGE_ENV.accountId,
    description: 'Cloudflare account ID for R2 asset storage',
    defaultValue: '',
  },
  {
    // Optional, not required: R2 asset storage powers the marketplace only, so a
    // missing CDN_URL must not take the whole app down at boot. It is listed
    // here so an unset value is at least announced — without it, the only
    // symptom is `resolveOwnedAssetKey` returning null and asset cleanup
    // deleting nothing, which is invisible until the bucket fills with orphans.
    key: 'CDN_URL',
    description: 'Public host serving R2 marketplace assets (bare hostname; a scheme is tolerated)',
    defaultValue: '',
  },
  {
    key: 'ADMIN_USER_IDS',
    description: 'Comma-separated Clerk user IDs for admin access (admin panel, economics)',
    defaultValue: '',
  },
];

export interface EnvValidationResult {
  valid: boolean;
  missing: string[];
  warnings: string[];
}

/**
 * Validate that all required environment variables are set.
 *
 * - In development (`NODE_ENV === 'development'`), validation is skipped and
 *   always returns `{ valid: true }` so local dev works without full config.
 * - Outside development, unset required vars and invalid present credentials
 *   are reported in `missing`. Staging requires a Stripe secret or restricted
 *   key beginning with sk_test_ or rk_test_; live or malformed keys are invalid.
 *   The development early return skips these credential checks.
 * - Optional vars with missing values produce warnings (informational only).
 *
 * @returns Validation result with unset or invalid required fields in `missing`
 *   and optional configuration notices in `warnings`.
 */
export function validateEnvironment(): EnvValidationResult {
  const isDev = process.env.NODE_ENV === 'development';
  const isStaging = process.env.NEXT_PUBLIC_ENVIRONMENT === 'staging';

  if (isDev) {
    return { valid: true, missing: [], warnings: [] };
  }

  const missing: string[] = [];
  const warnings: string[] = [];

  for (const v of REQUIRED_VARS) {
    if (!process.env[v.key]) {
      missing.push(v.key);
    }
  }

  // Clerk key format validation: test keys in the live production environment
  // cause silent auth failures. A dedicated staging deployment runs with
  // NODE_ENV=production too, so use its explicit environment identity rather
  // than NODE_ENV to preserve the production guard without blocking staging.
  // The failure (x-clerk-auth-reason: dev-browser-missing) redirects ALL
  // pages to /sign-in, including public routes (#7912, #7914).
  const clerkPk = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  if (!isStaging && clerkPk && clerkPk.startsWith('pk_test_')) {
    const msg = 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is a TEST key (pk_test_*) in production. This will break auth for all visitors. Use pk_live_* for production.';
    missing.push('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY');
    console.error(`[validateEnvironment] CRITICAL: ${msg}`);
  }
  const clerkSk = process.env.CLERK_SECRET_KEY;
  if (!isStaging && clerkSk && clerkSk.startsWith('sk_test_')) {
    const msg = 'CLERK_SECRET_KEY is a TEST key (sk_test_*) in production. Use sk_live_* for production.';
    warnings.push(msg);
    console.warn(`[validateEnvironment] WARNING: ${msg}`);
  }

  // Staging and preview must never charge a live payment account. Secrets can
  // remain opaque in Vercel; the running deployment proves their mode at boot.
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (isStaging && stripeKey && !/^(sk|rk)_test_/.test(stripeKey)) {
    missing.push('STRIPE_SECRET_KEY');
    console.error('[validateEnvironment] CRITICAL: Staging requires a Stripe test-mode secret or restricted key.');
  }

  // Encryption key charset validation: a present-but-malformed key (right length,
  // non-hex chars) passes the missing-var check above, then crashes the first
  // BYOK encrypt/decrypt with 'Invalid key length' instead of failing at boot.
  // Catch the misconfiguration here so it surfaces as a clear startup error (#8641).
  const masterKey = process.env.ENCRYPTION_MASTER_KEY;
  if (masterKey && !MASTER_KEY_HEX.test(masterKey)) {
    const msg = 'ENCRYPTION_MASTER_KEY is set but is not a 64-character hex string (32 bytes). BYOK encryption will crash on first use.';
    if (!missing.includes('ENCRYPTION_MASTER_KEY')) missing.push('ENCRYPTION_MASTER_KEY');
    console.error(`[validateEnvironment] CRITICAL: ${msg}`);
  }

  // Anthropic WIF is all-three-or-none (#8858). A partial set is not an error
  // — boot must not break — but it silently leaves federation OFF, so say so.
  const wifMissing = missingAnthropicWifEnv();
  if (wifMissing.length > 0 && wifMissing.length < ANTHROPIC_WIF_REQUIRED_ENV_NAMES.length) {
    const msg = `Anthropic Workload Identity Federation is partially configured — ${wifMissing.join(', ')} not set. Federation stays OFF and direct chat uses ANTHROPIC_API_KEY. Set all of ${ANTHROPIC_WIF_REQUIRED_ENV_NAMES.join(', ')}, or none.`;
    warnings.push(msg);
    console.warn(`[validateEnvironment] WARNING: ${msg}`);
  }

  for (const v of OPTIONAL_VARS) {
    if (!process.env[v.key]) {
      warnings.push(`${v.key} not set — using default: ${v.defaultValue || '(empty)'}`);
    }
  }

  if (missing.length > 0) {
    console.error(
      `[validateEnvironment] Missing required environment variables:\n` +
        missing.map((k) => {
          const desc = REQUIRED_VARS.find((v) => v.key === k)?.description ?? '';
          return `  - ${k}: ${desc}`;
        }).join('\n')
    );
  }

  if (warnings.length > 0) {
    console.warn(
      `[validateEnvironment] Optional variables using defaults:\n` +
        warnings.map((w) => `  - ${w}`).join('\n')
    );
  }

  return { valid: missing.length === 0, missing, warnings };
}

/**
 * Get the value of an optional env var, falling back to its configured default.
 */
export function getOptionalEnv(key: string): string {
  const existing = process.env[key];
  if (existing) return existing;

  const opt = OPTIONAL_VARS.find((v) => v.key === key);
  return opt?.defaultValue ?? '';
}

/** Exported for testing. */
export { REQUIRED_VARS, OPTIONAL_VARS };
