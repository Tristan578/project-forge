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
  // `/api/publish/list` gates on `rateLimit()`, not the public-route helper.
  // A `vi.mock` factory replaces the WHOLE module, so omitting this export
  // makes the call a TypeError instead of a real contract result (Part 4).
  rateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 29, resetAt: 0 }),
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
  // `POST /api/keys/api-key` gates MCP keys on Creator+ tier. `null` means the
  // tier is acceptable — the tier gate is not what Part 4 contracts measure.
  assertTier: vi.fn().mockReturnValue(null),
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
  // Mirrors the real `(code, message)` constructor so Part 4 can drive the
  // status routes' 402 branch, which reads `err.code` off the caught error.
  ApiKeyError: class ApiKeyError extends Error {
    constructor(public code: string, message: string) {
      super(message);
      this.name = 'ApiKeyError';
    }
  },
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

// --- Part 4 boundaries -----------------------------------------------------
// Every mock below is ADDITIVE: the routes Parts 1-3 exercise either return at
// the auth gate before reaching these modules, or never import them. They exist
// so Part 4 can drive real handlers down their success paths.

vi.mock('@/lib/db/client', () => ({
  getDb: vi.fn(),
  getNeonSql: vi.fn(),
  // Part 4 stubs this per test with the rows a route's query would return, so
  // the drizzle query builder inside the callback never runs. Response SHAPING
  // is what the contract measures; query construction is covered elsewhere.
  queryWithResilience: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/auth/user-service', () => ({
  getUserByClerkId: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/projects/service', () => ({
  listProjects: vi.fn().mockResolvedValue([]),
  createProject: vi.fn(),
}));

// bcrypt at 12 rounds costs ~250ms per call and hashes a value no assertion
// reads — the API key contract covers the response shape, not the hash.
vi.mock('bcryptjs', () => ({
  default: { hash: vi.fn().mockResolvedValue('bcrypt-hash') },
}));

vi.mock('@/lib/generate/meshyClient', () => ({ MeshyClient: vi.fn() }));
vi.mock('@/lib/generate/sunoClient', () => ({ SunoClient: vi.fn() }));
vi.mock('@/lib/generate/spriteClient', () => ({ SpriteClient: vi.fn() }));

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

// ===========================================================================
// Part 4: REAL route responses validated against the published OpenAPI spec
// ===========================================================================
//
// Parts 2 and 3 above hand-build objects that already match the schema and
// then assert the schema accepts them, which is circular — a route could
// return a completely different shape and those tests stay green (#8621).
//
// Part 4 closes that loop: it invokes each route's exported handler with the
// auth / DB / provider boundaries stubbed, and runs the spec against the body
// the handler ACTUALLY returned. Two independent checks run on every body:
//
//   1. `contract.operation(...)` — ajv, using the operation's own response
//      schema (envelopes, `allOf` extensions and `$ref`s resolved), so enums,
//      `format: uuid`, `format: date-time` and `additionalProperties` bite.
//   2. `diffAgainstSpec(...)` — a property-SET comparison. This is the load
//      bearing half: only 1 of the spec's 12 component schemas declares
//      `required` + `additionalProperties: false`, so ajv alone accepts `{}`
//      for the other 11 and cannot see a renamed or dropped field.
//
// Each test states its expected divergence list explicitly. An empty list
// means the route matches the published contract exactly; a non-empty list is
// a KNOWN drift, commented with what is wrong, and pinned so that any NEW
// drift (in either direction) fails here instead of shipping silently.
// Schemas are never relaxed to make a real response pass.

import { diffAgainstSpec, loadOpenApiContract, type SpecMethod } from '@/test/utils/openApiContract';

describe('OpenAPI contract — real route responses', () => {
  const contract = loadOpenApiContract();

  const CLERK_ID = 'user_2abcXYZ';
  const DB_USER_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
  const GAME_ID = '9c858901-8a57-4791-81fe-4c455b099bc9';
  const ISO = '2026-05-01T00:00:00.000Z';
  const WHEN = new Date(ISO);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  /**
   * Assert a real response body against BOTH halves of the contract.
   *
   * @param expectedDivergences Property-set differences this route is known to
   *   have TODAY, as `missing $.x` / `undocumented $.x`. Asserted with
   *   `toEqual`, so a new drift and a fixed drift both fail.
   */
  function expectContract(
    method: SpecMethod,
    routePath: string,
    status: number,
    body: unknown,
    expectedDivergences: string[] = [],
  ): void {
    const validate = contract.operation(method, routePath, status);
    expect(
      validate(body),
      `${method.toUpperCase()} ${routePath} ${status} body ${JSON.stringify(body)} `
        + `violates the spec: ${JSON.stringify(validate.errors)}`,
    ).toBe(true);
    expect(
      diffAgainstSpec(contract.operationSchema(method, routePath, status), body),
    ).toEqual(expectedDivergences);
  }

  /** Drive the next `withApiMiddleware` call down its authenticated path. */
  async function authenticateAs(body?: unknown): Promise<void> {
    const { withApiMiddleware } = await import('@/lib/api/middleware');
    // The middleware mock is a FACTORY mock and `vi.resetModules()` runs above,
    // so this import is the instance the route will see — a module-scope import
    // would patch a stale `vi.fn()` and the route would still 401.
    vi.mocked(withApiMiddleware).mockResolvedValueOnce({
      error: undefined,
      userId: DB_USER_ID,
      authContext: { user: { id: DB_USER_ID, tier: 'pro' }, clerkId: CLERK_ID },
      body,
    } as never);
  }

  /** Hand the next `resolveApiKey` call a platform key instead of rejecting. */
  async function resolvePlatformKey(): Promise<void> {
    const { resolveApiKey } = await import('@/lib/keys/resolver');
    vi.mocked(resolveApiKey).mockResolvedValueOnce({ key: 'provider-key' } as never);
  }

  /** Queue the rows successive `queryWithResilience` calls should resolve to. */
  async function stubQueries(...resultSets: unknown[][]): Promise<void> {
    const { queryWithResilience } = await import('@/lib/db/client');
    for (const rows of resultSets) {
      vi.mocked(queryWithResilience).mockResolvedValueOnce(rows as never);
    }
  }

  /**
   * Give a `vi.fn()`-mocked provider client constructor an implementation.
   * The status routes do `new Client(...)` then call one method on it; the
   * factory mocks at the top of this file replace each class with a bare
   * `vi.fn()`, whose instances have no methods until this runs.
   */
  function stubClient(ctor: unknown, instance: Record<string, unknown>): void {
    // Must be a `function`, not an arrow: the routes call `new Client(...)` and
    // an arrow implementation is not a constructor. A constructor that returns
    // an object yields that object, so `new` hands the route the stub.
    vi.mocked(ctor as (...args: unknown[]) => unknown).mockImplementation(
      function stubbedClient(this: unknown) {
        return instance;
      },
    );
  }

  // -------------------------------------------------------------------------
  // GET /api/tokens/balance — the one schema with `required` +
  // `additionalProperties: false`, so ajv and the differ agree here.
  // -------------------------------------------------------------------------

  it('GET /api/tokens/balance 200 returns a body matching TokenBalance exactly', async () => {
    await authenticateAs();
    const { getTokenBalance } = await import('@/lib/tokens/service');
    vi.mocked(getTokenBalance).mockResolvedValueOnce({
      monthlyRemaining: 9500,
      monthlyTotal: 10000,
      addon: 0,
      total: 9500,
      nextRefillDate: ISO,
    });

    const { GET } = await import('@/app/api/tokens/balance/route');
    const res = await GET(makeGetRequest('http://localhost/api/tokens/balance'));

    expect(res.status).toBe(200);
    expectContract('get', '/api/tokens/balance', 200, await res.json());
  });

  it('GET /api/tokens/balance 200 FAILS the contract when the route leaks an extra field', async () => {
    // Non-vacuity proof #1: the assertions above are not tautological — a real
    // response with one extra property is rejected, by name.
    await authenticateAs();
    const { getTokenBalance } = await import('@/lib/tokens/service');
    vi.mocked(getTokenBalance).mockResolvedValueOnce({
      monthlyRemaining: 1, monthlyTotal: 1, addon: 0, total: 1, nextRefillDate: null,
      legacyField: 'x',
    } as never);

    const { GET } = await import('@/app/api/tokens/balance/route');
    const res = await GET(makeGetRequest('http://localhost/api/tokens/balance'));
    const body: unknown = await res.json();

    expect(contract.operation('get', '/api/tokens/balance', 200)(body)).toBe(false);
    expect(diffAgainstSpec(contract.componentSchema('TokenBalance'), body)).toEqual([
      'undocumented $.legacyField',
    ]);
  });

  it('GET /api/tokens/balance 200 FAILS the contract when the route renames a field', async () => {
    // Non-vacuity proof #2: a rename is the failure mode ajv alone misses on
    // the 11 permissive schemas — the differ catches it as a missing/undocumented
    // pair rather than a silent pass.
    await authenticateAs();
    const { getTokenBalance } = await import('@/lib/tokens/service');
    vi.mocked(getTokenBalance).mockResolvedValueOnce({
      remaining: 1, monthlyTotal: 1, addon: 0, total: 1, nextRefillDate: null,
    } as never);

    const { GET } = await import('@/app/api/tokens/balance/route');
    const res = await GET(makeGetRequest('http://localhost/api/tokens/balance'));
    const body: unknown = await res.json();

    expect(diffAgainstSpec(contract.componentSchema('TokenBalance'), body)).toEqual([
      'missing $.monthlyRemaining',
      'undocumented $.remaining',
    ]);
  });

  // -------------------------------------------------------------------------
  // Generation status routes. `error` / `resultUrl` are optional in the spec,
  // so a success body legitimately omits them — the expected lists below record
  // which of the documented properties each route actually emits.
  // -------------------------------------------------------------------------

  it('GET /api/generate/model/status 200 (completed) matches GenerationStatus + thumbnailUrl', async () => {
    await authenticateAs();
    await resolvePlatformKey();
    const { MeshyClient } = await import('@/lib/generate/meshyClient');
    stubClient(MeshyClient, {
      getTaskStatus: vi.fn().mockResolvedValue({
        status: 'SUCCEEDED',
        progress: 100,
        modelUrls: { glb: 'https://cdn.example.com/model.glb' },
        thumbnailUrl: 'https://cdn.example.com/thumb.png',
      }),
    });

    const { GET } = await import('@/app/api/generate/model/status/route');
    const res = await GET(makeGetRequest('http://localhost/api/generate/model/status?jobId=job_1'));

    expect(res.status).toBe(200);
    // `error` is undefined on the success path and `NextResponse.json` drops it.
    expectContract('get', '/api/generate/model/status', 200, await res.json(), [
      'missing $.error',
    ]);
  });

  it('GET /api/generate/model/status 200 (succeeded-but-empty) still matches the contract', async () => {
    await authenticateAs();
    await resolvePlatformKey();
    const { MeshyClient } = await import('@/lib/generate/meshyClient');
    stubClient(MeshyClient, {
      getTaskStatus: vi.fn().mockResolvedValue({ status: 'SUCCEEDED', progress: 100 }),
    });

    const { GET } = await import('@/app/api/generate/model/status/route');
    const res = await GET(makeGetRequest('http://localhost/api/generate/model/status?jobId=job_1'));
    const body = await res.json() as Record<string, unknown>;

    // #8757: a SUCCEEDED task with no GLB must report `failed`, not `completed`.
    expect(body.status).toBe('failed');
    expectContract('get', '/api/generate/model/status', 200, body, [
      'missing $.resultUrl',
      'missing $.thumbnailUrl',
    ]);
  });

  it('GET /api/generate/texture/status 200 (completed) matches GenerationStatus + maps', async () => {
    await authenticateAs();
    await resolvePlatformKey();
    const { MeshyClient } = await import('@/lib/generate/meshyClient');
    stubClient(MeshyClient, {
      getTextureStatus: vi.fn().mockResolvedValue({
        status: 'SUCCEEDED',
        progress: 100,
        maps: { base_color: 'https://cdn.example.com/albedo.png' },
      }),
    });

    const { GET } = await import('@/app/api/generate/texture/status/route');
    const res = await GET(makeGetRequest('http://localhost/api/generate/texture/status?jobId=job_1'));

    expect(res.status).toBe(200);
    // DRIFT: the spec documents `resultUrl` for this operation (inherited from
    // GenerationStatus) but the route only ever returns `maps` — a client coded
    // against the published schema gets `undefined` here on every success.
    expectContract('get', '/api/generate/texture/status', 200, await res.json(), [
      'missing $.error',
      'missing $.resultUrl',
    ]);
  });

  it('GET /api/generate/music/status 200 (completed) matches GenerationStatus + durationSeconds', async () => {
    await authenticateAs();
    await resolvePlatformKey();
    const { SunoClient } = await import('@/lib/generate/sunoClient');
    stubClient(SunoClient, {
      getStatus: vi.fn().mockResolvedValue({
        status: 'completed',
        progress: 100,
        audioUrl: 'https://cdn.example.com/track.mp3',
        durationSeconds: 30,
      }),
    });

    const { GET } = await import('@/app/api/generate/music/status/route');
    const res = await GET(makeGetRequest('http://localhost/api/generate/music/status?jobId=job_1'));

    expect(res.status).toBe(200);
    expectContract('get', '/api/generate/music/status', 200, await res.json(), [
      'missing $.error',
    ]);
  });

  it('GET /api/generate/skybox/status 200 (completed) matches GenerationStatus', async () => {
    await authenticateAs();
    await resolvePlatformKey();
    const { MeshyClient } = await import('@/lib/generate/meshyClient');
    stubClient(MeshyClient, {
      getTextureStatus: vi.fn().mockResolvedValue({
        status: 'SUCCEEDED',
        progress: 100,
        maps: { equirect: 'https://cdn.example.com/sky.png' },
      }),
    });

    const { GET } = await import('@/app/api/generate/skybox/status/route');
    const res = await GET(makeGetRequest('http://localhost/api/generate/skybox/status?jobId=job_1'));

    expect(res.status).toBe(200);
    expectContract('get', '/api/generate/skybox/status', 200, await res.json(), [
      'missing $.error',
    ]);
  });

  it('GET /api/generate/sprite/status 200 (synchronous dalle3 job) matches GenerationStatus', async () => {
    await authenticateAs();

    // A "dalle3:<url>" jobId short-circuits before key resolution, so this path
    // exercises the route with no provider client at all.
    const { GET } = await import('@/app/api/generate/sprite/status/route');
    const res = await GET(makeGetRequest(
      'http://localhost/api/generate/sprite/status?jobId=dalle3:https%3A%2F%2Fcdn.example.com%2Fs.png',
    ));

    expect(res.status).toBe(200);
    expectContract('get', '/api/generate/sprite/status', 200, await res.json(), [
      'missing $.error',
    ]);
  });

  it('GET /api/generate/model/status 400 (no jobId) returns an Error-shaped body', async () => {
    await authenticateAs();

    const { GET } = await import('@/app/api/generate/model/status/route');
    const res = await GET(makeGetRequest('http://localhost/api/generate/model/status'));
    const body: unknown = await res.json();

    expect(res.status).toBe(400);
    // The spec declares a 400 for this operation with no body schema, so the
    // repo-wide `Error` component is the only thing binding it.
    expect(contract.component('Error')(body)).toBe(true);
    expect(diffAgainstSpec(contract.componentSchema('Error'), body)).toEqual([]);
  });

  it('GET /api/generate/model/status 402 body carries a `code` the Error schema does not document', async () => {
    await authenticateAs();
    const { resolveApiKey, ApiKeyError } = await import('@/lib/keys/resolver');
    vi.mocked(resolveApiKey).mockRejectedValueOnce(
      new ApiKeyError('NO_KEY_CONFIGURED', 'No API key configured'),
    );

    const { GET } = await import('@/app/api/generate/model/status/route');
    const res = await GET(makeGetRequest('http://localhost/api/generate/model/status?jobId=job_1'));
    const body: unknown = await res.json();

    expect(res.status).toBe(402);
    // DRIFT (repo-wide): `apiError()` / `createErrorResponse()` always attach a
    // `code`, and several routes attach `details`, but `components.schemas.Error`
    // documents `error` alone. Every documented error body in the spec is
    // therefore narrower than what clients actually receive.
    expect(diffAgainstSpec(contract.componentSchema('Error'), body)).toEqual([
      'undocumented $.code',
    ]);
  });

  // -------------------------------------------------------------------------
  // Project routes
  // -------------------------------------------------------------------------

  it('GET /api/projects 200 returns items narrower than the documented Project', async () => {
    await authenticateAs();
    const { listProjects } = await import('@/lib/projects/service');
    vi.mocked(listProjects).mockResolvedValueOnce([
      { id: DB_USER_ID, name: 'My Game', thumbnail: null, entityCount: 12, updatedAt: WHEN },
    ]);

    const { GET } = await import('@/app/api/projects/route');
    const res = await GET(makeGetRequest('http://localhost/api/projects'));

    expect(res.status).toBe(200);
    // DRIFT: the spec says each item is a full `Project`, but `listProjects`
    // selects 5 columns — `sceneData` and `createdAt` are never sent. Callers
    // reading `project.sceneData` off this list get `undefined`.
    expectContract('get', '/api/projects', 200, await res.json(), [
      'missing $[0].createdAt',
      'missing $[0].sceneData',
    ]);
  });

  it('POST /api/projects 201 returns a body matching ProjectSummary exactly', async () => {
    await authenticateAs({ name: 'My Game', sceneData: {} });
    const { createProject } = await import('@/lib/projects/service');
    vi.mocked(createProject).mockResolvedValueOnce({
      id: GAME_ID,
      userId: DB_USER_ID,
      name: 'My Game',
      sceneData: {},
      thumbnail: null,
      entityCount: 0,
      createdAt: WHEN,
      updatedAt: WHEN,
    } as never);

    const { POST } = await import('@/app/api/projects/route');
    const res = await POST(makePostRequest('http://localhost/api/projects', {
      name: 'My Game', sceneData: {},
    }));

    expect(res.status).toBe(201);
    expectContract('post', '/api/projects', 201, await res.json());
  });

  it('POST /api/projects 403 body does not match the documented limit-reached shape', async () => {
    await authenticateAs({ name: 'My Game', sceneData: {} });
    const { createProject } = await import('@/lib/projects/service');
    vi.mocked(createProject).mockRejectedValueOnce(
      Object.assign(new Error('Project limit exceeded'), { limit: 3 }),
    );

    const { POST } = await import('@/app/api/projects/route');
    const res = await POST(makePostRequest('http://localhost/api/projects', {
      name: 'My Game', sceneData: {},
    }));
    const body: unknown = await res.json();

    expect(res.status).toBe(403);
    // DRIFT: the spec documents `{ error, message, limit }`, but the route calls
    // `apiError(403, msg, 'PROJECT_LIMIT', { limit })`, which emits
    // `{ error, code, details: { limit } }`. A client reading `body.limit` to
    // show "you have N of N projects" reads `undefined` — the documented shape
    // is wrong in all four of its property names.
    expectContract('post', '/api/projects', 403, body, [
      'missing $.limit',
      'missing $.message',
      'undocumented $.code',
      'undocumented $.details',
    ]);
  });

  // -------------------------------------------------------------------------
  // Publish / community / marketplace
  // -------------------------------------------------------------------------

  /** Row shape `select()` returns for `published_games`. */
  function makePublishedRow(status: 'published' | 'unpublished' | 'processing') {
    return {
      id: GAME_ID,
      userId: DB_USER_ID,
      projectId: DB_USER_ID,
      slug: 'my-awesome-game',
      title: 'My Awesome Game',
      description: 'A game',
      status,
      version: 1,
      cdnUrl: null,
      thumbnail: null,
      playCount: 7,
      createdAt: WHEN,
      updatedAt: WHEN,
    };
  }

  async function authenticateClerk(): Promise<void> {
    const { authenticateClerkSession } = await import('@/lib/auth/api-auth');
    vi.mocked(authenticateClerkSession).mockResolvedValueOnce({ ok: true, clerkId: CLERK_ID } as never);
    const { getUserByClerkId } = await import('@/lib/auth/user-service');
    vi.mocked(getUserByClerkId).mockResolvedValueOnce({ id: DB_USER_ID } as never);
  }

  it('GET /api/publish/list 200 leaks four undocumented columns per publication', async () => {
    await authenticateClerk();
    await stubQueries([makePublishedRow('published')]);

    const { GET } = await import('@/app/api/publish/list/route');
    const res = await GET();

    expect(res.status).toBe(200);
    // DRIFT: the route spreads the whole DB row (`...p`) into the response, so
    // internal columns ship to the client. `userId` is the one that matters —
    // it exposes another table's primary key to anyone who calls the endpoint.
    expectContract('get', '/api/publish/list', 200, await res.json(), [
      'undocumented $.publications[0].cdnUrl',
      'undocumented $.publications[0].playCount',
      'undocumented $.publications[0].thumbnail',
      'undocumented $.publications[0].userId',
    ]);
  });

  it('GET /api/publish/list 200 VIOLATES the Publication schema for a processing publication', async () => {
    await authenticateClerk();
    await stubQueries([makePublishedRow('processing')]);

    const { GET } = await import('@/app/api/publish/list/route');
    const res = await GET();
    const body: unknown = await res.json();

    // BUG PIN: `publishStatusEnum` (db/schema.ts) is
    // ['published','unpublished','processing'] and 'processing' is the column
    // DEFAULT, but the spec's `Publication.status` enum omits it. This route
    // returns ALL of a user's rows, so a freshly-created publication is served
    // with a status the published contract forbids. Asserting `false` here
    // records the bug rather than hiding it: whoever fixes the spec (or the
    // route) will be sent to this test to remove the pin.
    const validate = contract.operation('get', '/api/publish/list', 200);
    expect(validate(body)).toBe(false);
    expect(JSON.stringify(validate.errors)).toContain('enum');
  });

  it('GET /api/community/games 200 returns a body matching GameSummary exactly', async () => {
    await stubQueries(
      [{
        id: GAME_ID,
        title: 'My Awesome Game',
        description: 'A game',
        slug: 'my-awesome-game',
        authorId: DB_USER_ID,
        authorName: 'Ada',
        playCount: 7,
        cdnUrl: null,
        thumbnail: null,
        createdAt: WHEN,
        likeCount: 3,
        avgRating: 4.5,
        ratingCount: 2,
        commentCount: 1,
      }],
      [{ gameId: GAME_ID, tag: 'platformer' }],
    );

    const { GET } = await import('@/app/api/community/games/route');
    const res = await GET(makeGetRequest('http://localhost/api/community/games'));

    expect(res.status).toBe(200);
    expectContract('get', '/api/community/games', 200, await res.json());
  });

  it('GET /api/marketplace/assets 200 returns a body matching MarketplaceAsset exactly', async () => {
    await stubQueries([{
      id: GAME_ID,
      name: 'Crate Pack',
      description: 'Ten crates',
      category: 'model_3d',
      priceTokens: 250,
      license: 'CC0',
      previewUrl: 'https://cdn.example.com/preview.png',
      downloadCount: 12,
      avgRating: 450,
      ratingCount: 3,
      tags: ['props'],
      aiGenerated: 1,
      createdAt: WHEN,
      sellerId: DB_USER_ID,
      sellerName: 'Ada',
    }]);

    const { GET } = await import('@/app/api/marketplace/assets/route');
    const res = await GET(makeGetRequest('http://localhost/api/marketplace/assets'));

    expect(res.status).toBe(200);
    expectContract('get', '/api/marketplace/assets', 200, await res.json());
  });

  it('GET /api/marketplace/seller 200 returns a body matching SellerProfile exactly', async () => {
    await authenticateAs();
    await stubQueries([{
      displayName: 'Ada',
      bio: null,
      portfolioUrl: null,
      totalEarnings: 0,
      totalSales: 0,
      approved: 1,
    }]);

    const { GET } = await import('@/app/api/marketplace/seller/route');
    const res = await GET(makeGetRequest('http://localhost/api/marketplace/seller'));

    expect(res.status).toBe(200);
    expectContract('get', '/api/marketplace/seller', 200, await res.json());
  });

  it('GET /api/marketplace/seller 200 returns the documented null profile when none exists', async () => {
    await authenticateAs();
    await stubQueries([]);

    const { GET } = await import('@/app/api/marketplace/seller/route');
    const res = await GET(makeGetRequest('http://localhost/api/marketplace/seller'));
    const body = await res.json() as Record<string, unknown>;

    expect(body.profile).toBeNull();
    expectContract('get', '/api/marketplace/seller', 200, body);
  });

  // -------------------------------------------------------------------------
  // API keys
  // -------------------------------------------------------------------------

  it('GET /api/keys/api-key 200 returns a body matching ApiKeyRecord exactly', async () => {
    await authenticateAs();
    await stubQueries([{
      id: GAME_ID,
      name: 'CI',
      prefix: 'forge_a1b2',
      scopes: ['scene:read'],
      lastUsed: null,
      createdAt: WHEN,
    }]);

    const { GET } = await import('@/app/api/keys/api-key/route');
    const res = await GET(makeGetRequest('http://localhost/api/keys/api-key'));

    expect(res.status).toBe(200);
    expectContract('get', '/api/keys/api-key', 200, await res.json());
  });

  it('POST /api/keys/api-key 200 omits the documented lastUsed field', async () => {
    await authenticateAs({ name: 'CI', scopes: ['scene:read'] });
    await stubQueries([{ id: GAME_ID, createdAt: WHEN }]);

    const { POST } = await import('@/app/api/keys/api-key/route');
    const res = await POST(makePostRequest('http://localhost/api/keys/api-key', {
      name: 'CI', scopes: ['scene:read'],
    }));

    expect(res.status).toBe(200);
    // DRIFT: the 200 schema is `allOf: [ApiKeyRecord, { key, warning }]`, so
    // `lastUsed` is documented; a freshly-minted key has never been used and the
    // route simply does not send the field.
    expectContract('post', '/api/keys/api-key', 200, await res.json(), [
      'missing $.lastUsed',
    ]);
  });
});
