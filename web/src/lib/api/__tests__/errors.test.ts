import { describe, it, expect } from 'vitest';
import { apiError, type ApiErrorResponse } from '@/lib/api/errors';

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
