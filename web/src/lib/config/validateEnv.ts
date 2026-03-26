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
    key: 'CLOUDFLARE_ACCOUNT_ID',
    description: 'Cloudflare account ID for R2 asset storage',
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
 * - In production/staging, missing required vars are reported as errors.
 * - Optional vars with missing values produce warnings (informational only).
 *
 * @returns Validation result with lists of missing required and optional vars.
 */
export function validateEnvironment(): EnvValidationResult {
  const isDev = process.env.NODE_ENV === 'development';

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
