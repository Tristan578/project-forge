import { describe, it, expect } from 'vitest';
import { apiError, handleDbError, ErrorCode, type ApiErrorResponse } from '@/lib/api/errors';

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
