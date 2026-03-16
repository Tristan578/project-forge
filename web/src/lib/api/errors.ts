import { NextResponse } from 'next/server';

export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  RATE_LIMITED: 'RATE_LIMITED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  PAYMENT_REQUIRED: 'PAYMENT_REQUIRED',
  CONTENT_BLOCKED: 'CONTENT_BLOCKED',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  CONFLICT: 'CONFLICT',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface ApiErrorBody {
  error: {
    code: ErrorCodeValue;
    message: string;
    details?: Record<string, unknown>;
  };
}

export class ApiError extends Error {
  readonly code: ErrorCodeValue;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(
    code: ErrorCodeValue,
    message: string,
    status: number,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }

  toResponse(headers?: Record<string, string>): NextResponse<ApiErrorBody> {
    return apiErrorResponse(this.code, this.message, this.status, {
      details: this.details,
      headers,
    });
  }
}

export function apiErrorResponse(
  code: ErrorCodeValue,
  message: string,
  status: number,
  opts?: { details?: Record<string, unknown>; headers?: Record<string, string> }
): NextResponse<ApiErrorBody> {
  const body: ApiErrorBody = {
    error: {
      code,
      message,
      ...(opts?.details ? { details: opts.details } : {}),
    },
  };

  return NextResponse.json(body, {
    status,
    headers: opts?.headers,
  });
}
