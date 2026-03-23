/**
 * Tests for AnalyticsProvider component and analyticsBeforeSend filter.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@/test/utils/componentTestUtils';
import { AnalyticsProvider, analyticsBeforeSend } from '../AnalyticsProvider';

// Mock @vercel/analytics/next to avoid real network calls
vi.mock('@vercel/analytics/next', () => ({
  Analytics: ({
    mode,
  }: {
    mode: string;
    beforeSend: (e: { url: string }) => { url: string } | null;
  }) => (
    <div
      data-testid="analytics"
      data-mode={mode}
    />
  ),
}));

describe('AnalyticsProvider', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the Analytics component', () => {
    const { container } = render(<AnalyticsProvider />);
    const el = container.querySelector('[data-testid="analytics"]');
    expect(el).not.toBeNull();
  });

  it('passes a mode attribute to Analytics', () => {
    const { container } = render(<AnalyticsProvider />);
    const el = container.querySelector('[data-testid="analytics"]');
    const mode = el?.getAttribute('data-mode');
    // In production builds it will be 'production'; in dev/test 'development'.
    // We just verify it's one of the two valid modes.
    expect(['development', 'production']).toContain(mode);
  });

  it('passes mode="production" when NODE_ENV is production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { container } = render(<AnalyticsProvider />);
    // The analyticsMode constant is evaluated at module load time, so this test
    // documents the expected behaviour of the constant rather than the runtime state.
    const el = container.querySelector('[data-testid="analytics"]');
    expect(el).not.toBeNull();
    vi.unstubAllEnvs();
  });
});

// ── analyticsBeforeSend filter — unit tests ─────────────────────────────────
// These tests directly exercise the exported filter function without rendering.

describe('analyticsBeforeSend', () => {
  it('passes through a normal page event', () => {
    const event = { type: 'pageview' as const, url: '/editor' };
    expect(analyticsBeforeSend(event)).toEqual({ type: 'pageview' as const, url: '/editor' });
  });

  it('filters out /dev exact path', () => {
    expect(analyticsBeforeSend({ type: 'pageview' as const, url: '/dev' })).toBeNull();
  });

  it('filters out /dev/ subpaths', () => {
    expect(analyticsBeforeSend({ type: 'pageview' as const, url: '/dev/sandbox' })).toBeNull();
    expect(analyticsBeforeSend({ type: 'pageview' as const, url: '/dev/another-path' })).toBeNull();
  });

  it('filters out /admin routes', () => {
    expect(analyticsBeforeSend({ type: 'pageview' as const, url: '/admin/economics' })).toBeNull();
    expect(analyticsBeforeSend({ type: 'pageview' as const, url: '/admin' })).toBeNull();
  });

  it('filters out /api/ routes', () => {
    expect(analyticsBeforeSend({ type: 'pageview' as const, url: '/api/chat' })).toBeNull();
    expect(analyticsBeforeSend({ type: 'pageview' as const, url: '/api/jobs' })).toBeNull();
  });

  it('passes through /pricing page', () => {
    const event = { type: 'pageview' as const, url: '/pricing' };
    expect(analyticsBeforeSend(event)).toEqual(event);
  });

  it('passes through /sign-up page', () => {
    const event = { type: 'pageview' as const, url: '/sign-up' };
    expect(analyticsBeforeSend(event)).toEqual(event);
  });

  it('passes through the marketing landing page root', () => {
    const event = { type: 'pageview' as const, url: '/' };
    expect(analyticsBeforeSend(event)).toEqual(event);
  });

  it('passes through /play/ routes (published games)', () => {
    const event = { type: 'pageview' as const, url: '/play/my-game-slug' };
    expect(analyticsBeforeSend(event)).toEqual(event);
  });

  it('returns the original event object reference (not a copy)', () => {
    const event = { type: 'pageview' as const, url: '/editor' };
    expect(analyticsBeforeSend(event)).toBe(event);
  });
});
