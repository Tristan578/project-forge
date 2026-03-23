/**
 * Tests for ServiceWorkerRegistration component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@/test/utils/componentTestUtils';
import { ServiceWorkerRegistration } from '../ServiceWorkerRegistration';

describe('ServiceWorkerRegistration', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('renders null — no DOM output', () => {
    const { container } = render(<ServiceWorkerRegistration />);
    expect(container.firstChild).toBeNull();
  });

  it('does not register SW in development mode', () => {
    const registerSpy = vi.fn().mockResolvedValue({});
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { register: registerSpy },
      configurable: true,
    });

    // NODE_ENV defaults to 'test' in vitest, not 'production' — no registration
    render(<ServiceWorkerRegistration />);
    expect(registerSpy).not.toHaveBeenCalled();
  });

  it('does not register SW when serviceWorker is not in navigator', () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
    Object.defineProperty(navigator, 'serviceWorker', {
      value: undefined,
      configurable: true,
    });

    render(<ServiceWorkerRegistration />);
    // No crash — component guards against missing serviceWorker API

    // Restore
    if (originalDescriptor) {
      Object.defineProperty(navigator, 'serviceWorker', originalDescriptor);
    }
  });

  it('registers SW with /sw.js path in production', () => {
    vi.stubEnv('NODE_ENV', 'production');

    const registerSpy = vi.fn().mockResolvedValue({});
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { register: registerSpy },
      configurable: true,
    });

    render(<ServiceWorkerRegistration />);

    expect(registerSpy).toHaveBeenCalledWith('/sw.js');
    expect(registerSpy).toHaveBeenCalledTimes(1);
  });

  it('swallows registration errors without crashing the app', () => {
    vi.stubEnv('NODE_ENV', 'production');

    const registerSpy = vi.fn().mockRejectedValue(new Error('SW registration failed'));
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { register: registerSpy },
      configurable: true,
    });

    // Should not throw
    expect(() => render(<ServiceWorkerRegistration />)).not.toThrow();
  });

  it('only registers once (runs effect once per mount)', () => {
    vi.stubEnv('NODE_ENV', 'production');

    const registerSpy = vi.fn().mockResolvedValue({});
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { register: registerSpy },
      configurable: true,
    });

    render(<ServiceWorkerRegistration />);

    // useEffect with [] deps runs exactly once per mount
    expect(registerSpy).toHaveBeenCalledTimes(1);
  });
});
