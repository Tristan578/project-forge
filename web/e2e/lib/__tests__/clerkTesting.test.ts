/**
 * Unit tests for `../clerkTesting.ts` — the hand-rolled equivalent of
 * `@clerk/testing`'s `clerkSetup()` + `setupClerkTestingToken()` that the
 * Clerk-keyed auth-journey job (#8632) runs on.
 *
 * The provider contracts pinned here are Clerk's DOCUMENTED ones, cited next to
 * each assertion (lessons-learned #14: a mocked transport pins whatever you
 * believed, so the belief has to be the documented encoding):
 *   - Testing token: `POST https://api.clerk.com/v1/testing_tokens`, bearer
 *     secret key, response `{ object: 'testing_token', token, expires_at }`.
 *     https://clerk.com/docs/reference/backend/testing-tokens/create-testing-token
 *     ("This method wraps the BAPI endpoint `POST /testing_tokens`") and
 *     @clerk/backend 3.17.2 `TestingTokenAPI` (basePath "/testing_tokens",
 *     API_URL "https://api.clerk.com", API_VERSION "v1").
 *   - Attaching it: "include the token value in the `__clerk_testing_token`
 *     query parameter in your Frontend API requests."
 *     https://clerk.com/docs/guides/development/testing/overview
 *   - Publishable key: `pk_(test|live)_` + base64(`<frontendApi>$`), per
 *     @clerk/shared `parsePublishableKey` / `isValidDecodedPublishableKey`.
 *   - List users: `GET /v1/users?email_address=<email>` returns a JSON ARRAY of
 *     users (@clerk/backend `getUserList`, no `paginated` flag), whose fields
 *     include `id`, `password_enabled`, `two_factor_enabled`.
 *   - Test emails: "Any email with the `+clerk_test` subaddress is a test email
 *     address" and verifies with the code `424242`.
 *     https://clerk.com/docs/guides/development/testing/test-emails-and-phones
 */
import { describe, expect, it, vi } from 'vitest';
import {
  CLERK_BACKEND_API_URL,
  CLERK_TEST_EMAIL_CODE,
  TESTING_TOKEN_PARAM,
  bypassCaptcha,
  createTestingToken,
  findSeededUser,
  frontendApiFromPublishableKey,
  isClerkTestEmail,
  planClerkTesting,
  withTestingToken,
} from '../clerkTesting';

const FAPI = 'happy-hippo-1.clerk.accounts.dev';

/** Build a publishable key the way Clerk does: prefix + base64(`<fapi>$`). */
function pk(prefix: 'pk_test_' | 'pk_live_', host = FAPI): string {
  return prefix + Buffer.from(`${host}$`, 'utf8').toString('base64');
}

// Deliberately recognisable fake values, so a test can assert that an error
// message never echoes a key back into a CI log.
// Assembled at runtime rather than written as literals: a literal live-prefixed
// key trips GitHub push protection's Stripe-key detector, fake or not.
const SK_TEST = ['sk', 'test', 'FAKEsecretFORunitTESTS0000000000'].join('_');
const SK_LIVE = ['sk', 'live', 'FAKEsecretFORunitTESTS0000000000'].join('_');

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('frontendApiFromPublishableKey', () => {
  it('decodes the Frontend API host from a test key', () => {
    expect(frontendApiFromPublishableKey(pk('pk_test_'))).toBe(FAPI);
  });

  it('decodes a live key too (the prefix policy lives in planClerkTesting)', () => {
    expect(frontendApiFromPublishableKey(pk('pk_live_', 'clerk.example.com'))).toBe('clerk.example.com');
  });

  it('rejects a key whose decoded part does not end in $', () => {
    const bad = 'pk_test_' + Buffer.from(FAPI, 'utf8').toString('base64');
    expect(() => frontendApiFromPublishableKey(bad)).toThrow(/publishable key/i);
  });

  it('rejects a key that is not base64 at all', () => {
    expect(() => frontendApiFromPublishableKey('pk_test_!!!not-base64!!!')).toThrow(/publishable key/i);
  });

  it('rejects a decoded host without a dot, or with a second $', () => {
    expect(() => frontendApiFromPublishableKey(pk('pk_test_', 'localhost'))).toThrow(/publishable key/i);
    expect(() => frontendApiFromPublishableKey(pk('pk_test_', 'a.b$c.d'))).toThrow(/publishable key/i);
  });
});

describe('planClerkTesting', () => {
  const keys = {
    CLERK_SECRET_KEY: SK_TEST,
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: pk('pk_test_'),
  };
  const creds = {
    E2E_CLERK_TEST_EMAIL: 'e2e+clerk_test@example.com',
    E2E_CLERK_TEST_PASSWORD: 'correct horse battery staple',
  };

  it('skips (does not throw) when no keys are present and the run is not required', () => {
    const plan = planClerkTesting({});
    expect(plan.mode).toBe('skip');
    if (plan.mode === 'skip') {
      expect(plan.reason).toMatch(/CLERK_SECRET_KEY/);
      expect(plan.reason).toMatch(/NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY/);
    }
  });

  it('fails when keys are absent on a run that requires them (trusted CI)', () => {
    expect(() => planClerkTesting({ E2E_CLERK_TEST_REQUIRED: 'true' })).toThrow(
      /E2E_CLERK_TEST_REQUIRED=true.*CLERK_TEST_SECRET_KEY/s,
    );
  });

  it('treats a half-configured pair like an absent one', () => {
    expect(planClerkTesting({ CLERK_SECRET_KEY: SK_TEST }).mode).toBe('skip');
    expect(() =>
      planClerkTesting({ CLERK_SECRET_KEY: SK_TEST, E2E_CLERK_TEST_REQUIRED: 'true' }),
    ).toThrow(/E2E_CLERK_TEST_REQUIRED=true/);
  });

  it('only the exact string "true" makes the run required', () => {
    for (const value of ['TRUE', '1', 'yes', 'false', '']) {
      expect(planClerkTesting({ E2E_CLERK_TEST_REQUIRED: value }).mode).toBe('skip');
    }
  });

  it('refuses live-instance keys even on an optional run, without echoing them', () => {
    let message = '';
    try {
      planClerkTesting({ CLERK_SECRET_KEY: SK_LIVE, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: pk('pk_live_') });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/sk_test_/);
    expect(message).toMatch(/pk_test_/);
    expect(message).not.toContain(SK_LIVE);
    expect(message).not.toContain(pk('pk_live_'));
  });

  it('refuses a live secret key paired with a test publishable key (and vice versa)', () => {
    expect(() =>
      planClerkTesting({ CLERK_SECRET_KEY: SK_LIVE, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: pk('pk_test_') }),
    ).toThrow(/sk_test_/);
    expect(() =>
      planClerkTesting({ CLERK_SECRET_KEY: SK_TEST, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: pk('pk_live_') }),
    ).toThrow(/pk_test_/);
  });

  it('runs with the decoded Frontend API and the seeded-user credentials', () => {
    const plan = planClerkTesting({ ...keys, ...creds, E2E_CLERK_TEST_REQUIRED: 'true' });
    expect(plan).toEqual({
      mode: 'run',
      required: true,
      secretKey: SK_TEST,
      frontendApi: FAPI,
      credentials: { email: creds.E2E_CLERK_TEST_EMAIL, password: creds.E2E_CLERK_TEST_PASSWORD },
    });
  });

  it('runs without credentials on an optional run (the sign-in test then skips)', () => {
    const plan = planClerkTesting({ ...keys });
    expect(plan.mode).toBe('run');
    if (plan.mode === 'run') {
      expect(plan.required).toBe(false);
      expect(plan.credentials).toBeNull();
    }
  });

  it('fails when a required run has keys but no seeded-user credentials', () => {
    expect(() =>
      planClerkTesting({ ...keys, E2E_CLERK_TEST_EMAIL: creds.E2E_CLERK_TEST_EMAIL, E2E_CLERK_TEST_REQUIRED: 'true' }),
    ).toThrow(/E2E_CLERK_TEST_PASSWORD/);
  });

  it('fails on a malformed publishable key rather than skipping', () => {
    expect(() =>
      planClerkTesting({ CLERK_SECRET_KEY: SK_TEST, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_garbage' }),
    ).toThrow(/publishable key/i);
  });
});

describe('createTestingToken', () => {
  it('POSTs to the documented BAPI endpoint with the secret key as a bearer token', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { object: 'testing_token', token: '1713877200-c_abc', expires_at: 1713880800 }),
    );

    const token = await createTestingToken(SK_TEST, { fetch: fetchImpl });

    expect(token).toBe('1713877200-c_abc');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(CLERK_BACKEND_API_URL).toBe('https://api.clerk.com/v1');
    expect(url).toBe('https://api.clerk.com/v1/testing_tokens');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${SK_TEST}`);
  });

  it('retries a 429 and a 503, then returns the token', async () => {
    const sleep = vi.fn(async () => {});
    const fetchImpl = vi
      .fn<() => Promise<Response>>()
      .mockImplementationOnce(async () => jsonResponse(429, { errors: [{ code: 'too_many_requests' }] }))
      .mockImplementationOnce(async () => jsonResponse(503, {}))
      .mockImplementationOnce(async () => jsonResponse(200, { object: 'testing_token', token: 'tok' }));

    await expect(createTestingToken(SK_TEST, { fetch: fetchImpl, sleep })).resolves.toBe('tok');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('does not retry a 401, and reports the status and Clerk error code without the key', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(401, { errors: [{ code: 'authentication_invalid', message: 'Invalid authentication' }] }),
    );

    const error = await createTestingToken(SK_TEST, { fetch: fetchImpl, sleep: async () => {} }).catch(
      (err: Error) => err,
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(error)).toMatch(/401/);
    expect(String(error)).toMatch(/authentication_invalid/);
    expect(String(error)).not.toContain(SK_TEST);
  });

  it('gives up after the attempt budget on repeated network errors', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });

    await expect(createTestingToken(SK_TEST, { fetch: fetchImpl, sleep: async () => {}, attempts: 3 })).rejects.toThrow(
      /fetch failed/,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('rejects a 200 whose body carries no token', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { object: 'testing_token' }));
    await expect(createTestingToken(SK_TEST, { fetch: fetchImpl })).rejects.toThrow(/no token/i);
  });
});

describe('findSeededUser', () => {
  it('queries the documented list-users endpoint by email and summarises the first match', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, [
        { object: 'user', id: 'user_123', password_enabled: true, two_factor_enabled: false },
      ]),
    );

    const user = await findSeededUser(SK_TEST, 'e2e+clerk_test@example.com', { fetch: fetchImpl });

    expect(user).toEqual({ id: 'user_123', passwordEnabled: true, twoFactorEnabled: false });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://api.clerk.com/v1/users');
    expect(parsed.searchParams.getAll('email_address')).toEqual(['e2e+clerk_test@example.com']);
    expect(init.method ?? 'GET').toBe('GET');
    expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${SK_TEST}`);
  });

  it('returns null when no user has that email', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, []));
    await expect(findSeededUser(SK_TEST, 'nobody@example.com', { fetch: fetchImpl })).resolves.toBeNull();
  });

  it('throws on a body that is not the documented array shape', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { data: [] }));
    await expect(findSeededUser(SK_TEST, 'x@example.com', { fetch: fetchImpl })).rejects.toThrow(/array/);
  });
});

describe('withTestingToken', () => {
  it('appends the documented query parameter to a Frontend API /v1 request', () => {
    const out = withTestingToken(`https://${FAPI}/v1/client?_clerk_js_version=5.0.0`, FAPI, 'tok-1');
    expect(TESTING_TOKEN_PARAM).toBe('__clerk_testing_token');
    expect(out).not.toBeNull();
    const url = new URL(out!);
    expect(url.searchParams.get('__clerk_testing_token')).toBe('tok-1');
    expect(url.searchParams.get('_clerk_js_version')).toBe('5.0.0');
    expect(url.pathname).toBe('/v1/client');
  });

  it('leaves every other request alone', () => {
    expect(withTestingToken('http://localhost:3000/v1/client', FAPI, 'tok')).toBeNull();
    expect(withTestingToken(`https://${FAPI}/npm/@clerk/clerk-js@5/dist/clerk.browser.js`, FAPI, 'tok')).toBeNull();
    expect(withTestingToken(`http://${FAPI}/v1/client`, FAPI, 'tok')).toBeNull();
    // Lookalike hosts must not receive the token.
    expect(withTestingToken(`https://evil-${FAPI}/v1/client`, FAPI, 'tok')).toBeNull();
    expect(withTestingToken(`https://${FAPI}.evil.example/v1/client`, FAPI, 'tok')).toBeNull();
  });
});

describe('bypassCaptcha', () => {
  it('flips captcha_bypass on both the direct and the piggybacked client payload', () => {
    const direct = { response: { captcha_bypass: false } };
    const piggyback = { client: { captcha_bypass: false }, response: { id: 'sia_1' } };
    expect(bypassCaptcha(direct)).toBe(true);
    expect(direct.response.captcha_bypass).toBe(true);
    expect(bypassCaptcha(piggyback)).toBe(true);
    expect(piggyback.client.captcha_bypass).toBe(true);
  });

  it('reports no change when there is nothing to flip', () => {
    expect(bypassCaptcha({ response: { captcha_bypass: true } })).toBe(false);
    expect(bypassCaptcha({ response: {} })).toBe(false);
    expect(bypassCaptcha(null)).toBe(false);
    expect(bypassCaptcha('text')).toBe(false);
  });
});

describe('isClerkTestEmail', () => {
  it('recognises the documented +clerk_test subaddress', () => {
    expect(isClerkTestEmail('jane+clerk_test@example.com')).toBe(true);
    expect(isClerkTestEmail('Jane+Clerk_Test@Example.com')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isClerkTestEmail('jane@example.com')).toBe(false);
    expect(isClerkTestEmail('jane+clerk_testing@example.com')).toBe(false);
    expect(isClerkTestEmail('jane@clerk_test.example.com')).toBe(false);
    expect(isClerkTestEmail('+clerk_test@')).toBe(false);
  });

  it('exposes the documented fixed verification code', () => {
    expect(CLERK_TEST_EMAIL_CODE).toBe('424242');
  });
});
