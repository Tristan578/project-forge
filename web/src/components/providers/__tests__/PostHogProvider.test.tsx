/**
 * Tests for PostHogProvider.
 *
 * Covers: mount-time initPostHog attempt, page-view tracking with and
 * without query params, the storage-event re-init path (both the
 * matching-key/consented branch and the branches that must NOT re-init),
 * and the effect cleanup that removes the storage listener on unmount.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@/test/utils/componentTestUtils';
import { PostHogProvider } from '../PostHogProvider';

const mockUsePathname = vi.fn();
const mockUseSearchParams = vi.fn();

vi.mock('next/navigation', () => ({
  usePathname: () => mockUsePathname(),
  useSearchParams: () => mockUseSearchParams(),
}));

const mockInitPostHog = vi.fn();
const mockTrackPageView = vi.fn();
const mockHasConsented = vi.fn();

vi.mock('@/lib/analytics/posthog', () => ({
  initPostHog: () => mockInitPostHog(),
  trackPageView: (url: string) => mockTrackPageView(url),
  hasConsented: () => mockHasConsented(),
}));

describe('PostHogProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUsePathname.mockReturnValue('/dashboard');
    mockUseSearchParams.mockReturnValue(new URLSearchParams());
    mockHasConsented.mockReturnValue(false);
  });

  afterEach(() => {
    cleanup();
  });

  it('attempts initPostHog on mount', () => {
    render(<PostHogProvider />);
    expect(mockInitPostHog).toHaveBeenCalledTimes(1);
  });

  it('tracks the bare pathname when there are no query params', () => {
    mockUsePathname.mockReturnValue('/docs');
    mockUseSearchParams.mockReturnValue(new URLSearchParams());

    render(<PostHogProvider />);

    expect(mockTrackPageView).toHaveBeenCalledWith('/docs');
  });

  it('tracks pathname + query string when search params are present', () => {
    mockUsePathname.mockReturnValue('/docs');
    mockUseSearchParams.mockReturnValue(new URLSearchParams('path=index&x=1'));

    render(<PostHogProvider />);

    expect(mockTrackPageView).toHaveBeenCalledWith('/docs?path=index&x=1');
  });

  it('does not track when pathname is falsy', () => {
    mockUsePathname.mockReturnValue('');

    render(<PostHogProvider />);

    expect(mockTrackPageView).not.toHaveBeenCalled();
  });

  it('re-initializes on a matching, consented storage event', () => {
    render(<PostHogProvider />);
    mockInitPostHog.mockClear();
    mockHasConsented.mockReturnValue(true);

    window.dispatchEvent(
      new StorageEvent('storage', { key: 'forge-cookie-consent', newValue: 'true' })
    );

    expect(mockInitPostHog).toHaveBeenCalledTimes(1);
  });

  it('ignores a storage event for an unrelated key', () => {
    render(<PostHogProvider />);
    mockInitPostHog.mockClear();
    mockHasConsented.mockReturnValue(true);

    window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated-key', newValue: 'true' }));

    expect(mockInitPostHog).not.toHaveBeenCalled();
  });

  it('ignores a matching-key storage event when consent has not been granted', () => {
    render(<PostHogProvider />);
    mockInitPostHog.mockClear();
    mockHasConsented.mockReturnValue(false);

    window.dispatchEvent(
      new StorageEvent('storage', { key: 'forge-cookie-consent', newValue: 'false' })
    );

    expect(mockInitPostHog).not.toHaveBeenCalled();
  });

  it('removes the storage listener on unmount', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = render(<PostHogProvider />);

    unmount();

    expect(removeSpy).toHaveBeenCalledWith('storage', expect.any(Function));
    removeSpy.mockRestore();
  });
});
