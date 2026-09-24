/**
 * Anthropic Workload Identity Federation credential (#8858).
 *
 * The exchange contract pinned here is Anthropic's documented one, NOT a
 * contract inferred from our own code (lessons-learned #14 — a mocked transport
 * pins whatever you believed):
 *   https://platform.claude.com/docs/en/manage-claude/wif-reference#token-exchange-request
 *   https://platform.claude.com/docs/en/manage-claude/wif-reference#token-exchange-response
 * Request: `POST /v1/oauth/token` with JSON `grant_type`
 * (`urn:ietf:params:oauth:grant-type:jwt-bearer`), `assertion`,
 * `federation_rule_id`, `organization_id`, `service_account_id`, and
 * `workspace_id` only when needed. Response: `access_token` ("Pass it as
 * `Authorization: Bearer <token>`"), `token_type` ("Always `Bearer`"),
 * `expires_in` (seconds), `scope`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

import * as Sentry from '@sentry/nextjs';
import {
  ANTHROPIC_TOKEN_EXCHANGE_URL,
  CACHE_SKEW_MS,
  FAILURE_BACKOFF_MS,
  JWT_BEARER_GRANT_TYPE,
  anthropicClientAuthForKey,
  getAnthropicCredential,
  resetAnthropicCredentialCache,
  resolveAnthropicClientAuth,
} from '@/lib/ai/wifCredential';
import { ANTHROPIC_WIF_REQUIRED_ENV, ANTHROPIC_WIF_REQUIRED_ENV_NAMES } from '@/lib/config/anthropicWif';

const mockCaptureException = vi.mocked(Sentry.captureException);

const RULE = 'fdrl_01TESTRULE';
const ORG = '00000000-0000-4000-8000-000000000001';
const SVAC = 'svac_01TESTACCOUNT';
const STATIC_KEY = 'sk-ant-api03-static-platform-key';
const OIDC_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.vercel-oidc-claims.signature';
const MINTED = 'sk-ant-oat01-minted-short-lived-token';
const T0 = new Date('2026-09-24T12:00:00.000Z').getTime();
const REQUEST_CONTEXT = Symbol.for('@vercel/request-context');

function stubWifEnv(): void {
  vi.stubEnv(ANTHROPIC_WIF_REQUIRED_ENV.federationRuleId, RULE);
  vi.stubEnv(ANTHROPIC_WIF_REQUIRED_ENV.organizationId, ORG);
  vi.stubEnv(ANTHROPIC_WIF_REQUIRED_ENV.serviceAccountId, SVAC);
}

function tokenResponse(body: unknown, status = 200): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function okExchange(overrides: Record<string, unknown> = {}): Response {
  return tokenResponse({
    access_token: MINTED,
    token_type: 'Bearer',
    expires_in: 600,
    scope: 'workspace:inference',
    ...overrides,
  });
}

beforeEach(() => {
  resetAnthropicCredentialCache();
  mockCaptureException.mockReset();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  // Clear every variable this module can read, so the real environment of the
  // machine running the suite cannot leak in.
  for (const name of ANTHROPIC_WIF_REQUIRED_ENV_NAMES) vi.stubEnv(name, '');
  vi.stubEnv('ANTHROPIC_WIF_WORKSPACE_ID', '');
  vi.stubEnv('VERCEL_OIDC_TOKEN', OIDC_TOKEN);
  vi.stubEnv('ANTHROPIC_API_KEY', STATIC_KEY);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  delete (globalThis as Record<symbol, unknown>)[REQUEST_CONTEXT];
});

// ---------------------------------------------------------------------------
// Dormant: the current production state
// ---------------------------------------------------------------------------

describe('WIF env absent (static-key fallback)', () => {
  it('returns null with ZERO network calls and never reads the OIDC token', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const contextGet = vi.fn(() => ({ headers: { 'x-vercel-oidc-token': OIDC_TOKEN } }));
    (globalThis as Record<symbol, unknown>)[REQUEST_CONTEXT] = { get: contextGet };

    await expect(getAnthropicCredential()).resolves.toBeNull();
    await expect(resolveAnthropicClientAuth()).resolves.toEqual({ apiKey: STATIC_KEY });

    expect(fetchMock).toHaveBeenCalledTimes(0);
    expect(contextGet).toHaveBeenCalledTimes(0);
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it('passes an UNSET static key through as undefined, like the SDK default singleton read it', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', undefined);
    vi.stubGlobal('fetch', vi.fn());
    const auth = await resolveAnthropicClientAuth();
    expect(auth).toEqual({ apiKey: undefined });
    expect(Object.keys(auth)).toEqual(['apiKey']);
  });
});

describe('partial WIF config', () => {
  it('returns null with no fetch when only the federation rule id is set', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv(ANTHROPIC_WIF_REQUIRED_ENV.federationRuleId, RULE);

    await expect(getAnthropicCredential()).resolves.toBeNull();
    await expect(resolveAnthropicClientAuth()).resolves.toEqual({ apiKey: STATIC_KEY });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null with no fetch for EVERY two-of-three combination', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(ANTHROPIC_WIF_REQUIRED_ENV_NAMES).toHaveLength(3);
    for (const omitted of ANTHROPIC_WIF_REQUIRED_ENV_NAMES) {
      stubWifEnv();
      vi.stubEnv(omitted, '');
      await expect(getAnthropicCredential()).resolves.toBeNull();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Exchange success + cache
// ---------------------------------------------------------------------------

describe('WIF exchange success', () => {
  it('posts the documented jwt-bearer body and returns the token as an authToken (Bearer)', async () => {
    stubWifEnv();
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => okExchange());
    vi.stubGlobal('fetch', fetchMock);

    const auth = await resolveAnthropicClientAuth();

    // Bearer credential -> `authToken`, and ONLY that field: the SDK rejects
    // apiKey + authToken together, and x-api-key would carry a Bearer token.
    expect(auth).toEqual({ authToken: MINTED });
    expect(Object.keys(auth)).toEqual(['authToken']);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    // https://platform.claude.com/docs/en/manage-claude/wif-reference#token-exchange-request
    expect(url).toBe('https://api.anthropic.com/v1/oauth/token');
    expect(url).toBe(ANTHROPIC_TOKEN_EXCHANGE_URL);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'content-type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: OIDC_TOKEN,
      federation_rule_id: RULE,
      organization_id: ORG,
      service_account_id: SVAC,
    });
    expect(JWT_BEARER_GRANT_TYPE).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
  });

  it('sends workspace_id only when ANTHROPIC_WIF_WORKSPACE_ID is set', async () => {
    stubWifEnv();
    vi.stubEnv('ANTHROPIC_WIF_WORKSPACE_ID', 'wrkspc_01TEST');
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => okExchange());
    vi.stubGlobal('fetch', fetchMock);

    await getAnthropicCredential();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).workspace_id).toBe('wrkspc_01TEST');
  });

  it('reads the per-request x-vercel-oidc-token header before VERCEL_OIDC_TOKEN', async () => {
    stubWifEnv();
    (globalThis as Record<symbol, unknown>)[REQUEST_CONTEXT] = {
      get: () => ({ headers: { 'x-vercel-oidc-token': 'header-oidc-jwt' } }),
    };
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => okExchange());
    vi.stubGlobal('fetch', fetchMock);

    await getAnthropicCredential();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).assertion).toBe('header-oidc-jwt');
  });

  it('sets expiresAt from expires_in', async () => {
    stubWifEnv();
    vi.stubGlobal('fetch', vi.fn(async () => okExchange({ expires_in: 600 })));
    const cred = await getAnthropicCredential();
    expect(cred).toEqual({ credential: MINTED, scheme: 'authToken', expiresAt: T0 + 600_000 });
  });

  it('serves a second call within the TTL from cache — no second exchange', async () => {
    stubWifEnv();
    const fetchMock = vi.fn(async () => okExchange({ expires_in: 600 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(resolveAnthropicClientAuth()).resolves.toEqual({ authToken: MINTED });
    vi.setSystemTime(T0 + 30_000);
    await expect(resolveAnthropicClientAuth()).resolves.toEqual({ authToken: MINTED });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('re-exchanges exactly at expiresAt - 60s (the skew buffer), not before', async () => {
    stubWifEnv();
    let n = 0;
    const fetchMock = vi.fn(async () => okExchange({ access_token: `${MINTED}-${++n}`, expires_in: 600 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(CACHE_SKEW_MS).toBe(60_000);

    await getAnthropicCredential();
    const expiresAt = T0 + 600_000;

    vi.setSystemTime(expiresAt - 60_001);
    await expect(getAnthropicCredential()).resolves.toMatchObject({ credential: `${MINTED}-1` });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(expiresAt - 60_000);
    await expect(getAnthropicCredential()).resolves.toMatchObject({ credential: `${MINTED}-2` });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('re-exchanges when the federation config changes instead of serving the old identity', async () => {
    stubWifEnv();
    const fetchMock = vi.fn(async () => okExchange());
    vi.stubGlobal('fetch', fetchMock);

    await getAnthropicCredential();
    vi.stubEnv(ANTHROPIC_WIF_REQUIRED_ENV.serviceAccountId, 'svac_01OTHER');
    await getAnthropicCredential();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Exchange failure -> Sentry + static fallback
// ---------------------------------------------------------------------------

describe('WIF exchange failure falls back to the static key', () => {
  const failures: Array<[string, () => Promise<Response>]> = [
    ['network error', async () => { throw new TypeError('fetch failed'); }],
    ['HTTP 401', async () => tokenResponse({ type: 'error', error: { type: 'authentication_error', message: 'Authentication failed' } }, 401)],
    ['HTTP 500', async () => tokenResponse('upstream exploded', 500)],
    ['non-JSON 200', async () => tokenResponse('<html>not json</html>')],
    ['missing access_token', async () => tokenResponse({ token_type: 'Bearer', expires_in: 600 })],
    ['non-Bearer token_type', async () => okExchange({ token_type: 'mac' })],
    ['missing expires_in', async () => okExchange({ expires_in: undefined })],
    ['non-positive expires_in', async () => okExchange({ expires_in: 0 })],
  ];

  for (const [label, impl] of failures) {
    it(`${label}: captures once, returns null, resolves to the static key, never throws`, async () => {
      stubWifEnv();
      vi.stubGlobal('fetch', vi.fn(impl));

      await expect(getAnthropicCredential()).resolves.toBeNull();
      expect(mockCaptureException).toHaveBeenCalledTimes(1);
      // ONLY the caught error object — no second (context) argument.
      expect(mockCaptureException.mock.calls[0]).toHaveLength(1);
      expect(mockCaptureException.mock.calls[0][0]).toBeInstanceOf(Error);

      // Backed off: the fallback resolves without a second exchange or event.
      await expect(resolveAnthropicClientAuth()).resolves.toEqual({ apiKey: STATIC_KEY });
      expect(mockCaptureException).toHaveBeenCalledTimes(1);
    });
  }

  it('treats a missing OIDC token as a failure without calling the exchange', async () => {
    stubWifEnv();
    vi.stubEnv('VERCEL_OIDC_TOKEN', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(getAnthropicCredential()).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
  });

  it('backs off for FAILURE_BACKOFF_MS after a failure, then retries', async () => {
    stubWifEnv();
    const fetchMock = vi.fn(async () => tokenResponse({}, 401));
    vi.stubGlobal('fetch', fetchMock);

    await getAnthropicCredential();
    vi.setSystemTime(T0 + FAILURE_BACKOFF_MS - 1);
    await expect(getAnthropicCredential()).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(T0 + FAILURE_BACKOFF_MS);
    fetchMock.mockImplementation(async () => okExchange());
    await expect(getAnthropicCredential()).resolves.toMatchObject({ credential: MINTED });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// No-leak: the OIDC JWT and the minted token never reach a log or Sentry
// ---------------------------------------------------------------------------

describe('no credential leaks (PF-828 / #8596)', () => {
  const PLANTED_OIDC = 'PLANTEDOIDC7f3c9a1e5b2d8c4f6a0e3b7d9c1f5a2e8b4d6c0a';
  const PLANTED_TOKEN = 'sk-ant-oat01-PLANTEDTOKEN4e8a2c6f0b3d7e1a5c9f2b6d0e4a8c3f7b1d5';
  // V8 quotes a non-JSON body in full only when it is at most 10 characters
  // (longer bodies get a 10-character prefix), so the SyntaxError channel is
  // exercised with a secret short enough to be quoted whole.
  const PLANTED_SHORT = 'Lk9q7ZxW2';

  /** Every string reachable from a value: messages, stacks, causes, fields. */
  function strings(value: unknown, seen = new Set<unknown>()): string[] {
    if (typeof value === 'string') return [value];
    if (value === null || typeof value !== 'object' || seen.has(value)) return [];
    seen.add(value);
    const out: string[] = [];
    if (value instanceof Error) {
      out.push(value.message, value.stack ?? '', ...strings(value.cause, seen));
    }
    for (const key of Object.getOwnPropertyNames(value)) {
      out.push(key, ...strings((value as Record<string, unknown>)[key], seen));
    }
    return out;
  }

  function everythingEmitted(consoleSpies: Array<ReturnType<typeof vi.spyOn>>): string {
    const sentryArgs: unknown[][] = [
      ...vi.mocked(Sentry.captureException).mock.calls,
      ...vi.mocked(Sentry.captureMessage).mock.calls,
      ...vi.mocked(Sentry.addBreadcrumb).mock.calls,
    ];
    const consoleArgs = consoleSpies.flatMap((spy) => spy.mock.calls);
    return [...sentryArgs, ...consoleArgs].flatMap((args) => strings(args)).join('\n');
  }

  const scenarios: Array<[string, () => Promise<Response>]> = [
    // A truncated 200 body carrying the token: any path that folds the body
    // into an error message would surface it here.
    ['truncated JSON 200 carrying the token', async () => tokenResponse(`{"access_token":"${PLANTED_TOKEN}","token_type":"Bea`)],
    // A bare non-JSON 200 body: `JSON.parse` quotes all of it in its SyntaxError.
    ['non-JSON 200 whose whole body is a secret', async () => tokenResponse(PLANTED_SHORT)],
    // A 401 body echoing both values back.
    ['401 echoing the assertion and token', async () => tokenResponse(`{"error":"bad ${PLANTED_OIDC} ${PLANTED_TOKEN}"}`, 401)],
    ['200 with a non-Bearer token_type', async () => tokenResponse({ access_token: PLANTED_TOKEN, token_type: 'mac', expires_in: 600 })],
    ['200 with no expires_in', async () => tokenResponse({ access_token: PLANTED_TOKEN, token_type: 'Bearer' })],
    ['a successful exchange', async () => tokenResponse({ access_token: PLANTED_TOKEN, token_type: 'Bearer', expires_in: 600 })],
  ];

  for (const [label, impl] of scenarios) {
    it(`${label}: neither planted value appears in any Sentry or console argument`, async () => {
      stubWifEnv();
      vi.stubEnv('VERCEL_OIDC_TOKEN', PLANTED_OIDC);
      const fetchMock = vi.fn((_url: string, _init: RequestInit) => impl());
      vi.stubGlobal('fetch', fetchMock);
      const consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
        vi.spyOn(console, m).mockImplementation(() => undefined),
      );

      // Neither function may reject — a thrown message is another channel, and
      // an unexpected rejection fails the test here.
      await getAnthropicCredential();
      await resolveAnthropicClientAuth();

      // The exchange really ran with the planted assertion, so the absence
      // below is a finding rather than a scenario that never happened.
      expect(fetchMock).toHaveBeenCalled();
      expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string).assertion).toBe(PLANTED_OIDC);

      const emitted = everythingEmitted(consoleSpies);
      expect(emitted).not.toContain(PLANTED_OIDC);
      expect(emitted).not.toContain(PLANTED_TOKEN);
      expect(emitted).not.toContain('PLANTEDTOKEN');
      expect(emitted).not.toContain('PLANTEDOIDC');
      expect(emitted).not.toContain(PLANTED_SHORT);
      for (const spy of consoleSpies) spy.mockRestore();
    });
  }

  it('the leak sweep can fail: it finds a planted value when one IS captured', async () => {
    // Guards the guard (lessons-learned #11): prove `everythingEmitted` sees
    // an Error's message, so a clean sweep above means something.
    Sentry.captureException(new Error('boom', { cause: new Error(`inner ${PLANTED_TOKEN}`) }));
    expect(everythingEmitted([])).toContain(PLANTED_TOKEN);
  });
});

// ---------------------------------------------------------------------------
// anthropicClientAuthForKey — resolver keys reaching createAnthropic
// ---------------------------------------------------------------------------

describe('anthropicClientAuthForKey', () => {
  it('maps a token this module minted to authToken, and anything else to apiKey', async () => {
    // Before minting, even an oat01-shaped string stays an apiKey: the mapping
    // is by identity, not by guessing from the prefix.
    expect(anthropicClientAuthForKey(MINTED)).toEqual({ apiKey: MINTED });

    stubWifEnv();
    vi.stubGlobal('fetch', vi.fn(async () => okExchange()));
    await getAnthropicCredential();

    expect(anthropicClientAuthForKey(MINTED)).toEqual({ authToken: MINTED });
    expect(anthropicClientAuthForKey(STATIC_KEY)).toEqual({ apiKey: STATIC_KEY });
    expect(anthropicClientAuthForKey('sk-ant-api03-byok-user-key')).toEqual({ apiKey: 'sk-ant-api03-byok-user-key' });
  });
});
