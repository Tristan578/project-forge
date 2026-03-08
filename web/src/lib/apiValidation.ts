import { NextResponse } from 'next/server';

/**
 * Validates and parses a JSON request body. Returns the parsed body or a 400 error response.
 */
export async function parseJsonBody(req: Request): Promise<
  { ok: true; body: Record<string, unknown> } | { ok: false; response: NextResponse }
> {
  try {
    const body = await req.json();
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return { ok: false, response: NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 }) };
    }
    return { ok: true, body: body as Record<string, unknown> };
  } catch {
    return { ok: false, response: NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) };
  }
}

/**
 * Validates a required string field. Returns the trimmed string or a 400 response.
 */
export function requireString(
  value: unknown,
  fieldName: string,
  { minLength = 1, maxLength = 500 }: { minLength?: number; maxLength?: number } = {}
): { ok: true; value: string } | { ok: false; response: NextResponse } {
  if (value === undefined || value === null || typeof value !== 'string') {
    return {
      ok: false,
      response: NextResponse.json(
        { error: `${fieldName} is required and must be a string` },
        { status: 400 }
      ),
    };
  }

  const trimmed = value.trim();
  if (trimmed.length < minLength) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: `${fieldName} must be at least ${minLength} character(s)` },
        { status: 400 }
      ),
    };
  }
  if (trimmed.length > maxLength) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: `${fieldName} must be at most ${maxLength} characters` },
        { status: 400 }
      ),
    };
  }

  return { ok: true, value: trimmed };
}

/**
 * Validates an optional string field. Returns the trimmed string, undefined, or a 400 response.
 */
export function optionalString(
  value: unknown,
  fieldName: string,
  { maxLength = 500 }: { maxLength?: number } = {}
): { ok: true; value: string | undefined } | { ok: false; response: NextResponse } {
  if (value === undefined || value === null) {
    return { ok: true, value: undefined };
  }
  if (typeof value !== 'string') {
    return {
      ok: false,
      response: NextResponse.json(
        { error: `${fieldName} must be a string` },
        { status: 400 }
      ),
    };
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: `${fieldName} must be at most ${maxLength} characters` },
        { status: 400 }
      ),
    };
  }
  return { ok: true, value: trimmed };
}

/**
 * Validates a required non-null object field.
 */
export function requireObject(
  value: unknown,
  fieldName: string
): { ok: true; value: Record<string, unknown> } | { ok: false; response: NextResponse } {
  if (value === undefined || value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: `${fieldName} is required and must be an object` },
        { status: 400 }
      ),
    };
  }
  return { ok: true, value: value as Record<string, unknown> };
}

/**
 * Validates a required integer field within an optional range.
 */
export function requireInteger(
  value: unknown,
  fieldName: string,
  { min, max }: { min?: number; max?: number } = {}
): { ok: true; value: number } | { ok: false; response: NextResponse } {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: `${fieldName} must be an integer` },
        { status: 400 }
      ),
    };
  }
  if (min !== undefined && value < min) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: `${fieldName} must be at least ${min}` },
        { status: 400 }
      ),
    };
  }
  if (max !== undefined && value > max) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: `${fieldName} must be at most ${max}` },
        { status: 400 }
      ),
    };
  }
  return { ok: true, value };
}

/**
 * Validates that a value is one of an allowed set.
 */
export function requireOneOf<T extends string>(
  value: unknown,
  fieldName: string,
  allowed: readonly T[]
): { ok: true; value: T } | { ok: false; response: NextResponse } {
  if (!allowed.includes(value as T)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: `${fieldName} must be one of: ${allowed.join(', ')}` },
        { status: 400 }
      ),
    };
  }
  return { ok: true, value: value as T };
}
