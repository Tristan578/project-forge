import { describe, it, expect } from 'vitest';
import { apiSuccess, apiError, apiCreated } from '../response';

describe('apiSuccess', () => {
  it('wraps data with error: null and code: null at default status 200', async () => {
    const res = apiSuccess({ id: 1, name: 'test' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ data: { id: 1, name: 'test' }, error: null, code: null });
  });

  it('accepts a custom status code', async () => {
    const res = apiSuccess({ ok: true }, 202);
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.error).toBeNull();
    expect(body.code).toBeNull();
    expect(body.data).toEqual({ ok: true });
  });

  it('works with an array payload', async () => {
    const res = apiSuccess([1, 2, 3]);
    const body = await res.json();
    expect(body).toEqual({ data: [1, 2, 3], error: null, code: null });
  });

  it('works with a null payload', async () => {
    const res = apiSuccess(null);
    const body = await res.json();
    expect(body).toEqual({ data: null, error: null, code: null });
  });
});

describe('apiError', () => {
  it('returns the error message with data: null at default status 400', async () => {
    const res = apiError('Something went wrong');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ data: null, error: 'Something went wrong', code: null });
  });

  it('includes an optional error code when provided', async () => {
    const res = apiError('Not found', 404, 'NOT_FOUND');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ data: null, error: 'Not found', code: 'NOT_FOUND' });
  });

  it('sets code to null when code is omitted', async () => {
    const res = apiError('Unauthorized', 401);
    const body = await res.json();
    expect(body.code).toBeNull();
  });

  it('respects a 500 status code', async () => {
    const res = apiError('Internal error', 500, 'INTERNAL');
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe('INTERNAL');
  });
});

describe('apiCreated', () => {
  it('returns status 201 with the data envelope', async () => {
    const res = apiCreated({ id: 'abc', name: 'New project' });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({ data: { id: 'abc', name: 'New project' }, error: null, code: null });
  });

  it('is consistent with apiSuccess(..., 201)', async () => {
    const dataPayload = { x: 42 };
    const fromCreated = await apiCreated(dataPayload).json();
    const fromSuccess = await apiSuccess(dataPayload, 201).json();
    expect(fromCreated).toEqual(fromSuccess);
  });
});

describe('response shape consistency', () => {
  it('success and error responses share the same top-level keys', async () => {
    const successBody = await apiSuccess({ foo: 'bar' }).json();
    const errorBody = await apiError('oops', 422).json();
    expect(Object.keys(successBody).sort()).toEqual(Object.keys(errorBody).sort());
  });
});
