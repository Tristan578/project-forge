import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const flushPromises = () => new Promise<void>((r) => { queueMicrotask(r); });

describe('webVitals', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('exports reportWebVitals function', async () => {
    const mod = await import('@/lib/monitoring/webVitals');
    expect(typeof mod.reportWebVitals).toBe('function');
  });

  it('no-ops when window is undefined (SSR)', async () => {
    const originalWindow = globalThis.window;
    // @ts-expect-error -- simulating SSR
    delete globalThis.window;

    vi.resetModules();
    const { reportWebVitals } = await import('@/lib/monitoring/webVitals');
    expect(() => reportWebVitals()).not.toThrow();

    globalThis.window = originalWindow;
  });

  it('calls web-vitals observers when window exists', async () => {
    const mockOnLCP = vi.fn();
    const mockOnFCP = vi.fn();
    const mockOnCLS = vi.fn();
    const mockOnINP = vi.fn();

    vi.doMock('web-vitals', () => ({
      onLCP: mockOnLCP,
      onFCP: mockOnFCP,
      onCLS: mockOnCLS,
      onINP: mockOnINP,
    }));

    vi.resetModules();
    const { reportWebVitals } = await import('@/lib/monitoring/webVitals');
    reportWebVitals();

    await flushPromises();

    expect(mockOnLCP).toHaveBeenCalledOnce();
    expect(mockOnFCP).toHaveBeenCalledOnce();
    expect(mockOnCLS).toHaveBeenCalledOnce();
    expect(mockOnINP).toHaveBeenCalledOnce();
  });

  it('calls custom reporter with adapted metric', async () => {
    let capturedCallback: ((m: unknown) => void) | undefined;

    vi.doMock('web-vitals', () => ({
      onLCP: (cb: (m: unknown) => void) => { capturedCallback = cb; },
      onFCP: vi.fn(),
      onCLS: vi.fn(),
      onINP: vi.fn(),
    }));

    vi.resetModules();
    const reporter = vi.fn();
    const { reportWebVitals } = await import('@/lib/monitoring/webVitals');
    reportWebVitals(reporter);

    await flushPromises();

    expect(capturedCallback).toBeDefined();
    capturedCallback!({
      name: 'LCP',
      value: 2500,
      rating: 'good',
      id: 'v4-123',
      delta: 2500,
      entries: [],
      navigationType: 'navigate',
    });

    expect(reporter).toHaveBeenCalledWith({
      name: 'LCP',
      value: 2500,
      rating: 'good',
      id: 'v4-123',
    });
  });

  it('logs to console in development mode', async () => {
    const originalEnv = process.env.NODE_ENV;
    // @ts-expect-error -- override for test
    process.env.NODE_ENV = 'development';

    let capturedCallback: ((m: unknown) => void) | undefined;

    vi.doMock('web-vitals', () => ({
      onLCP: (cb: (m: unknown) => void) => { capturedCallback = cb; },
      onFCP: vi.fn(),
      onCLS: vi.fn(),
      onINP: vi.fn(),
    }));

    vi.resetModules();
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { reportWebVitals } = await import('@/lib/monitoring/webVitals');
    reportWebVitals();

    await flushPromises();

    capturedCallback!({
      name: 'FCP',
      value: 1200.5,
      rating: 'needs-improvement',
      id: 'v4-456',
      delta: 1200.5,
      entries: [],
      navigationType: 'navigate',
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[Web Vital] FCP: 1200.50 (needs-improvement)')
    );

    consoleSpy.mockRestore();
    // @ts-expect-error -- restore
    process.env.NODE_ENV = originalEnv;
  });
});
