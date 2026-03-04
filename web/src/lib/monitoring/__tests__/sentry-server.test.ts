import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@sentry/node', () => ({
  init: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  startSpan: vi.fn((_opts: unknown, cb: () => unknown) => cb()),
}));

import * as Sentry from '@sentry/node';

describe('sentry-server', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe('when SENTRY_DSN is not set', () => {
    it('captureException no-ops', async () => {
      vi.stubEnv('SENTRY_DSN', '');
      const { captureException } = await import('../sentry-server');
      captureException(new Error('test'));
      expect(Sentry.captureException).not.toHaveBeenCalled();
      vi.unstubAllEnvs();
    });

    it('captureMessage no-ops', async () => {
      vi.stubEnv('SENTRY_DSN', '');
      const { captureMessage } = await import('../sentry-server');
      captureMessage('hello');
      expect(Sentry.captureMessage).not.toHaveBeenCalled();
      vi.unstubAllEnvs();
    });

    it('startSpan still executes the callback', async () => {
      vi.stubEnv('SENTRY_DSN', '');
      const { startSpan } = await import('../sentry-server');
      const result = startSpan({ name: 'op' }, () => 42);
      expect(result).toBe(42);
      expect(Sentry.startSpan).not.toHaveBeenCalled();
      vi.unstubAllEnvs();
    });
  });

  describe('when SENTRY_DSN is set', () => {
    it('captureException forwards to Sentry', async () => {
      vi.stubEnv('SENTRY_DSN', 'https://key@sentry.io/123');
      const { captureException } = await import('../sentry-server');
      const err = new Error('boom');
      captureException(err, { userId: '1' });
      expect(Sentry.init).toHaveBeenCalled();
      expect(Sentry.captureException).toHaveBeenCalledWith(err, { extra: { userId: '1' } });
      vi.unstubAllEnvs();
    });

    it('captureException works without context', async () => {
      vi.stubEnv('SENTRY_DSN', 'https://key@sentry.io/123');
      const { captureException } = await import('../sentry-server');
      const err = new Error('boom');
      captureException(err);
      expect(Sentry.captureException).toHaveBeenCalledWith(err, undefined);
      vi.unstubAllEnvs();
    });

    it('captureMessage forwards to Sentry with level', async () => {
      vi.stubEnv('SENTRY_DSN', 'https://key@sentry.io/123');
      const { captureMessage } = await import('../sentry-server');
      captureMessage('alert', 'warning');
      expect(Sentry.captureMessage).toHaveBeenCalledWith('alert', 'warning');
      vi.unstubAllEnvs();
    });

    it('captureMessage defaults to info level', async () => {
      vi.stubEnv('SENTRY_DSN', 'https://key@sentry.io/123');
      const { captureMessage } = await import('../sentry-server');
      captureMessage('info msg');
      expect(Sentry.captureMessage).toHaveBeenCalledWith('info msg', 'info');
      vi.unstubAllEnvs();
    });

    it('startSpan delegates to Sentry.startSpan', async () => {
      vi.stubEnv('SENTRY_DSN', 'https://key@sentry.io/123');
      const { startSpan } = await import('../sentry-server');
      const result = startSpan({ name: 'db.query', op: 'db' }, () => 'result');
      expect(result).toBe('result');
      expect(Sentry.startSpan).toHaveBeenCalled();
      vi.unstubAllEnvs();
    });
  });
});
