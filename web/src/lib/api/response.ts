import { NextResponse } from 'next/server';

/**
 * Standard API response envelope helpers.
 *
 * All successful responses have the shape: { data: T, error: null }
 * All error responses have the shape:     { data: null, error: string, code: string | null }
 *
 * Existing routes may migrate incrementally — do NOT bulk-refactor in this PR.
 */

export function apiSuccess<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ data, error: null, code: null }, { status });
}

export function apiError(
  error: string,
  status = 400,
  code?: string
): NextResponse {
  return NextResponse.json({ data: null, error, code: code ?? null }, { status });
}

export function apiCreated<T>(data: T): NextResponse {
  return apiSuccess(data, 201);
}
