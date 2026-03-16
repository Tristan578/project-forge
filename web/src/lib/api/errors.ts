import { NextResponse } from 'next/server';

/**
 * Standardised error codes for API responses.
 */
export enum ErrorCode {
  BAD_REQUEST = 'BAD_REQUEST',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  RATE_LIMITED = 'RATE_LIMITED',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

interface ApiErrorOptions {
  details?: Record<string, unknown>;
  headers?: Record<string, string>;
}

/**
 * Create a structured error response with optional headers and details.
 */
export function apiErrorResponse(
  code: ErrorCode,
  message: string,
  status: number,
  options?: ApiErrorOptions,
): NextResponse {
  const body = {
    data: null,
    error: message,
    code,
    ...(options?.details ? { details: options.details } : {}),
  };

  const headers: Record<string, string> = options?.headers ?? {};

  return NextResponse.json(body, { status, headers });
}
