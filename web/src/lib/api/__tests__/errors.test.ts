import { describe, it, expect } from 'vitest';
import {
  apiErrorResponse,
  ApiError,
  ErrorCode,
  type ErrorCodeValue,
  type ApiErrorBody,
} from '../errors';

describe('ErrorCode', () => {
  it('exports all expected error codes', () => {
    const codes = ['VALIDATION_ERROR', 'NOT_FOUND', 'RATE_LIMITED', 'UNAUTHORIZED',
      'FORBIDDEN', 'PAYMENT_REQUIRED', 'CONTENT_BLOCKED', 'PAYLOAD_TOO_LARGE',
      'CONFLICT', 'INTERNAL_ERROR', 'PROVIDER_ERROR'];
    for (const code of codes) { expect(ErrorCode).toHaveProperty(code); }
  });
  it('values match keys', () => {
    for (const [key, value] of Object.entries(ErrorCode)) { expect(value).toBe(key); }
  });
});

describe('apiErrorResponse', () => {
  it('returns standard error envelope', async () => {
    const res = apiErrorResponse(ErrorCode.VALIDATION_ERROR, 'Name is required', 400);
    expect(res.status).toBe(400);
    const body: ApiErrorBody = await res.json();
    expect(body).toEqual({ error: { code: 'VALIDATION_ERROR', message: 'Name is required' } });
  });
  it('includes optional details', async () => {
    const res = apiErrorResponse(ErrorCode.VALIDATION_ERROR, 'Prompt too long', 422, {
      details: { field: 'prompt', maxLength: 500 },
    });
    const body: ApiErrorBody = await res.json();
    expect(body.error.details).toEqual({ field: 'prompt', maxLength: 500 });
  });
  it('omits details when not provided', async () => {
    const body: ApiErrorBody = await apiErrorResponse(ErrorCode.NOT_FOUND, 'Not found', 404).json();
    expect(body.error).not.toHaveProperty('details');
  });
  it('sets custom headers', async () => {
    const res = apiErrorResponse(ErrorCode.RATE_LIMITED, 'Too many requests', 429, {
      headers: { 'Retry-After': '60' },
    });
    expect(res.headers.get('Retry-After')).toBe('60');
  });
  it('works with every error code', async () => {
    for (const code of Object.values(ErrorCode)) {
      const body: ApiErrorBody = await apiErrorResponse(code as ErrorCodeValue, 'test', 400).json();
      expect(body.error.code).toBe(code);
    }
  });
});

describe('ApiError class', () => {
  it('extends Error with code, status, details', () => {
    const err = new ApiError(ErrorCode.NOT_FOUND, 'Not found', 404, { id: 'abc' });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ApiError');
    expect(err.code).toBe('NOT_FOUND');
    expect(err.status).toBe(404);
    expect(err.details).toEqual({ id: 'abc' });
  });
  it('toResponse() creates standard NextResponse', async () => {
    const res = new ApiError(ErrorCode.INTERNAL_ERROR, 'Failure', 500).toResponse();
    expect(res.status).toBe(500);
    const body: ApiErrorBody = await res.json();
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });
  it('toResponse() passes custom headers', async () => {
    const res = new ApiError(ErrorCode.RATE_LIMITED, 'Slow', 429).toResponse({ 'Retry-After': '30' });
    expect(res.headers.get('Retry-After')).toBe('30');
  });
  it('details are optional', () => {
    expect(new ApiError(ErrorCode.UNAUTHORIZED, 'No', 401).details).toBeUndefined();
  });
});

describe('shape consistency', () => {
  it('always has error.code and error.message', async () => {
    for (const res of [
      apiErrorResponse(ErrorCode.VALIDATION_ERROR, 'bad', 400),
      apiErrorResponse(ErrorCode.NOT_FOUND, 'gone', 404),
      apiErrorResponse(ErrorCode.INTERNAL_ERROR, 'boom', 500),
    ]) {
      const body: ApiErrorBody = await res.json();
      expect(body).toHaveProperty('error');
      expect(body.error).toHaveProperty('code');
      expect(body.error).toHaveProperty('message');
    }
  });
});
