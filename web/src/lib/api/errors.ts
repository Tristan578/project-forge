import { NextResponse } from 'next/server';

// ---------------------------------------------------------------------------
// Plan E: ApiErrorResponse + apiError() helper
// ---------------------------------------------------------------------------

export interface ApiErrorResponse {
  error: string;
  code?: string;
  details?: unknown;
}

/**
 * Create a structured error response with a consistent shape.
 *
 * @example apiError(400, 'Invalid input')
 * @example apiError(422, 'Validation failed', 'VALIDATION_ERROR')
 * @example apiError(422, 'Validation failed', 'VALIDATION_ERROR', { field: 'name' })
 */
export function apiError(
  status: number,
  error: string,
  code?: string,
  details?: unknown,
): NextResponse<ApiErrorResponse> {
  return NextResponse.json(
    {
      error,
      ...(code && { code }),
      ...(details !== undefined && { details }),
    },
    { status },
  );
}

// ---------------------------------------------------------------------------

/**
 * Standardised API error response system (PF-217, PF-216).
 *
 * Every API route should use these helpers instead of raw
 * `NextResponse.json({ error: '...' }, { status: N })` calls.
 *
 * Response shape (always):
 *   { error: string, code?: string, details?: unknown }
 *
 * Status code convention:
 *   400 — malformed request (invalid JSON, missing fields)
 *   401 — unauthenticated
 *   402 — payment required (insufficient tokens, no API key)
 *   403 — forbidden (wrong tier, not owner)
 *   404 — resource not found
 *   409 — conflict (duplicate, already exists)
 *   422 — validation error (valid JSON but semantically invalid)
 *   429 — rate limited
 *   500 — internal server error
 *   503 — service unavailable (provider down, degraded)
 */

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

export enum ErrorCode {
  BAD_REQUEST = 'BAD_REQUEST',
  UNAUTHORIZED = 'UNAUTHORIZED',
  PAYMENT_REQUIRED = 'PAYMENT_REQUIRED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  RATE_LIMITED = 'RATE_LIMITED',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
}

// ---------------------------------------------------------------------------
// Full-control helper
// ---------------------------------------------------------------------------

interface ApiErrorOptions {
  code?: ErrorCode;
  details?: Record<string, unknown>;
  headers?: Record<string, string>;
}

/**
 * Create a structured error response.
 *
 * @example createErrorResponse(400, 'Invalid JSON')
 * @example createErrorResponse(422, 'Prompt too short', { code: ErrorCode.VALIDATION_ERROR })
 */
export function createErrorResponse(
  status: number,
  message: string,
  options?: ApiErrorOptions,
): NextResponse {
  const body: Record<string, unknown> = { error: message };
  if (options?.code) body.code = options.code;
  if (options?.details) body.details = options.details;

  return NextResponse.json(body, {
    status,
    headers: options?.headers,
  });
}

// ---------------------------------------------------------------------------
// Convenience helpers (most common cases)
// ---------------------------------------------------------------------------

/** 400 — malformed request */
export const badRequest = (message: string) =>
  createErrorResponse(400, message, { code: ErrorCode.BAD_REQUEST });

/** 401 — unauthenticated */
export const unauthorized = (message = 'Unauthorized') =>
  createErrorResponse(401, message, { code: ErrorCode.UNAUTHORIZED });

/** 402 — payment required (tokens, API key) */
export const paymentRequired = (message: string, reason?: string) =>
  createErrorResponse(402, message, { code: ErrorCode.PAYMENT_REQUIRED, details: reason ? { reason } : undefined });

/** 403 — forbidden */
export const forbidden = (message: string) =>
  createErrorResponse(403, message, { code: ErrorCode.FORBIDDEN });

/** 404 — not found */
export const notFound = (message = 'Not found') =>
  createErrorResponse(404, message, { code: ErrorCode.NOT_FOUND });

/** 409 — conflict (duplicate, already exists) */
export const conflict = (message: string) =>
  createErrorResponse(409, message, { code: ErrorCode.CONFLICT });

/** 422 — validation error (valid JSON, invalid values) */
export const validationError = (message: string) =>
  createErrorResponse(422, message, { code: ErrorCode.VALIDATION_ERROR });

/** 500 — internal error */
export const internalError = (message = 'Internal server error') =>
  createErrorResponse(500, message, { code: ErrorCode.INTERNAL_ERROR });

/** 503 — service unavailable */
export const serviceUnavailable = (message: string) =>
  createErrorResponse(503, message, { code: ErrorCode.SERVICE_UNAVAILABLE });

// ---------------------------------------------------------------------------
// Legacy compat (existing code references this)
// ---------------------------------------------------------------------------

/** @deprecated Use createErrorResponse() or convenience helpers instead */
export function apiErrorResponse(
  code: ErrorCode,
  message: string,
  status: number,
  options?: { details?: Record<string, unknown>; headers?: Record<string, string> },
): NextResponse {
  return createErrorResponse(status, message, { code, details: options?.details, headers: options?.headers });
}
