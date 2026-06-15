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
  // Matches numeric HTTP auth status codes (401, 403) — check first so that a
  // message like "HTTP 401 Unauthorized" yields "HTTP_401" rather than just "HTTP".
  // Explicitly excludes 5xx server errors.
  const statusMatch = message.match(/\b(40[13])\b/);
  if (statusMatch?.[1]) return `HTTP_${statusMatch[1]}`;

  // Matches symbolic codes like "AUTH_001", "INSUFFICIENT_TOKENS", "INVALID_KEY".
  // Exclude bare "HTTP" which is a protocol prefix, not a meaningful auth code.
  const codeMatch = message.match(/\b([A-Z_]{4,}(?:_\d+)?)\b/);
  if (codeMatch?.[1] && codeMatch[1] !== 'HTTP') return codeMatch[1];

  return 'AUTH_UNKNOWN';
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
  // Use word boundaries around numeric codes to prevent matching substrings
  // like "5403" or "14010" — also explicitly exclude 5xx server errors.
  return /unauthorized|unauthenticated|\b40[13]\b|invalid.?key|api.?key|token.?expired|insufficient.?token/i.test(message);
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
// PII / credential scrubbing (beforeSend / beforeSendTransaction)
// ---------------------------------------------------------------------------
//
// Defence-in-depth for two High-severity audit findings (2026-05-30):
//   - F04: stack-frame local variables can hold decrypted BYOK provider keys and
//          prompts. We removed `includeLocalVariables` from the server init and
//          set `dataCollection.stackFrameVariables: false`, and additionally strip
//          `frame.vars` here in case it is ever re-enabled or populated by an
//          integration.
//   - F03: default PII collection is disabled via the exhaustive `dataCollection`
//          opt-out (migrated from `sendDefaultPii: false`), but breadcrumbs,
//          exception messages, request bodies, and structured context can still
//          embed emails, IPs, cookies, auth headers, and API keys. This hook
//          redacts them.
//
// `scrubEvent` is wired as both `beforeSend` and `beforeSendTransaction` in every
// Sentry.init (server, edge, client). It always returns the (mutated) event — the
// goal is to keep the error for debugging, just without the secrets.

/**
 * Key names whose values are redacted wholesale, regardless of their content.
 * Matched case-insensitively. Deliberately narrow on `token` (only credential
 * tokens, not token *counts*) — secret-looking values are caught separately by
 * {@link SECRET_VALUE_PATTERNS} even when the key name is innocuous.
 */
const SENSITIVE_KEY_RE =
  /authorization|cookie|password|passwd|secret|credential|api[_-]?key|apikey|access[_-]?key|private[_-]?key|encrypted[_-]?key|client[_-]?secret|\bauth[_-]?token\b|\baccess[_-]?token\b|\brefresh[_-]?token\b|\bsession\b|\bbearer\b|x-api-key|\bdsn\b|\bemail\b|\bphone\b|\bssn\b|\biv\b/i;

/**
 * Value patterns redacted anywhere they appear inside a string (messages, stack
 * values, breadcrumb text, query strings). Ordered most-specific first.
 *
 * Every quantifier is UPPER-bounded (RFC-aware lengths) so matching stays linear
 * in the input — there is no nested quantifier and no unbounded greedy run, which
 * eliminates the backtracking/event-loop-stall class on attacker-influenced text.
 * The `sk-`/`sk-ant-` patterns are `\b`-anchored so they never fire inside
 * ordinary identifiers like `disk-cache-…`, `task-…`, or `risk-…`.
 */
const SECRET_VALUE_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  // Anthropic-style provider keys (sk-ant-…) then generic OpenAI-style (sk-…)
  [/\bsk-ant-[A-Za-z0-9_-]{16,256}/g, '[REDACTED_API_KEY]'],
  [/\bsk-[A-Za-z0-9_-]{16,256}/g, '[REDACTED_API_KEY]'],
  // Replicate tokens (r8_…)
  [/\br8_[A-Za-z0-9]{20,256}/g, '[REDACTED_API_KEY]'],
  // JSON Web Tokens (three base64url segments). `.` is outside the char class,
  // so each segment match is unambiguous (no backtracking).
  [/\beyJ[A-Za-z0-9_-]{1,2048}\.[A-Za-z0-9_-]{1,2048}\.[A-Za-z0-9_-]{1,2048}/g, '[REDACTED_JWT]'],
  // Bearer tokens embedded in header-like strings
  [/Bearer\s+[A-Za-z0-9._~+/=-]{8,512}/gi, 'Bearer [REDACTED]'],
  // Email addresses (RFC-bounded local part / domain / TLD)
  [/[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,255}\.[A-Za-z]{2,24}/g, '[REDACTED_EMAIL]'],
  // IPv4 addresses
  [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[REDACTED_IP]'],
];

const REDACTED = '[REDACTED]';
const MAX_SCRUB_DEPTH = 8;

/** Apply every secret-value pattern to a single string. */
function scrubString(input: string): string {
  let out = input;
  for (const [re, replacement] of SECRET_VALUE_PATTERNS) {
    out = out.replace(re, replacement);
  }
  return out;
}

/**
 * Recursively redact sensitive keys and scrub secret-looking values, mutating in
 * place. Bounded by {@link MAX_SCRUB_DEPTH} to guard against pathological nesting.
 */
function deepScrub(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return scrubString(value);
  if (depth >= MAX_SCRUB_DEPTH) return value;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = deepScrub(value[i], depth + 1);
    return value;
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      obj[key] = SENSITIVE_KEY_RE.test(key) ? REDACTED : deepScrub(obj[key], depth + 1);
    }
    return obj;
  }
  return value;
}

/**
 * Strip local variables (F04 — they can hold decrypted BYOK keys/prompts) and
 * scrub source-context lines from every frame of a stacktrace, mutating in place.
 * Shared by exception values AND thread stacktraces: server-side Node events
 * attach frames under `event.threads[].stacktrace`, not just `exception.values`.
 */
function scrubStacktraceFrames(
  frames:
    | Array<{ vars?: unknown; context_line?: string; pre_context?: string[]; post_context?: string[] }>
    | undefined
): void {
  for (const frame of frames ?? []) {
    delete frame.vars;
    if (typeof frame.context_line === 'string') frame.context_line = scrubString(frame.context_line);
    if (Array.isArray(frame.pre_context)) {
      frame.pre_context = frame.pre_context.map((l) => (typeof l === 'string' ? scrubString(l) : l));
    }
    if (Array.isArray(frame.post_context)) {
      frame.post_context = frame.post_context.map((l) => (typeof l === 'string' ? scrubString(l) : l));
    }
  }
}

/**
 * `beforeSend` / `beforeSendTransaction` hook: strip PII and credentials from an
 * event before it leaves the process. Always returns the (mutated) event.
 */
function scrubEvent<T extends Event>(event: T): T {
  // 1. Exception values: drop frame locals (F04), scrub context lines, the
  //    exception message, and any mechanism data.
  for (const value of event.exception?.values ?? []) {
    scrubStacktraceFrames(value.stacktrace?.frames);
    if (typeof value.value === 'string') value.value = scrubString(value.value);
    if (value.mechanism?.data) {
      value.mechanism.data = deepScrub(value.mechanism.data) as typeof value.mechanism.data;
    }
  }

  // 1b. Thread stacktraces — same frame scrub (F04 also reaches here server-side).
  for (const thread of event.threads?.values ?? []) {
    scrubStacktraceFrames(thread.stacktrace?.frames);
  }

  // 2. Request context: drop cookies; redact sensitive header KEYS and scrub
  //    header VALUES (a secret can hide under an innocuous key name); scrub body,
  //    query, and env (REMOTE_ADDR / CGI vars).
  if (event.request) {
    delete event.request.cookies;
    const headers = event.request.headers;
    if (headers) {
      for (const key of Object.keys(headers)) {
        headers[key] = SENSITIVE_KEY_RE.test(key) ? REDACTED : scrubString(headers[key]);
      }
    }
    if (event.request.env) {
      event.request.env = deepScrub(event.request.env) as typeof event.request.env;
    }
    if (event.request.data !== undefined) {
      event.request.data = deepScrub(event.request.data);
    }
    const qs = event.request.query_string;
    if (typeof qs === 'string') {
      event.request.query_string = scrubString(qs);
    } else if (qs != null) {
      event.request.query_string = deepScrub(qs) as typeof event.request.query_string;
    }
  }

  // 3. User context: keep id for correlation, drop direct PII + geo (F03), scrub
  //    any remaining custom fields.
  if (event.user) {
    const user = event.user as Record<string, unknown>;
    delete user.ip_address;
    delete user.email;
    delete user.username;
    delete user.geo;
    for (const key of Object.keys(user)) {
      if (key === 'id') continue;
      user[key] = SENSITIVE_KEY_RE.test(key) ? REDACTED : deepScrub(user[key]);
    }
  }

  // 4. Free-text + structured context that may embed secrets.
  if (typeof event.message === 'string') event.message = scrubString(event.message);
  if (event.logentry && typeof event.logentry.message === 'string') {
    event.logentry.message = scrubString(event.logentry.message);
  }
  if (typeof event.transaction === 'string') event.transaction = scrubString(event.transaction);
  if (typeof event.server_name === 'string') event.server_name = scrubString(event.server_name);
  if (event.tags) {
    for (const key of Object.keys(event.tags)) {
      const v = event.tags[key];
      if (SENSITIVE_KEY_RE.test(key)) event.tags[key] = REDACTED;
      else if (typeof v === 'string') event.tags[key] = scrubString(v);
    }
  }
  for (const crumb of event.breadcrumbs ?? []) {
    if (typeof crumb.message === 'string') crumb.message = scrubString(crumb.message);
    if (crumb.data) crumb.data = deepScrub(crumb.data) as typeof crumb.data;
  }
  if (event.extra) event.extra = deepScrub(event.extra) as typeof event.extra;
  if (event.contexts) event.contexts = deepScrub(event.contexts) as typeof event.contexts;

  return event;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Register the Sentry event processor that applies consistent fingerprinting
 * rules for AI module errors.
 *
 * Call this once from instrumentation-client.ts (and sentry.server.config.ts if
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

/**
 * `beforeSend` / `beforeSendTransaction` hook for every Sentry.init (server,
 * edge, client). Strips PII and credentials from the event before transmission.
 * Re-exported under a stable name so the init files import a single symbol.
 */
export const scrubSentryEvent = scrubEvent;

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
  scrubEvent,
  scrubString,
  deepScrub,
};
