/**
 * Structured logger for SpawnForge server-side API routes.
 *
 * In development: pretty-prints human-readable lines to console.
 * In production: emits JSON lines for log aggregation (Axiom, Datadog, etc.).
 *
 * Usage:
 *   import { logger } from '@/lib/logging/logger';
 *   logger.info('User published game', { userId, projectId, slug });
 *
 *   // Child logger with bound context:
 *   const reqLog = logger.child({ requestId, userId });
 *   reqLog.info('Processing request');
 *   reqLog.error('DB query failed', { error: err.message });
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  requestId?: string;
  userId?: string;
  endpoint?: string;
  method?: string;
  statusCode?: number;
  durationMs?: number;
  [key: string]: unknown;
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  [key: string]: unknown;
}

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const REDACTED = '[REDACTED]';

/**
 * Sensitive name tokens. A context key is masked when any camelCase/underscore
 * segment of its name matches one of these (e.g. `apiKey`, `encrypted_key`,
 * `Authorization` all match). Erring toward over-masking is intentional — a
 * logger must never be the thing that leaks a credential (#8642).
 */
const SENSITIVE_KEY_TOKENS = new Set([
  'key', 'apikey', 'token', 'secret', 'password', 'pwd', 'passphrase',
  'authorization', 'auth', 'credential', 'credentials', 'cookie', 'session',
  'encryptedkey', 'privatekey', 'jwt', 'bearer',
]);

/**
 * Value patterns that look like secrets regardless of the key they sit under.
 * These scrub credentials embedded in otherwise-innocent strings — e.g. an
 * error message that interpolated a key, logged under `{ error: err.message }`.
 */
const SECRET_VALUE_PATTERNS: RegExp[] = [
  /Bearer\s+[A-Za-z0-9._\-]+/gi,
  /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]+/g,
  // OpenAI (`sk-...`, `sk-proj-...`) and Anthropic (`sk-ant-api03-...`) keys embed
  // hyphens in the body, so the character class must include `-` and `_` or the
  // match terminates at the first hyphen and the key survives unredacted.
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  /\bwhsec_[A-Za-z0-9]+/g,
  /\bforge_[A-Za-z0-9]+/g,
  /\beyJ[A-Za-z0-9._\-]{20,}/g, // JWT
];

const MAX_REDACT_DEPTH = 6;

function isSensitiveKey(key: string): boolean {
  // Split camelCase and any non-alphanumeric separators, then lower-case.
  const segments = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+/);
  return segments.some((seg) => SENSITIVE_KEY_TOKENS.has(seg.toLowerCase()));
}

function scrubString(value: string): string {
  let out = value;
  for (const pattern of SECRET_VALUE_PATTERNS) {
    out = out.replace(pattern, REDACTED);
  }
  return out;
}

/**
 * Recursively redact a value: mask values whose key name is sensitive, scrub
 * secret-shaped substrings from strings, and bound depth/cycles so a pathological
 * context object can never hang or overflow the logger.
 */
function redactValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return scrubString(value);
  if (value === null || typeof value !== 'object') return value;

  if (seen.has(value as object)) return '[Circular]';
  if (depth >= MAX_REDACT_DEPTH) return '[Truncated]';
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, depth + 1, seen));
  }

  // Error objects don't enumerate `message`/`stack` as own keys — surface a
  // scrubbed message so a credential embedded in an error never escapes.
  if (value instanceof Error) {
    return { name: value.name, message: scrubString(value.message) };
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = isSensitiveKey(k) && v != null ? REDACTED : redactValue(v, depth + 1, seen);
  }
  return out;
}

/** Redact a flat context object's fields prior to serialization. */
function redactContext(context: LogContext): LogContext {
  const out: LogContext = {};
  for (const [k, v] of Object.entries(context)) {
    // A FRESH cycle-tracking set per top-level key. A WeakSet shared across
    // sibling keys would wrongly flag a legitimately shared object reference
    // (the same object appearing under two different top-level keys) as
    // [Circular] on the second visit and silently drop its data. A cycle is
    // only meaningful WITHIN a single value's own root-to-descendant traversal,
    // never across siblings — so the set must not outlive one top-level key.
    const seen = new WeakSet<object>();
    out[k] = isSensitiveKey(k) && v != null ? REDACTED : redactValue(v, 1, seen);
  }
  return out;
}

/**
 * Determine the minimum log level from env.
 * Defaults to 'info' in production and 'debug' in development.
 */
function getMinLevel(): LogLevel {
  const envLevel = process.env.LOG_LEVEL as LogLevel | undefined;
  if (envLevel && envLevel in LOG_LEVEL_ORDER) return envLevel;
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
}

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: '\x1b[36m', // cyan
  info: '\x1b[32m',  // green
  warn: '\x1b[33m',  // yellow
  error: '\x1b[31m', // red
};
const RESET = '\x1b[0m';

function prettyPrint(entry: LogEntry): void {
  const color = LEVEL_COLORS[entry.level as LogLevel] ?? '';
  const { timestamp, level, message, ...rest } = entry;
  const contextStr = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : '';
  const line = `${color}[${level.toUpperCase()}]${RESET} ${timestamp} ${message}${contextStr}`;

  switch (entry.level as LogLevel) {
    case 'error':
      console.error(line);
      break;
    case 'warn':
      console.warn(line);
      break;
    default:
      console.log(line);
  }
}

function writeEntry(entry: LogEntry): void {
  const minLevel = getMinLevel();
  if (LOG_LEVEL_ORDER[entry.level as LogLevel] < LOG_LEVEL_ORDER[minLevel]) return;

  if (isProduction()) {
    // Emit newline-delimited JSON for log aggregation
    console.log(JSON.stringify(entry));
  } else {
    prettyPrint(entry);
  }
}

function buildEntry(
  level: LogLevel,
  message: string,
  context: LogContext,
  boundContext: LogContext,
): LogEntry {
  // Merge bound + per-call context, then run a single redaction pass so neither
  // a sensitive key name nor a secret-shaped value reaches stdout / aggregation.
  const merged = redactContext({ ...boundContext, ...context });
  return {
    timestamp: new Date().toISOString(),
    level,
    message: scrubString(message),
    ...merged,
  };
}

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  /** Create a child logger with bound context fields. */
  child(boundContext: LogContext): Logger;
}

function createLogger(boundContext: LogContext = {}): Logger {
  return {
    debug(message: string, context: LogContext = {}): void {
      writeEntry(buildEntry('debug', message, context, boundContext));
    },

    info(message: string, context: LogContext = {}): void {
      writeEntry(buildEntry('info', message, context, boundContext));
    },

    warn(message: string, context: LogContext = {}): void {
      writeEntry(buildEntry('warn', message, context, boundContext));
    },

    error(message: string, context: LogContext = {}): void {
      writeEntry(buildEntry('error', message, context, boundContext));
    },

    child(childContext: LogContext): Logger {
      return createLogger({ ...boundContext, ...childContext });
    },
  };
}

/** Root application logger. */
export const logger: Logger = createLogger();
