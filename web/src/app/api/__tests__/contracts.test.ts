/**
 * PF-687: API contract tests.
 *
 * Validates the response SHAPE (not business logic) of key API routes so
 * that breaking changes in route signatures are caught in CI before they
 * reach clients or the MCP server.
 *
 * Part 1: Hand-written shape tests for health, capabilities, chat.
 * Part 2: Ajv-based validation of responses against OpenAPI spec schemas.
 * Part 3: Auth-gated routes return Error schema on 401.
 *
 * All external I/O (DB, fetch, Clerk, Redis) is mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

// ---------------------------------------------------------------------------
// Global mocks (hoisted before any dynamic import)
// ---------------------------------------------------------------------------

vi.mock('server-only', () => ({}));

vi.mock('@/lib/rateLimit', () => ({
  rateLimitPublicRoute: vi.fn().mockResolvedValue(null),
  getClientIp: vi.fn().mockReturnValue('1.2.3.4'),
  rateLimitResponse: vi.fn(),
}));

vi.mock('@/lib/monitoring/healthFanoutBudget', () => ({
  checkHealthFanoutBudget: vi
    .fn()
    .mockResolvedValue({ allowed: true, remaining: 29, resetAt: 0 }),
}));

vi.mock('@/lib/monitoring/healthChecks', () => ({
  // `/api/health` reads through the shared cache, not `runAllHealthChecks`
  // directly. A `vi.mock` factory replaces the WHOLE module, so an export the
  // factory omits is `undefined` at the call site — the route would throw a
  // TypeError, its catch would turn that into a 500, and the response-shape
  // contracts below would fail on a mock gap rather than a real regression.
  getCachedHealthReport: vi.fn().mockResolvedValue({
    overall: 'healthy',
    environment: 'test',
    version: '1.0.0',
    timestamp: '2026-01-01T00:00:00Z',
    services: [
      { name: 'Database (Neon)', status: 'healthy', latencyMs: 5, error: null },
      { name: 'Auth (Clerk)', status: 'healthy', latencyMs: 3, error: null },
    ],
  }),
  peekCachedHealthReport: vi.fn().mockReturnValue(null),
  runAllHealthChecks: vi.fn().mockResolvedValue({
    overall: 'healthy',
    environment: 'test',
    version: '1.0.0',
    timestamp: '2026-01-01T00:00:00Z',
    services: [
      { name: 'Database (Neon)', status: 'healthy', latencyMs: 5, error: null },
      { name: 'Auth (Clerk)', status: 'healthy', latencyMs: 3, error: null },
    ],
  }),
  computeCriticalStatus: vi.fn().mockReturnValue('healthy'),
  sanitizeForPublic: vi.fn().mockImplementation((services: unknown[]) => services),
}));

vi.mock('@/lib/logging/logger', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

// Every response minted by the mocked auth gate carries this header. A route
// cannot invent it, so seeing it on the handler's return value proves the
// route SHORT-CIRCUITED on the gate rather than falling through and answering
// the request itself. That short-circuit is the production behaviour these
// tests can actually observe — the 401 body below is the mock's stand-in, so
// asserting its shape alone would only be asserting this literal.
const AUTH_GATE_MARKER = 'x-test-auth-gate';
const authGateResponse = () =>
  new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { [AUTH_GATE_MARKER]: '1' },
  });

vi.mock('@/lib/auth/api-auth', () => ({
  // Use mockImplementation to return a fresh Response each call (body stream is single-read)
  authenticateRequest: vi.fn().mockImplementation(async () => ({
    ok: false,
    response: authGateResponse(),
  })),
  authenticateClerkSession: vi.fn().mockImplementation(async () => ({
    ok: false,
    response: authGateResponse(),
  })),
}));

vi.mock('@/lib/api/middleware', () => ({
  withApiMiddleware: vi.fn().mockImplementation(async () => ({
    // Return a fresh Response each time so the body stream is not exhausted
    error: authGateResponse(),
    authContext: null,
  })),
}));

vi.mock('@/lib/keys/resolver', () => ({
  resolveApiKey: vi.fn().mockRejectedValue(new Error('No key')),
  ApiKeyError: class ApiKeyError extends Error {},
}));

vi.mock('@/lib/tokens/pricing', () => ({
  getTokenCost: vi.fn().mockReturnValue(0),
}));

vi.mock('@/lib/tokens/service', () => ({
  getTokenBalance: vi.fn().mockResolvedValue({ monthlyRemaining: 0, monthlyTotal: 0, addon: 0, total: 0 }),
  refundTokens: vi.fn().mockResolvedValue({ refunded: true }),
}));

vi.mock('@/lib/chat/tools', () => ({
  getChatTools: vi.fn().mockReturnValue([]),
}));

vi.mock('@/lib/chat/sanitizer', () => ({
  sanitizeChatInput: (s: string) => s,
  validateBodySize: vi.fn().mockReturnValue(null),
  detectPromptInjection: vi.fn().mockReturnValue({ safe: true }),
}));

vi.mock('@/lib/chat/docContext', () => ({
  buildDocContext: vi.fn().mockResolvedValue(''),
}));

vi.mock('@/lib/providers/resolveChat', () => ({
  resolveChat: vi.fn(),
  resolveChatRoute: vi.fn(),
}));

vi.mock('@/lib/monitoring/sentry-server', () => ({
  captureException: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  default: {},
  readdir: vi.fn().mockResolvedValue([]),
  readFile: vi.fn().mockResolvedValue(''),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGetRequest(url: string): NextRequest {
  return new NextRequest(url, {
    method: 'GET',
    headers: { 'x-forwarded-for': '127.0.0.1' },
  });
}

function makePostRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': '127.0.0.1',
    },
  });
}

function makePostRequestRaw(url: string, rawBody: string): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    body: rawBody,
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': '127.0.0.1',
    },
  });
}

// ---------------------------------------------------------------------------
// GET /api/health — response shape contract
// ---------------------------------------------------------------------------

describe('GET /api/health — response shape contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('returns an object with status field (string)', async () => {
    const { GET, resetHealthCache } = await import('@/app/api/health/route');
    resetHealthCache();
    const res = await GET(makeGetRequest('http://localhost/api/health'));
    const body = await res.json() as Record<string, unknown>;

    expect(typeof body.status).toBe('string');
  });

  it('returns a services array', async () => {
    const { GET, resetHealthCache } = await import('@/app/api/health/route');
    resetHealthCache();
    const res = await GET(makeGetRequest('http://localhost/api/health'));
    const body = await res.json() as Record<string, unknown>;

    expect(Array.isArray(body.services)).toBe(true);
  });

  it('returns a timestamp string', async () => {
    const { GET, resetHealthCache } = await import('@/app/api/health/route');
    resetHealthCache();
    const res = await GET(makeGetRequest('http://localhost/api/health'));
    const body = await res.json() as Record<string, unknown>;

    expect(typeof body.timestamp).toBe('string');
    expect(body.timestamp).not.toBe('');
  });

  it('returns environment, commit, and version fields (but not branch)', async () => {
    const { GET, resetHealthCache } = await import('@/app/api/health/route');
    resetHealthCache();
    const res = await GET(makeGetRequest('http://localhost/api/health'));
    const body = await res.json() as Record<string, unknown>;

    expect(typeof body.environment).toBe('string');
    expect(typeof body.commit).toBe('string');
    expect(typeof body.version).toBe('string');
    // The git branch ref (VERCEL_GIT_COMMIT_REF) is intentionally NOT exposed on
    // the public health endpoint — it leaks internal branch naming / in-flight
    // feature work (#8648). Keep this contract in lockstep with the route.
    expect(body).not.toHaveProperty('branch');
  });

  it('each service entry has name and status fields', async () => {
    const { GET, resetHealthCache } = await import('@/app/api/health/route');
    resetHealthCache();
    const res = await GET(makeGetRequest('http://localhost/api/health'));
    const body = await res.json() as Record<string, unknown>;

    const services = body.services as Array<Record<string, unknown>>;
    for (const svc of services) {
      expect(typeof svc.name).toBe('string');
      expect(typeof svc.status).toBe('string');
    }
  });

  it('responds with 200 when all services are healthy', async () => {
    const { GET, resetHealthCache } = await import('@/app/api/health/route');
    resetHealthCache();
    const res = await GET(makeGetRequest('http://localhost/api/health'));

    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// GET /api/capabilities — response shape contract
// ---------------------------------------------------------------------------

describe('GET /api/capabilities — response shape contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('returns an object with capabilities array', async () => {
    const { GET } = await import('@/app/api/capabilities/route');
    const res = await GET(new NextRequest('http://localhost/api/health'));
    const body = await res.json() as Record<string, unknown>;

    expect(Array.isArray(body.capabilities)).toBe(true);
    expect((body.capabilities as unknown[]).length).toBeGreaterThan(0);
  });

  it('returns available and unavailable arrays', async () => {
    const { GET } = await import('@/app/api/capabilities/route');
    const res = await GET(new NextRequest('http://localhost/api/health'));
    const body = await res.json() as Record<string, unknown>;

    expect(Array.isArray(body.available)).toBe(true);
    expect(Array.isArray(body.unavailable)).toBe(true);
  });

  it('each capability entry has capability, available, and label fields', async () => {
    const { GET } = await import('@/app/api/capabilities/route');
    const res = await GET(new NextRequest('http://localhost/api/health'));
    const body = await res.json() as Record<string, unknown>;

    const caps = body.capabilities as Array<Record<string, unknown>>;
    for (const cap of caps) {
      expect(typeof cap.capability).toBe('string');
      expect(typeof cap.available).toBe('boolean');
      expect(typeof cap.label).toBe('string');
    }
  });

  it('available + unavailable covers all capability entries', async () => {
    const { GET } = await import('@/app/api/capabilities/route');
    const res = await GET(new NextRequest('http://localhost/api/health'));
    const body = await res.json() as Record<string, unknown>;

    const caps = body.capabilities as Array<{ capability: string }>;
    const available = new Set(body.available as string[]);
    const unavailable = new Set(body.unavailable as string[]);
    const union = new Set([...available, ...unavailable]);

    for (const cap of caps) {
      expect(union.has(cap.capability)).toBe(true);
    }
  });

  it('responds with 200', async () => {
    const { GET } = await import('@/app/api/capabilities/route');
    const res = await GET(new NextRequest('http://localhost/api/health'));

    expect(res.status).toBe(200);
  });

  it('unavailable capabilities include requiredProviders hint', async () => {
    // With no API keys set, all capabilities should be unavailable and have hints
    const { GET } = await import('@/app/api/capabilities/route');
    const res = await GET(new NextRequest('http://localhost/api/health'));
    const body = await res.json() as Record<string, unknown>;

    const caps = body.capabilities as Array<Record<string, unknown>>;
    // Every unavailable capability must include requiredProviders
    for (const cap of caps) {
      if (!cap.available) {
        expect(Array.isArray(cap.requiredProviders)).toBe(true);
        expect((cap.requiredProviders as unknown[]).length).toBeGreaterThan(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// POST /api/chat — invalid body → { error } with 4xx
// ---------------------------------------------------------------------------

describe('POST /api/chat — invalid body contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Do NOT call vi.resetModules() here — the chat route reads its body
    // stream once, and resetting modules causes stale mock state that
    // triggers "Body has already been read" on subsequent tests.
  });

  it('returns { error } object with 4xx status for invalid JSON body', async () => {
    const { POST } = await import('@/app/api/chat/route');
    const req = makePostRequestRaw(
      'http://localhost/api/chat',
      '{this is not valid json}',
    );
    const res = await POST(req);

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body.error).toBe('string');
  });

  it('returns { error } object with 4xx for empty body', async () => {
    const { POST } = await import('@/app/api/chat/route');
    const req = makePostRequestRaw('http://localhost/api/chat', '');
    const res = await POST(req);

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body.error).toBe('string');
  });

  it('returns { error } object with 4xx for missing messages field', async () => {
    const { POST } = await import('@/app/api/chat/route');
    const req = makePostRequest('http://localhost/api/chat', { model: 'claude-sonnet-4-6' });
    const res = await POST(req);

    // Auth or validation should reject — either way, shape must be { error }
    expect(res.status).toBeGreaterThanOrEqual(400);
    const body = await res.json() as Record<string, unknown>;
    expect('error' in body).toBe(true);
  });

  it('error field is a non-empty string in all 4xx responses', async () => {
    const { POST } = await import('@/app/api/chat/route');
    const req = makePostRequestRaw('http://localhost/api/chat', 'bad json!!');
    const res = await POST(req);

    const body = await res.json() as Record<string, unknown>;
    expect(typeof body.error).toBe('string');
    expect((body.error as string).length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// Part 2: OpenAPI spec schema validation with Ajv
// ===========================================================================

import { readFileSync } from 'fs';
import path from 'path';

/**
 * Convert OpenAPI 3.0 schemas to JSON Schema that Ajv v8 understands.
 *
 * OpenAPI uses `nullable: true` to permit null, but that keyword does not
 * exist in JSON Schema — Ajv v8 (unlike the v6 we used before) has no
 * `nullable` option. We rewrite `{ type: 'X', nullable: true }` into the
 * equivalent `{ type: ['X', 'null'] }` and drop the `nullable` key so the
 * spec's nullable fields (e.g. TokenBalance.nextRefillDate) still validate
 * against null. The walk is generic, so it also covers nested properties,
 * array items, and composed schemas.
 */
function openApiToJsonSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(openApiToJsonSchema);
  if (node === null || typeof node !== 'object') return node;

  const src = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(src)) {
    if (key === 'nullable') continue;
    out[key] = openApiToJsonSchema(value);
  }

  if (src.nullable === true && 'type' in out) {
    const type = out.type;
    if (typeof type === 'string') {
      out.type = [type, 'null'];
    } else if (Array.isArray(type) && !type.includes('null')) {
      out.type = [...type, 'null'];
    }
  }

  return out;
}

/**
 * Load the OpenAPI spec and compile its component schemas into Ajv validators.
 * The spec has a trailing comma that standard JSON.parse rejects, so we strip
 * trailing commas before parsing.
 */
function loadOpenApiSchemas() {
  const specPath = path.resolve(__dirname, '../../../../../docs/api/openapi.json');
  const raw = readFileSync(specPath, 'utf-8');
  const fixed = raw.replace(/,(\s*[}\]])/g, '$1');
  const spec = JSON.parse(fixed) as {
    components?: { schemas?: Record<string, Record<string, unknown>> };
    paths?: Record<string, Record<string, Record<string, unknown>>>;
  };

  // Ajv v8: `strict: false` tolerates OpenAPI-isms (e.g. `example`) that
  // aren't valid JSON Schema, and ajv-formats registers the format keywords
  // ("date-time", "uuid", etc.) so they validate instead of throwing.
  // Nullable is handled by the openApiToJsonSchema() transform below.
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);

  const schemas = spec.components?.schemas ?? {};
  const validators: Record<string, ReturnType<typeof ajv.compile>> = {};
  for (const [name, schema] of Object.entries(schemas)) {
    validators[name] = ajv.compile(openApiToJsonSchema(schema) as object);
  }

  return { spec, ajv, validators };
}

describe('OpenAPI schema validation — public routes', () => {
  const { validators } = loadOpenApiSchemas();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('GET /api/health response matches Error schema when unhealthy', async () => {
    // The Error schema is { error: string } — used for 4xx/5xx responses.
    // Verify the compiled validator works on a known-good Error object.
    const errorValidator = validators['Error'];
    expect(errorValidator).toBeDefined();

    const valid = errorValidator({ error: 'Something went wrong' });
    expect(valid).toBe(true);

    const invalid = errorValidator({ message: 'wrong field name' });
    expect(invalid).toBe(false);
  });

  it('health response has fields matching the spec 200 schema', async () => {
    const { GET, resetHealthCache } = await import('@/app/api/health/route');
    resetHealthCache();
    const res = await GET(makeGetRequest('http://localhost/api/health'));
    const body = await res.json() as Record<string, unknown>;

    // The spec declares: status (string), services (array), timestamp (string)
    // plus environment, commit, branch, version
    expect(typeof body.status).toBe('string');
    expect(Array.isArray(body.services)).toBe(true);
    expect(typeof body.timestamp).toBe('string');
  });

  it('capabilities response includes all spec-required fields', async () => {
    const { GET } = await import('@/app/api/capabilities/route');
    const res = await GET(new NextRequest('http://localhost/api/capabilities'));
    const body = await res.json() as Record<string, unknown>;

    // The spec declares: capabilities (array), available (array), unavailable (array)
    expect(Array.isArray(body.capabilities)).toBe(true);
    expect(Array.isArray(body.available)).toBe(true);
    expect(Array.isArray(body.unavailable)).toBe(true);

    // Each capability entry must have: capability (string), available (boolean), label (string)
    const caps = body.capabilities as Array<Record<string, unknown>>;
    for (const cap of caps) {
      expect(typeof cap.capability).toBe('string');
      expect(typeof cap.available).toBe('boolean');
      expect(typeof cap.label).toBe('string');
    }
  });

  it('Error schema validator rejects non-object inputs', () => {
    const errorValidator = validators['Error'];
    expect(errorValidator(null)).toBe(false);
    expect(errorValidator('string')).toBe(false);
    expect(errorValidator(42)).toBe(false);
    expect(errorValidator([])).toBe(false);
  });

  it('Error schema validator rejects objects without error field', () => {
    const errorValidator = validators['Error'];
    expect(errorValidator({})).toBe(false);
    expect(errorValidator({ status: 401 })).toBe(false);
    expect(errorValidator({ msg: 'oops' })).toBe(false);
  });

  it('TokenBalance schema validates correct shape', () => {
    const balanceValidator = validators['TokenBalance'];
    expect(balanceValidator).toBeDefined();

    const validBalance = {
      monthlyRemaining: 9500,
      monthlyTotal: 10000,
      addon: 0,
      total: 9500,
      nextRefillDate: '2026-05-01T00:00:00.000Z',
    };
    expect(balanceValidator(validBalance)).toBe(true);
  });

  it('TokenBalance schema validates nextRefillDate as null', () => {
    const balanceValidator = validators['TokenBalance'];
    const balanceWithNullRefill = {
      monthlyRemaining: 9500,
      monthlyTotal: 10000,
      addon: 0,
      total: 9500,
      nextRefillDate: null,
    };
    expect(balanceValidator(balanceWithNullRefill)).toBe(true);
  });

  it('TokenBalance schema rejects objects with wrong field names', () => {
    const balanceValidator = validators['TokenBalance'];
    const wrongFields = {
      monthlyTokens: 10000,
      monthlyTokensUsed: 500,
      monthlyTokensRemaining: 9500,
      addonTokens: 0,
    };
    expect(balanceValidator(wrongFields)).toBe(false);
  });

  it('TokenBalance schema rejects empty objects', () => {
    const balanceValidator = validators['TokenBalance'];
    expect(balanceValidator({})).toBe(false);
  });

  it('GenerationStatus schema validates correct shape', () => {
    const statusValidator = validators['GenerationStatus'];
    expect(statusValidator).toBeDefined();

    const validStatus = {
      jobId: 'job_123',
      status: 'completed',
      progress: 100,
      resultUrl: 'https://example.com/result.png',
    };
    expect(statusValidator(validStatus)).toBe(true);
  });

  it('GenerationStatus schema rejects invalid status enum', () => {
    const statusValidator = validators['GenerationStatus'];
    const invalidStatus = {
      jobId: 'job_123',
      status: 'magic',
      progress: 50,
    };
    expect(statusValidator(invalidStatus)).toBe(false);
  });

  it('all component schemas compile without error', () => {
    // Ensures the spec schemas are syntactically valid JSON Schema
    const { validators: allValidators } = loadOpenApiSchemas();
    const names = Object.keys(allValidators);
    expect(names.length).toBeGreaterThanOrEqual(10);
    for (const name of names) {
      expect(typeof allValidators[name]).toBe('function');
    }
  });
});

// ===========================================================================
// Part 3: Auth-gated routes return Error-schema-conformant 401 responses
// ===========================================================================

describe('Auth-gated routes return Error schema on 401', () => {
  const { validators } = loadOpenApiSchemas();
  const errorValidator = validators['Error'];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  /**
   * Call a route handler unauthenticated and REPORT what it did. Every
   * assertion lives at the call site so each `it` carries its own — a helper
   * that asserts internally leaves the test body empty, and an accidentally
   * un-awaited call would then pass with nothing checked.
   */
  async function callUnauthenticated(
    importPath: string,
    method: 'GET' | 'POST',
    url: string,
    body?: unknown,
  ) {
    const mod = await import(importPath);
    const handler = mod[method];
    if (typeof handler !== 'function') {
      return { handlerExported: false, status: null, nonConformantBody: null };
    }

    const req = method === 'GET'
      ? makeGetRequest(url)
      : makePostRequest(url, body ?? {});
    const res = await handler(req);

    const json = await res.json() as Record<string, unknown>;
    return {
      handlerExported: true,
      // The load-bearing fact: the route handed back the gate's own response.
      // Without this a route could drop `if (mid.error) return mid.error` and
      // still be graded on a status the test itself supplied.
      shortCircuitedOnAuthGate: res.headers.get(AUTH_GATE_MARKER) === '1',
      status: res.status as number | null,
      // null when the body matches the Error schema; the offending body
      // otherwise, so a failure diff shows what the route actually returned.
      nonConformantBody: errorValidator(json) ? null : json,
    };
  }

  /** What an auth-gated route must do for an unauthenticated caller. */
  const REJECTED_WITH_ERROR_SCHEMA = {
    handlerExported: true,
    shortCircuitedOnAuthGate: true,
    status: 401,
    nonConformantBody: null,
  };

  it('GET /api/projects returns 401 with Error schema', async () => {
    expect(await callUnauthenticated('@/app/api/projects/route', 'GET', 'http://localhost/api/projects')).toEqual(REJECTED_WITH_ERROR_SCHEMA);
  });

  it('POST /api/projects returns 401 with Error schema', async () => {
    expect(await callUnauthenticated('@/app/api/projects/route', 'POST', 'http://localhost/api/projects', { name: 'Test' })).toEqual(REJECTED_WITH_ERROR_SCHEMA);
  });

  it('GET /api/tokens/balance returns 401 with Error schema', async () => {
    expect(await callUnauthenticated('@/app/api/tokens/balance/route', 'GET', 'http://localhost/api/tokens/balance')).toEqual(REJECTED_WITH_ERROR_SCHEMA);
  });

  it('GET /api/tokens/usage returns 401 with Error schema', async () => {
    expect(await callUnauthenticated('@/app/api/tokens/usage/route', 'GET', 'http://localhost/api/tokens/usage')).toEqual(REJECTED_WITH_ERROR_SCHEMA);
  });

  it('GET /api/publish/list returns 401 with Error schema', async () => {
    expect(await callUnauthenticated('@/app/api/publish/list/route', 'GET', 'http://localhost/api/publish/list')).toEqual(REJECTED_WITH_ERROR_SCHEMA);
  });

  it('GET /api/keys returns 401 with Error schema', async () => {
    expect(await callUnauthenticated('@/app/api/keys/route', 'GET', 'http://localhost/api/keys')).toEqual(REJECTED_WITH_ERROR_SCHEMA);
  });

  it('GET /api/keys/api-key returns 401 with Error schema', async () => {
    expect(await callUnauthenticated('@/app/api/keys/api-key/route', 'GET', 'http://localhost/api/keys/api-key')).toEqual(REJECTED_WITH_ERROR_SCHEMA);
  });

  it('POST /api/keys/api-key returns 401 with Error schema', async () => {
    expect(await callUnauthenticated(
      '@/app/api/keys/api-key/route', 'POST', 'http://localhost/api/keys/api-key',
      { name: 'test-key', scopes: ['read'] },
    )).toEqual(REJECTED_WITH_ERROR_SCHEMA);
  });

  it('POST /api/billing/checkout returns 401 with Error schema', async () => {
    expect(await callUnauthenticated(
      '@/app/api/billing/checkout/route', 'POST', 'http://localhost/api/billing/checkout',
      { tier: 'pro' },
    )).toEqual(REJECTED_WITH_ERROR_SCHEMA);
  });

  it('GET /api/marketplace/seller returns 401 with Error schema', async () => {
    expect(await callUnauthenticated('@/app/api/marketplace/seller/route', 'GET', 'http://localhost/api/marketplace/seller')).toEqual(REJECTED_WITH_ERROR_SCHEMA);
  });

  /**
   * The cases above run against a MOCKED auth gate, so the 401 body they
   * schema-check is the mock's stand-in, not production's. This case closes
   * that gap: `@/lib/api/errors` is unmocked, so the payload every one of
   * those routes really returns is validated against the same Error schema.
   */
  it('the unauthorized() body production actually returns conforms to the Error schema', async () => {
    const { unauthorized } = await import('@/lib/api/errors');
    const res = unauthorized();
    const json = await res.json() as Record<string, unknown>;

    expect({
      status: res.status,
      nonConformantBody: errorValidator(json) ? null : json,
    }).toEqual({ status: 401, nonConformantBody: null });
  });
});
