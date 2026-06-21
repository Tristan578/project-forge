import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { logger } from '@/lib/logging/logger';
import type { LogEntry } from '@/lib/logging/logger';

// Capture what was written to the console
function captureConsole() {
  const entries: { method: string; args: unknown[] }[] = [];
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;

  console.log = (...args: unknown[]) => entries.push({ method: 'log', args });
  console.warn = (...args: unknown[]) => entries.push({ method: 'warn', args });
  console.error = (...args: unknown[]) => entries.push({ method: 'error', args });

  return {
    entries,
    restore() {
      console.log = origLog;
      console.warn = origWarn;
      console.error = origError;
    },
  };
}

describe('logger', () => {
  let origNodeEnv: string | undefined;
  let origLogLevel: string | undefined;

  beforeEach(() => {
    origNodeEnv = process.env.NODE_ENV;
    origLogLevel = process.env.LOG_LEVEL;
    // Force development mode so pretty-print is used (easier to inspect)
    (process.env as Record<string, string>).NODE_ENV = 'development';
    delete (process.env as Record<string, string | undefined>).LOG_LEVEL;
  });

  afterEach(() => {
    (process.env as Record<string, string | undefined>).NODE_ENV = origNodeEnv;
    if (origLogLevel === undefined) {
      delete (process.env as Record<string, string | undefined>).LOG_LEVEL;
    } else {
      (process.env as Record<string, string>).LOG_LEVEL = origLogLevel;
    }
  });

  describe('info()', () => {
    it('calls console.log', () => {
      const cap = captureConsole();
      try {
        logger.info('hello world');
        expect(cap.entries).toHaveLength(1);
        expect(cap.entries[0].method).toBe('log');
        expect(String(cap.entries[0].args[0])).toContain('hello world');
      } finally {
        cap.restore();
      }
    });

    it('includes context fields in output', () => {
      const cap = captureConsole();
      try {
        logger.info('user action', { userId: 'u-1', requestId: 'req_abc' });
        expect(cap.entries).toHaveLength(1);
        const output = String(cap.entries[0].args[0]);
        expect(output).toContain('user action');
        expect(output).toContain('u-1');
        expect(output).toContain('req_abc');
      } finally {
        cap.restore();
      }
    });
  });

  describe('warn()', () => {
    it('calls console.warn', () => {
      const cap = captureConsole();
      try {
        logger.warn('rate limit hit');
        expect(cap.entries[0].method).toBe('warn');
      } finally {
        cap.restore();
      }
    });
  });

  describe('error()', () => {
    it('calls console.error', () => {
      const cap = captureConsole();
      try {
        logger.error('db failure', { error: 'connection refused' });
        expect(cap.entries[0].method).toBe('error');
        const output = String(cap.entries[0].args[0]);
        expect(output).toContain('db failure');
        expect(output).toContain('connection refused');
      } finally {
        cap.restore();
      }
    });
  });

  describe('debug()', () => {
    it('emits in development mode', () => {
      const cap = captureConsole();
      try {
        logger.debug('debug trace');
        expect(cap.entries).toHaveLength(1);
        expect(String(cap.entries[0].args[0])).toContain('debug trace');
      } finally {
        cap.restore();
      }
    });

    it('is suppressed when LOG_LEVEL=info', () => {
      (process.env as Record<string, string>).LOG_LEVEL = 'info';
      const cap = captureConsole();
      try {
        logger.debug('should be suppressed');
        expect(cap.entries).toHaveLength(0);
      } finally {
        cap.restore();
        delete (process.env as Record<string, string | undefined>).LOG_LEVEL;
      }
    });
  });

  describe('child()', () => {
    it('returns a logger with bound context', () => {
      const cap = captureConsole();
      try {
        const reqLog = logger.child({ requestId: 'req_test', userId: 'u-42' });
        reqLog.info('child message');
        const output = String(cap.entries[0].args[0]);
        expect(output).toContain('req_test');
        expect(output).toContain('u-42');
        expect(output).toContain('child message');
      } finally {
        cap.restore();
      }
    });

    it('child context is merged with per-call context', () => {
      const cap = captureConsole();
      try {
        const reqLog = logger.child({ requestId: 'req_bound' });
        reqLog.info('with extra', { endpoint: '/api/test' });
        const output = String(cap.entries[0].args[0]);
        expect(output).toContain('req_bound');
        expect(output).toContain('/api/test');
      } finally {
        cap.restore();
      }
    });

    it('per-call context overrides bound context for the same key', () => {
      const cap = captureConsole();
      try {
        const reqLog = logger.child({ requestId: 'req_original' });
        reqLog.info('overridden', { requestId: 'req_override' });
        const output = String(cap.entries[0].args[0]);
        expect(output).toContain('req_override');
        expect(output).not.toContain('req_original');
      } finally {
        cap.restore();
      }
    });
  });

  describe('production JSON output', () => {
    it('emits a valid JSON string to console.log', () => {
      (process.env as Record<string, string>).NODE_ENV = 'production';
      const cap = captureConsole();
      try {
        logger.info('production event', { userId: 'u-prod', statusCode: 200 });
        expect(cap.entries).toHaveLength(1);
        expect(cap.entries[0].method).toBe('log');
        const raw = cap.entries[0].args[0] as string;
        expect(() => JSON.parse(raw)).not.toThrow();
        const entry = JSON.parse(raw) as LogEntry;
        expect(entry.level).toBe('info');
        expect(entry.message).toBe('production event');
        expect(entry.userId).toBe('u-prod');
        expect(entry.statusCode).toBe(200);
        expect(typeof entry.timestamp).toBe('string');
      } finally {
        cap.restore();
      }
    });

    it('emits warn via console.log (JSON line)', () => {
      (process.env as Record<string, string>).NODE_ENV = 'production';
      const cap = captureConsole();
      try {
        // In production all levels go through console.log as JSON
        logger.warn('production warning');
        expect(cap.entries[0].method).toBe('log');
        const entry = JSON.parse(cap.entries[0].args[0] as string) as LogEntry;
        expect(entry.level).toBe('warn');
      } finally {
        cap.restore();
      }
    });

    it('emits error via console.log (JSON line)', () => {
      (process.env as Record<string, string>).NODE_ENV = 'production';
      const cap = captureConsole();
      try {
        logger.error('production error', { error: 'boom' });
        const entry = JSON.parse(cap.entries[0].args[0] as string) as LogEntry;
        expect(entry.level).toBe('error');
        expect(entry.error).toBe('boom');
      } finally {
        cap.restore();
      }
    });

    it('produces valid JSON with child logger', () => {
      (process.env as Record<string, string>).NODE_ENV = 'production';
      const cap = captureConsole();
      try {
        const reqLog = logger.child({ requestId: 'req_prod' });
        reqLog.info('child in prod');
        const entry = JSON.parse(cap.entries[0].args[0] as string) as LogEntry;
        expect(entry.requestId).toBe('req_prod');
      } finally {
        cap.restore();
      }
    });
  });

  describe('secret redaction (#8642)', () => {
    /** Run a logger call in production mode and return the parsed JSON entry. */
    function logProd(fn: () => void): LogEntry {
      (process.env as Record<string, string>).NODE_ENV = 'production';
      const cap = captureConsole();
      try {
        fn();
        return JSON.parse(cap.entries[0].args[0] as string) as LogEntry;
      } finally {
        cap.restore();
      }
    }

    it('masks values under sensitive key names', () => {
      const entry = logProd(() =>
        logger.info('resolved key', {
          apiKey: 'sk-secret-value',
          token: 'tok_abcdef',
          password: 'hunter2',
          authorization: 'Bearer xyz',
          encryptedKey: 'AAAA==',
          userId: 'u-1',
        }),
      );
      expect(entry.apiKey).toBe('[REDACTED]');
      expect(entry.token).toBe('[REDACTED]');
      expect(entry.password).toBe('[REDACTED]');
      expect(entry.authorization).toBe('[REDACTED]');
      expect(entry.encryptedKey).toBe('[REDACTED]');
      // Non-sensitive fields are preserved
      expect(entry.userId).toBe('u-1');
    });

    it('masks camelCase and snake_case key variants', () => {
      const entry = logProd(() =>
        logger.info('mixed', {
          stripe_secret_key: 'sk_live_abc',
          cacheKey: 'safe-value-but-masked',
          sessionToken: 'abc',
        }),
      );
      expect(entry.stripe_secret_key).toBe('[REDACTED]');
      expect(entry.cacheKey).toBe('[REDACTED]');
      expect(entry.sessionToken).toBe('[REDACTED]');
    });

    it('does not mask innocuous keys that merely contain a sensitive substring', () => {
      const entry = logProd(() =>
        logger.info('innocuous', { monkey: 'banana', keyboard: 'qwerty', donkey: 'kong' }),
      );
      expect(entry.monkey).toBe('banana');
      expect(entry.keyboard).toBe('qwerty');
      expect(entry.donkey).toBe('kong');
    });

    it('scrubs secret-shaped substrings from non-sensitive string values', () => {
      const entry = logProd(() =>
        logger.error('db failure', {
          error: 'auth failed for Bearer abc.def.ghi using sk_live_deadbeef0000',
        }),
      );
      expect(entry.error).not.toContain('abc.def.ghi');
      expect(entry.error).not.toContain('sk_live_deadbeef0000');
      expect(entry.error).toContain('[REDACTED]');
    });

    it('scrubs hyphenated OpenAI/Anthropic keys embedded in a non-sensitive value (regression for #8642)', () => {
      // These project/key formats contain internal hyphens that terminated the
      // old `sk-[A-Za-z0-9]{20,}` class at the first dash, leaving the key in logs.
      const openaiProj = 'sk-proj-Abc123Def456Ghi789Jkl012Mno345';
      const anthropic = 'sk-ant-api03-Abc123Def456Ghi789Jkl012Mno345pqr';
      const entry = logProd(() =>
        logger.error('provider call failed', {
          detail: `openai=${openaiProj} anthropic=${anthropic}`,
        }),
      );
      expect(entry.detail).not.toContain(openaiProj);
      expect(entry.detail).not.toContain(anthropic);
      expect(entry.detail).not.toContain('sk-proj-');
      expect(entry.detail).not.toContain('sk-ant-api03-');
      expect(entry.detail).toContain('[REDACTED]');
    });

    it('scrubs forge_ and JWT patterns inside the log message itself', () => {
      const entry = logProd(() =>
        logger.info('user provided forge_abc123def456 and eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'),
      );
      expect(entry.message).not.toContain('forge_abc123def456');
      expect(entry.message).toContain('[REDACTED]');
    });

    it('redacts sensitive keys nested inside objects and arrays', () => {
      const entry = logProd(() =>
        logger.info('nested', {
          resolved: { provider: 'openai', key: 'sk-nested-secret' },
          items: [{ token: 'nested-token' }],
        }),
      );
      const resolved = entry.resolved as Record<string, unknown>;
      expect(resolved.provider).toBe('openai');
      expect(resolved.key).toBe('[REDACTED]');
      const items = entry.items as Array<Record<string, unknown>>;
      expect(items[0].token).toBe('[REDACTED]');
    });

    it('redacts a bound sensitive field on a child logger', () => {
      const entry = logProd(() => {
        const reqLog = logger.child({ apiKey: 'sk-bound-secret', requestId: 'req_1' });
        reqLog.info('child');
      });
      expect(entry.apiKey).toBe('[REDACTED]');
      expect(entry.requestId).toBe('req_1');
    });

    it('handles circular references without throwing', () => {
      const entry = logProd(() => {
        const circular: Record<string, unknown> = { name: 'root' };
        circular.self = circular;
        logger.info('circular', { data: circular });
      });
      const data = entry.data as Record<string, unknown>;
      expect(data.name).toBe('root');
      expect(data.self).toBe('[Circular]');
    });

    it('scrubs a credential embedded in an Error object message', () => {
      const entry = logProd(() =>
        logger.error('caught', { err: new Error('failed with sk_test_supersecret123') }),
      );
      const err = entry.err as Record<string, unknown>;
      expect(String(err.message)).not.toContain('sk_test_supersecret123');
      expect(String(err.message)).toContain('[REDACTED]');
    });
  });

  describe('log level filtering', () => {
    it('suppresses debug when LOG_LEVEL=warn', () => {
      (process.env as Record<string, string>).LOG_LEVEL = 'warn';
      const cap = captureConsole();
      try {
        logger.debug('debug');
        logger.info('info');
        logger.warn('warn');
        logger.error('error');
        expect(cap.entries).toHaveLength(2);
        const levels = cap.entries.map((e) => {
          const raw = e.args[0] as string;
          return raw.toUpperCase().includes('[WARN]') ? 'warn' : 'error';
        });
        expect(levels).toContain('warn');
        expect(levels).toContain('error');
      } finally {
        cap.restore();
      }
    });

    it('passes all levels when LOG_LEVEL=debug', () => {
      (process.env as Record<string, string>).LOG_LEVEL = 'debug';
      const cap = captureConsole();
      try {
        logger.debug('d');
        logger.info('i');
        logger.warn('w');
        logger.error('e');
        expect(cap.entries).toHaveLength(4);
      } finally {
        cap.restore();
      }
    });
  });
});

