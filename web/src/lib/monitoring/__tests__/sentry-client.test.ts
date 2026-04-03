import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@sentry/nextjs', () => ({
  init: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  startSpan: vi.fn((_opts: unknown, cb: () => unknown) => cb()),
  browserTracingIntegration: vi.fn(() => ({})),
  replayIntegration: vi.fn(() => ({})),
}));

import * as Sentry from '@sentry/nextjs';

describe('sentry-client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe('when NEXT_PUBLIC_SENTRY_DSN is not set', () => {
    it('initSentryClient no-ops', async () => {
      vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', '');
      const { initSentryClient } = await import('../sentry-client');
      initSentryClient();
      expect(Sentry.init).not.toHaveBeenCalled();
      vi.unstubAllEnvs();
    });

    it('captureException no-ops', async () => {
      vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', '');
      const { captureException } = await import('../sentry-client');
      captureException(new Error('test'));
      expect(Sentry.captureException).not.toHaveBeenCalled();
      vi.unstubAllEnvs();
    });

    it('captureMessage no-ops', async () => {
      vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', '');
      const { captureMessage } = await import('../sentry-client');
      captureMessage('hello');
      expect(Sentry.captureMessage).not.toHaveBeenCalled();
      vi.unstubAllEnvs();
    });

    it('startSpan still executes the callback', async () => {
      vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', '');
      const { startSpan } = await import('../sentry-client');
      const result = startSpan({ name: 'op' }, () => 42);
      expect(result).toBe(42);
      expect(Sentry.startSpan).not.toHaveBeenCalled();
      vi.unstubAllEnvs();
    });
  });

  describe('when NEXT_PUBLIC_SENTRY_DSN is set', () => {
    it('initSentryClient is a no-op (init handled by instrumentation-client.ts)', async () => {
      vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', 'https://key@sentry.io/456');
      vi.stubEnv('NODE_ENV', 'production');
      const { initSentryClient } = await import('../sentry-client');
      initSentryClient();
      // @sentry/nextjs initializes via instrumentation-client.ts, not this function
      expect(Sentry.init).not.toHaveBeenCalled();
      vi.unstubAllEnvs();
    });

    it('captureException forwards to Sentry', async () => {
      vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', 'https://key@sentry.io/456');
      const { captureException } = await import('../sentry-client');
      const err = new Error('boom');
      captureException(err, { page: '/editor' });
      expect(Sentry.captureException).toHaveBeenCalledWith(err, { extra: { page: '/editor' } });
      vi.unstubAllEnvs();
    });

    it('captureMessage forwards with default info level', async () => {
      vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', 'https://key@sentry.io/456');
      const { captureMessage } = await import('../sentry-client');
      captureMessage('user action');
      expect(Sentry.captureMessage).toHaveBeenCalledWith('user action', 'info');
      vi.unstubAllEnvs();
    });

    it('startSpan delegates to Sentry.startSpan', async () => {
      vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', 'https://key@sentry.io/456');
      const { startSpan } = await import('../sentry-client');
      const result = startSpan({ name: 'render', op: 'ui' }, () => 'done');
      expect(result).toBe('done');
      expect(Sentry.startSpan).toHaveBeenCalled();
      vi.unstubAllEnvs();
    });
  });
});
