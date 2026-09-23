/**
 * Clerk testing support for the Clerk-keyed auth-journey E2E job (#8632, F40).
 *
 * WHY HAND-ROLLED, NOT `@clerk/testing`
 * -------------------------------------
 * `@clerk/testing` would pull `@clerk/backend`/`@clerk/shared` forward past the
 * versions `@clerk/nextjs` pins in the root lockfile, and relocking on the
 * Windows dev box strips platform metadata from unrelated entries. What the
 * job needs from it is small and fully documented, so it lives here instead,
 * with each provider contract cited where it is used:
 *
 *   1. A TESTING TOKEN from the Backend API, which tells Clerk's bot protection
 *      to let this browser through.
 *      https://clerk.com/docs/reference/backend/testing-tokens/create-testing-token
 *      ("This method wraps the BAPI endpoint `POST /testing_tokens`").
 *   2. The token sent on every Frontend API request as a query parameter:
 *      "include the token value in the `__clerk_testing_token` query parameter
 *      in your Frontend API requests."
 *      https://clerk.com/docs/guides/development/testing/overview
 *   3. The Frontend API host, which is encoded in the publishable key
 *      (`pk_test_` + base64(`<host>$`) — @clerk/shared `parsePublishableKey`).
 *
 * This module is pure (no Playwright import) so every branch is unit-tested in
 * `__tests__/clerkTesting.test.ts`; the Playwright wiring is in
 * `../helpers/clerkSession.ts` and the global setup in `./clerkGlobalSetup.ts`.
 */
import { clerkFrontendApiFromPublishableKey } from '../../src/lib/security/csp';

/** Clerk Backend API base (@clerk/backend `API_URL` + `API_VERSION`). */
export const CLERK_BACKEND_API_URL = 'https://api.clerk.com/v1';

/** Query parameter Clerk's Frontend API reads the testing token from. */
export const TESTING_TOKEN_PARAM = '__clerk_testing_token';

/**
 * Fixed verification code for `+clerk_test` addresses on a development
 * instance: "no email with the verification code will be sent. Instead you can
 * use the code `424242`."
 * https://clerk.com/docs/guides/development/testing/test-emails-and-phones
 */
export const CLERK_TEST_EMAIL_CODE = '424242';

/** Env var that makes a missing or partial Clerk configuration FAIL instead of skip. */
export const CLERK_REQUIRED_ENV = 'E2E_CLERK_TEST_REQUIRED';

/** Env vars the global setup publishes to the Playwright workers. */
export const CLERK_FAPI_ENV = 'CLERK_FAPI';
export const CLERK_TESTING_TOKEN_ENV = 'CLERK_TESTING_TOKEN';

const RUNBOOK = 'docs/guides/e2e-clerk-test-user.md';

type Env = Record<string, string | undefined>;

export interface SeededUserCredentials {
  email: string;
  password: string;
}

export type ClerkTestingPlan =
  | { mode: 'skip'; reason: string }
  | {
      mode: 'run';
      required: boolean;
      secretKey: string;
      frontendApi: string;
      credentials: SeededUserCredentials | null;
    };

/**
 * Decode the Frontend API host from a publishable key — the app's own decoder
 * (`clerkFrontendApiFromPublishableKey`, which builds the CSP from the same
 * key), so the host this suite routes is the host the app allowlists. Throws
 * instead of returning null: a configured key that cannot be decoded is a
 * configuration error here, not a reason to skip.
 * @param publishableKey A `pk_test_…` or `pk_live_…` key.
 * @returns The Frontend API host, without scheme.
 */
export function frontendApiFromPublishableKey(publishableKey: string): string {
  const host = clerkFrontendApiFromPublishableKey(publishableKey);
  if (!host) {
    throw new Error(
      'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is not a valid Clerk publishable key ' +
        '(expected pk_test_ followed by base64 of "<frontend-api-host>$").',
    );
  }
  return host;
}

/**
 * Decide whether this Playwright run exercises Clerk, and fail loudly when it
 * must but cannot.
 *
 * - No keys (or only one of the pair): SKIP, unless `E2E_CLERK_TEST_REQUIRED`
 *   is exactly `'true'` — trusted CI sets that, so a deleted or renamed secret
 *   turns the job red instead of into a green run that tested nothing. Fork and
 *   Dependabot PRs never receive repository secrets and leave it `'false'`.
 * - Keys that are not BOTH `sk_test_` / `pk_test_`: always an error. This suite
 *   signs a real user in; it must never point at a production instance.
 * - Keys but no seeded-user credentials: RUN (the Sign In navigation test only
 *   needs keys) with `credentials: null`, or FAIL when the run is required.
 * @param env Environment to read (normally `process.env`).
 * @returns The plan; throws when the configuration is refused.
 */
export function planClerkTesting(env: Env): ClerkTestingPlan {
  const required = env[CLERK_REQUIRED_ENV] === 'true';
  const secretKey = env.CLERK_SECRET_KEY ?? '';
  const publishableKey = env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '';

  if (!secretKey || !publishableKey) {
    const missing = [
      !secretKey ? 'CLERK_SECRET_KEY' : null,
      !publishableKey ? 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY' : null,
    ].filter(Boolean);
    if (required) {
      throw new Error(
        `${CLERK_REQUIRED_ENV}=true but ${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} empty. ` +
          'The auth-journey job maps them from the CLERK_TEST_SECRET_KEY / CLERK_TEST_PUBLISHABLE_KEY ' +
          `repository secrets; restore those (see ${RUNBOOK}) rather than letting the job skip.`,
      );
    }
    return {
      mode: 'skip',
      reason:
        'Clerk test-instance keys are not configured (CLERK_SECRET_KEY and ' +
        'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY must both be set) — expected on fork and Dependabot PRs.',
    };
  }

  const refused = [
    !secretKey.startsWith('sk_test_') ? 'CLERK_SECRET_KEY must start with sk_test_' : null,
    !publishableKey.startsWith('pk_test_') ? 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY must start with pk_test_' : null,
  ].filter(Boolean);
  if (refused.length > 0) {
    // Name the rule, never the value: this message lands in a CI log.
    throw new Error(
      `Refusing to run the Clerk auth journey against a non-development instance: ${refused.join('; ')}. ` +
        `Use the dedicated Clerk TEST instance (${RUNBOOK}).`,
    );
  }

  const frontendApi = frontendApiFromPublishableKey(publishableKey);

  const email = env.E2E_CLERK_TEST_EMAIL ?? '';
  const password = env.E2E_CLERK_TEST_PASSWORD ?? '';
  if (!email || !password) {
    if (required) {
      const missing = [!email ? 'E2E_CLERK_TEST_EMAIL' : null, !password ? 'E2E_CLERK_TEST_PASSWORD' : null]
        .filter(Boolean)
        .join(' and ');
      throw new Error(
        `${CLERK_REQUIRED_ENV}=true but ${missing} is empty — the seeded test user cannot sign in. See ${RUNBOOK}.`,
      );
    }
    return { mode: 'run', required, secretKey, frontendApi, credentials: null };
  }

  return { mode: 'run', required, secretKey, frontendApi, credentials: { email, password } };
}

export interface BackendRequestOptions {
  /** Injected for tests; defaults to the global `fetch`. */
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  /** Injected for tests; defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
  /** Total attempts for retryable failures (429, 5xx, network). Default 3. */
  attempts?: number;
}

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const RETRY_BASE_DELAY_MS = 1_000;

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Clerk's error body is `{ errors: [{ code, message, … }] }`; surface the code. */
async function describeFailure(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { errors?: Array<{ code?: string; message?: string }> };
    const first = body?.errors?.[0];
    if (first) return `${first.code ?? 'unknown_code'}: ${first.message ?? ''}`.trim();
  } catch {
    // Not JSON — the status alone has to do.
  }
  return 'no Clerk error body';
}

async function backendRequest(
  secretKey: string,
  path: string,
  init: RequestInit,
  label: string,
  options: BackendRequestOptions,
): Promise<unknown> {
  const doFetch = options.fetch ?? ((input: string, requestInit?: RequestInit) => fetch(input, requestInit));
  const sleep = options.sleep ?? realSleep;
  const attempts = Math.max(1, options.attempts ?? 3);
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${secretKey}`);

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let response: Response;
    try {
      response = await doFetch(`${CLERK_BACKEND_API_URL}${path}`, { ...init, headers });
    } catch (err) {
      lastError = err;
      if (attempt < attempts) await sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
      continue;
    }
    if (response.ok) return response.json();
    const detail = `${label} failed: HTTP ${response.status} (${await describeFailure(response)})`;
    if (!RETRYABLE_STATUS.has(response.status)) throw new Error(detail);
    lastError = new Error(detail);
    if (attempt < attempts) await sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
  }
  throw lastError instanceof Error ? lastError : new Error(`${label} failed: ${String(lastError)}`);
}

/**
 * Create a Clerk testing token (`POST /v1/testing_tokens`, bearer secret key).
 * Response per the `TestingToken` type: `{ object, token, expires_at }`.
 * @param secretKey The test instance's `sk_test_…` key.
 * @param options Transport overrides for tests.
 * @returns The token string.
 */
export async function createTestingToken(secretKey: string, options: BackendRequestOptions = {}): Promise<string> {
  const body = (await backendRequest(
    secretKey,
    '/testing_tokens',
    { method: 'POST' },
    'Clerk testing-token request (POST /v1/testing_tokens)',
    options,
  )) as { token?: unknown };
  if (typeof body?.token !== 'string' || body.token.length === 0) {
    throw new Error('Clerk testing-token response carried no token.');
  }
  return body.token;
}

export interface SeededUserSummary {
  id: string;
  passwordEnabled: boolean;
  twoFactorEnabled: boolean;
}

/**
 * Look the seeded test user up by email (`GET /v1/users?email_address=…`,
 * which returns a JSON array of users). Used by the global setup to turn a
 * missing or misconfigured user into a named failure instead of a sign-in form
 * that times out.
 * @param secretKey The test instance's `sk_test_…` key.
 * @param email The seeded user's email address.
 * @param options Transport overrides for tests.
 * @returns A summary of the first match, or null when no user has that email.
 */
export async function findSeededUser(
  secretKey: string,
  email: string,
  options: BackendRequestOptions = {},
): Promise<SeededUserSummary | null> {
  const query = new URLSearchParams({ email_address: email }).toString();
  const body = await backendRequest(
    secretKey,
    `/users?${query}`,
    { method: 'GET' },
    'Clerk user lookup (GET /v1/users)',
    options,
  );
  if (!Array.isArray(body)) {
    throw new Error('Clerk user lookup returned a non-array body; expected the documented array of users.');
  }
  const user = body[0] as { id?: unknown; password_enabled?: unknown; two_factor_enabled?: unknown } | undefined;
  if (!user) return null;
  return {
    id: String(user.id),
    passwordEnabled: user.password_enabled === true,
    twoFactorEnabled: user.two_factor_enabled === true,
  };
}

/**
 * Return `url` with the testing token attached when it is a Frontend API
 * request (`https://<frontendApi>/v1/…`, the same scope `@clerk/testing`
 * intercepts), or null for every other request — including look-alike hosts,
 * which must never receive the token.
 * @param url The outgoing request URL.
 * @param frontendApi The instance's Frontend API host.
 * @param token The testing token.
 * @returns The rewritten URL, or null when the request is not for the Frontend API.
 */
export function withTestingToken(url: string, frontendApi: string, token: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.host !== frontendApi || !parsed.pathname.startsWith('/v1/')) {
    return null;
  }
  parsed.searchParams.set(TESTING_TOKEN_PARAM, token);
  return parsed.toString();
}

/**
 * Mirror `@clerk/testing`'s response rewrite: set `captcha_bypass` to true on a
 * `/v1/client` payload (`response`) and on the client piggybacked onto other
 * responses (`client`), so clerk-js does not mount a CAPTCHA widget the testing
 * token already exempts this browser from.
 * @param json A parsed Frontend API response body (mutated in place).
 * @returns Whether anything was flipped.
 */
export function bypassCaptcha(json: unknown): boolean {
  if (!json || typeof json !== 'object') return false;
  let changed = false;
  for (const key of ['response', 'client'] as const) {
    const target = (json as Record<string, unknown>)[key];
    if (target && typeof target === 'object' && (target as Record<string, unknown>).captcha_bypass === false) {
      (target as Record<string, unknown>).captcha_bypass = true;
      changed = true;
    }
  }
  return changed;
}

/**
 * True for a Clerk test email, which a development instance verifies with
 * {@link CLERK_TEST_EMAIL_CODE}. Clerk documents it two ways: "Any email with
 * the `+clerk_test` subaddress" (test-emails-and-phones), and "Emails
 * containing `+clerk_test` (e.g., `testuser+clerk_test_123@example.com`)"
 * (https://clerk.com/docs/guides/development/testing/playwright/test-sign-up-flows).
 * The wider reading is the one that matters here: a seeded user created the
 * way Clerk's own Playwright example creates one carries a suffix, and
 * classifying it as a non-test address would fail a journey that 424242
 * completes. A false positive costs nothing extra — Clerk rejects the code and
 * the journey fails on the form's own error.
 * @param email Address to classify.
 * @returns Whether Clerk treats it as a test address.
 */
export function isClerkTestEmail(email: string): boolean {
  return /^[^@\s]+\+clerk_test[^@\s]*@[^@\s]+\.[^@\s]+$/i.test(email);
}
