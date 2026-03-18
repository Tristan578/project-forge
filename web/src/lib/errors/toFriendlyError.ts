import { getUserMessage, type FriendlyErrorEntry, type ActionType } from './userMessages';

/**
 * A normalised, user-friendly error that is safe to display in the UI.
 * Never contains raw error codes, stack traces, or server implementation details.
 */
export interface FriendlyError {
  /** Short, plain-English title */
  title: string;
  /** One-sentence explanation with a suggested next step */
  message: string;
  /** Label for the primary action button */
  actionLabel: string;
  /** The type of action to perform when the button is clicked */
  action: ActionType;
  /** The resolved error code (for logging / telemetry only — never display to users) */
  code: string;
}

/**
 * Map HTTP status codes to our internal error codes.
 */
function httpStatusToCode(status: number): string {
  if (status === 401) return 'AUTH_REQUIRED';
  if (status === 403) return 'AUTH_FORBIDDEN';
  if (status === 408) return 'TIMEOUT';
  if (status === 429) return 'TOKEN_LIMIT';
  if (status >= 500) return 'NETWORK_ERROR';
  return 'UNKNOWN';
}

/**
 * Heuristically classify an error message string into a known error code.
 */
function classifyMessage(msg: string): string {
  const lower = msg.toLowerCase();

  if (lower.includes('fetch') || lower.includes('network') || lower.includes('connection')) {
    return 'NETWORK_ERROR';
  }
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return 'TIMEOUT';
  }
  if (lower.includes('offline')) {
    return 'OFFLINE';
  }
  if (lower.includes('unauthorized') || lower.includes('unauthenticated') || lower.includes('auth')) {
    return 'AUTH_REQUIRED';
  }
  if (lower.includes('forbidden') || lower.includes('permission')) {
    return 'AUTH_FORBIDDEN';
  }
  if (lower.includes('expired') || lower.includes('session')) {
    return 'AUTH_EXPIRED';
  }
  if (lower.includes('token') || lower.includes('credit') || lower.includes('quota')) {
    return 'TOKEN_LIMIT';
  }
  if (lower.includes('publish')) {
    return 'PUBLISH_FAILED';
  }
  if (lower.includes('save')) {
    return 'SAVE_FAILED';
  }
  if (lower.includes('load') || lower.includes('open')) {
    return 'LOAD_FAILED';
  }
  if (lower.includes('engine') || lower.includes('wasm')) {
    return 'ENGINE_COMMAND_FAILED';
  }
  if (lower.includes('generation') || lower.includes('ai ') || lower.includes(' ai')) {
    return 'GENERATION_FAILED';
  }

  return 'UNKNOWN';
}

/**
 * Convert any thrown value to a `FriendlyError` that is safe to display in the UI.
 *
 * Handles:
 * - `Error` objects (including subclasses)
 * - `Response` objects (from `fetch`)
 * - String messages
 * - Objects with a `code` or `message` field
 * - Unknown / null / undefined
 */
export function toFriendlyError(error: unknown): FriendlyError {
  let code = 'UNKNOWN';

  // ── Object with an explicit error code field ──────────────────────────────
  if (error !== null && typeof error === 'object') {
    const obj = error as Record<string, unknown>;

    // Objects that carry a known code directly (e.g. from our own API responses)
    if (typeof obj['code'] === 'string' && obj['code'].length > 0) {
      code = obj['code'];
    }
    // Fetch Response objects
    else if (typeof obj['status'] === 'number') {
      code = httpStatusToCode(obj['status'] as number);
    }
    // Error instances
    else if (error instanceof Error) {
      code = classifyMessage(error.message);
    }
  } else if (typeof error === 'string' && error.length > 0) {
    code = classifyMessage(error);
  }

  const entry: FriendlyErrorEntry = getUserMessage(code);

  return {
    title: entry.title,
    message: entry.message,
    actionLabel: entry.actionLabel,
    action: entry.action,
    code,
  };
}
