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
  return {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...boundContext,
    ...context,
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
