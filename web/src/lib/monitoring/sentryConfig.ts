import type { Event } from '@sentry/nextjs';
import * as Sentry from '@sentry/nextjs';

// ---------------------------------------------------------------------------
// Fingerprinting helpers
// ---------------------------------------------------------------------------

/** Extract AI provider name from error message or tags. */
function extractProvider(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('anthropic')) return 'anthropic';
  if (lower.includes('openai') || lower.includes('dall-e') || lower.includes('dalle')) return 'openai';
  if (lower.includes('openrouter')) return 'openrouter';
  if (lower.includes('elevenlabs')) return 'elevenlabs';
  if (lower.includes('suno')) return 'suno';
  if (lower.includes('meshy')) return 'meshy';
  if (lower.includes('stability')) return 'stability';
  return 'unknown_provider';
}

/** Extract WASM command type from error context. */
function extractWasmCommand(message: string, transaction?: string): string {
  // Error format: "WASM command failed: spawn_entity" or similar
  const cmdMatch = message.match(/wasm[^\w]*(?:command|cmd)[^\w]*(?:failed|error)[^\w]*[:\s]+(\w+)/i);
  if (cmdMatch?.[1]) return cmdMatch[1];

  // Fall back to transaction name if it looks like a command
  if (transaction && /^[a-z_]+$/.test(transaction)) return transaction;

  return 'unknown_command';
}

/** Extract generation type from URL or error context. */
function extractGenerationType(url: string): string {
  const match = url.match(/\/api\/generate\/([^/?#]+)/);
  return match?.[1] ?? 'unknown_type';
}

/** Extract auth error code from error message. */
function extractAuthCode(message: string): string {
  // Matches codes like "AUTH_001", "INSUFFICIENT_TOKENS", "INVALID_KEY"
  const codeMatch = message.match(/\b([A-Z_]{4,}(?:_\d+)?)\b/);
  return codeMatch?.[1] ?? 'AUTH_UNKNOWN';
}

/** True when the error message looks like a timeout / deadline exceeded. */
function isTimeoutError(message: string): boolean {
  return /timeout|timed?\s*out|deadline|econnreset|socket hang/i.test(message);
}

/** True when the error message looks like a rate-limit response. */
function isRateLimitError(message: string): boolean {
  return /rate.?limit|too many requests|429/i.test(message);
}

/** True when the error is auth-related. */
function isAuthError(message: string): boolean {
  return /unauthorized|unauthenticated|403|401|invalid.?key|api.?key|token.?expired|insufficient.?token/i.test(message);
}

/** True when the error originates from a WASM engine command. */
function isWasmError(message: string, transaction?: string): boolean {
  return (
    /wasm|engine|handle_command/i.test(message) ||
    (transaction !== undefined && /wasm/i.test(transaction))
  );
}

/** True when the error originates from an AI generation route. */
function isGenerationError(url?: string): boolean {
  return Boolean(url && /\/api\/generate\//i.test(url));
}

// ---------------------------------------------------------------------------
// Event processor
// ---------------------------------------------------------------------------

function fingerprintEvent(event: Event): Event {
  const message = event.exception?.values?.[0]?.value ?? event.message ?? '';
  const transaction = event.transaction;
  const requestUrl = event.request?.url ?? '';

  // --- Rate limit errors → single group regardless of provider or route
  if (isRateLimitError(message)) {
    event.fingerprint = ['rate-limit-exceeded'];
    event.tags = { ...event.tags, error_class: 'rate_limit' };
    return event;
  }

  // --- Auth / token errors → group by error code
  if (isAuthError(message)) {
    const code = extractAuthCode(message);
    event.fingerprint = ['auth-error', code];
    event.tags = { ...event.tags, error_class: 'auth', auth_code: code };
    return event;
  }

  // --- WASM command failures → group by command type
  if (isWasmError(message, transaction)) {
    const command = extractWasmCommand(message, transaction);
    event.fingerprint = ['wasm-command-failure', command];
    event.tags = { ...event.tags, error_class: 'wasm', wasm_command: command };
    return event;
  }

  // --- AI generation failures → group by generation type
  if (isGenerationError(requestUrl)) {
    const genType = extractGenerationType(requestUrl);
    event.fingerprint = ['generation-failure', genType];
    event.tags = { ...event.tags, error_class: 'generation', generation_type: genType };
    return event;
  }

  // --- AI provider timeout → group by provider name
  if (isTimeoutError(message)) {
    const provider = extractProvider(message);
    event.fingerprint = ['ai-provider-timeout', provider];
    event.tags = { ...event.tags, error_class: 'timeout', ai_provider: provider };
    return event;
  }

  // --- Generic AI provider errors → group by provider + error type (not full message)
  const hasProviderInMessage =
    /anthropic|openai|openrouter|elevenlabs|suno|meshy|stability/i.test(message);
  if (hasProviderInMessage) {
    const provider = extractProvider(message);
    // Use exception type (e.g. "APIError", "NetworkError") rather than the
    // full message which may include dynamic IDs / counts.
    const exceptionType = event.exception?.values?.[0]?.type ?? 'Error';
    event.fingerprint = ['ai-provider-error', provider, exceptionType];
    event.tags = { ...event.tags, error_class: 'ai_provider', ai_provider: provider };
    return event;
  }

  // Fall through — Sentry default fingerprinting applies
  return event;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Register the Sentry event processor that applies consistent fingerprinting
 * rules for AI module errors.
 *
 * Call this once from sentry.client.config.ts (and sentry.server.config.ts if
 * server-side fingerprinting is also desired).
 *
 * Groups:
 *   - AI provider timeout      → fingerprint: ['ai-provider-timeout', '<provider>']
 *   - Rate limit exceeded       → fingerprint: ['rate-limit-exceeded']
 *   - WASM command failure      → fingerprint: ['wasm-command-failure', '<command>']
 *   - Auth / token error        → fingerprint: ['auth-error', '<code>']
 *   - Generation failure        → fingerprint: ['generation-failure', '<type>']
 *   - Generic AI provider error → fingerprint: ['ai-provider-error', '<provider>', '<ExceptionType>']
 */
export function configureSentryFingerprinting(): void {
  Sentry.addEventProcessor((event: Event) => fingerprintEvent(event));
}

// Export helpers for unit testing
export {
  fingerprintEvent,
  extractProvider,
  extractWasmCommand,
  extractGenerationType,
  extractAuthCode,
  isTimeoutError,
  isRateLimitError,
  isAuthError,
  isWasmError,
  isGenerationError,
};
