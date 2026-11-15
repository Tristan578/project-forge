import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  apiError,
  createErrorResponse,
  redactedJson,
  handleDbError,
  ErrorCode,
  type ApiErrorResponse,
} from '@/lib/api/errors';
import { REDACTION_PLACEHOLDER, resetSecretEnvCache } from '@/lib/security/redactSecrets';

afterEach(() => {
  vi.unstubAllEnvs();
  resetSecretEnvCache();
});

/**
 * The redaction wiring, pinned per constructor (#9736).
 *
 * Before this block existed, deleting `redactSecrets(...)` from either
 * constructor left the entire suite green — the "net" described as the layer
 * under the lint rule had no gate of its own, which is the exact "protection
 * that quietly stopped applying" failure this work exists to prevent.
 *
 * The fixture value is deliberately NOT a recognisable credential shape: that
 * is the case only value matching can catch, so a passing assertion proves the
 * environment half is wired rather than a shape pattern firing by accident.
 */
describe('redaction is wired into every response constructor', () => {
  const SECRET = 'not-a-known-shape-just-a-platform-secret-42';

  it('apiError redacts the message', async () => {
    vi.stubEnv('PLATFORM_MESHY_KEY', SECRET);
    const body: ApiErrorResponse = await apiError(500, `upstream said ${SECRET}`).json();
    expect(body.error).not.toContain(SECRET);
    expect(body.error).toContain(REDACTION_PLACEHOLDER);
  });

  it('apiError redacts details', async () => {
    vi.stubEnv('PLATFORM_MESHY_KEY', SECRET);
    const body: ApiErrorResponse = await apiError(500, 'failed', 'CODE', {
      upstream: SECRET,
    }).json();
    expect(JSON.stringify(body.details)).not.toContain(SECRET);
  });

  it('apiError leaves a null details as null rather than an empty string', async () => {
    const body: ApiErrorResponse = await apiError(500, 'failed', 'CODE', null).json();
    expect(body.details).toBeNull();
  });

  it('createErrorResponse redacts the message', async () => {
    vi.stubEnv('PLATFORM_MESHY_KEY', SECRET);
    const body: ApiErrorResponse = await createErrorResponse(500, `upstream said ${SECRET}`).json();
    expect(body.error).not.toContain(SECRET);
  });

  it('createErrorResponse redacts details', async () => {
    vi.stubEnv('PLATFORM_MESHY_KEY', SECRET);
    const res = createErrorResponse(500, 'failed', { details: { upstream: SECRET } });
    expect(JSON.stringify(await res.json())).not.toContain(SECRET);
  });

  it('redactedJson redacts a bespoke envelope while preserving its shape', async () => {
    vi.stubEnv('PLATFORM_MESHY_KEY', SECRET);
    const res = redactedJson(
      { error: 'load_failed', message: `upstream said ${SECRET}` },
      { status: 502 },
    );
    const body = (await res.json()) as { error: string; message: string };
    expect(res.status).toBe(502);
    expect(body.error).toBe('load_failed');
    expect(body.message).not.toContain(SECRET);
    expect(body.message).toContain(REDACTION_PLACEHOLDER);
  });
});

describe('apiError', () => {
  it('returns NextResponse with error message', async () => {
    const res = apiError(400, 'Invalid input');
    expect(res.status).toBe(400);
    const body: ApiErrorResponse = await res.json();
    expect(body.error).toBe('Invalid input');
    expect(body.code).toBeUndefined();
  });

  it('includes optional error code', async () => {
    const res = apiError(422, 'Validation failed', 'VALIDATION_ERROR');
    const body: ApiErrorResponse = await res.json();
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('uses correct status codes', () => {
    expect(apiError(401, 'Unauthorized').status).toBe(401);
    expect(apiError(403, 'Forbidden').status).toBe(403);
    expect(apiError(429, 'Rate limited').status).toBe(429);
    expect(apiError(500, 'Internal error').status).toBe(500);
  });
});

describe('handleDbError', () => {
  it('returns 503 with DB_CIRCUIT_OPEN for CircuitBreakerOpenError', async () => {
    const err = new Error('Circuit breaker is open');
    err.name = 'CircuitBreakerOpenError';
    const res = handleDbError(err);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(503);
    expect(res!.headers.get('Retry-After')).toBe('30');
    const body = await res!.json();
    expect(body.code).toBe(ErrorCode.DB_CIRCUIT_OPEN);
    expect(body.details.retryAfter).toBe(30);
  });

  it('returns 503 with DB_RATE_LIMITED for DbRateLimitError', async () => {
    const err = new Error('Rate limited');
    err.name = 'DbRateLimitError';
    const res = handleDbError(err);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(503);
    expect(res!.headers.get('Retry-After')).toBe('5');
    const body = await res!.json();
    expect(body.code).toBe(ErrorCode.DB_RATE_LIMITED);
    expect(body.details.retryAfter).toBe(5);
  });

  it('returns null for non-DB errors', () => {
    expect(handleDbError(new Error('generic'))).toBeNull();
    expect(handleDbError(new TypeError('type error'))).toBeNull();
    expect(handleDbError('string error')).toBeNull();
    expect(handleDbError(null)).toBeNull();
  });
});
