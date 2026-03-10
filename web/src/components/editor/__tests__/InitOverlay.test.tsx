/**
 * Render tests for InitOverlay component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { InitOverlay } from '../InitOverlay';

vi.mock('@/hooks/useEngineStatus', () => ({
  useEngineStatus: vi.fn(),
  PHASE_LABELS: {
    wasm_loading: 'Loading WASM',
    renderer_init: 'Initializing Renderer',
    scene_setup: 'Setting Up Scene',
  },
}));

vi.mock('@/lib/initLog', () => ({
  copyInitLogToClipboard: vi.fn().mockResolvedValue(true),
}));

import { useEngineStatus } from '@/hooks/useEngineStatus';

const baseStatus = {
  currentPhase: 'renderer_init' as const,
  phases: [
    { phase: 'wasm_loading' as const, status: 'done' as const, duration: 1500, message: null },
    { phase: 'renderer_init' as const, status: 'active' as const, duration: 0, message: null },
    { phase: 'scene_setup' as const, status: 'pending' as const, duration: 0, message: null },
  ],
  totalElapsed: 2000,
  isTimedOut: false,
  timeoutPhase: null as string | null,
  retryCount: 0,
  canRetry: false,
  isReady: false,
  retry: vi.fn(),
  logEvent: vi.fn(),
  error: null as string | null,
};

describe('InitOverlay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('returns null when engine is ready', () => {
    vi.mocked(useEngineStatus).mockReturnValue({ ...baseStatus, isReady: true });
    const { container } = render(<InitOverlay />);
    expect(container.firstChild).toBeNull();
  });

  it('renders Initializing Engine heading when not ready', () => {
    vi.mocked(useEngineStatus).mockReturnValue(baseStatus);
    render(<InitOverlay />);
    expect(screen.getByText('Initializing Engine...')).toBeDefined();
  });

  it('shows phase labels', () => {
    vi.mocked(useEngineStatus).mockReturnValue(baseStatus);
    render(<InitOverlay />);
    expect(screen.getByText('Loading WASM (1.5s)')).toBeDefined();
    expect(screen.getByText('Initializing Renderer')).toBeDefined();
    expect(screen.getByText('Setting Up Scene')).toBeDefined();
  });

  it('shows elapsed time', () => {
    vi.mocked(useEngineStatus).mockReturnValue(baseStatus);
    render(<InitOverlay />);
    expect(screen.getByText(/Elapsed: 2\.0s/)).toBeDefined();
  });

  it('shows timeout warning for wasm_loading phase', () => {
    vi.mocked(useEngineStatus).mockReturnValue({
      ...baseStatus,
      isTimedOut: true,
      timeoutPhase: 'wasm_loading',
      canRetry: true, // canRetry=true prevents showFailedState from triggering
    });
    render(<InitOverlay />);
    // Text may be broken across child elements — check container text content
    const container = document.body;
    expect(container.textContent).toMatch(/Slow network/);
  });

  it('shows timeout warning for renderer_init phase', () => {
    vi.mocked(useEngineStatus).mockReturnValue({
      ...baseStatus,
      isTimedOut: true,
      timeoutPhase: 'renderer_init',
      canRetry: true,
    });
    render(<InitOverlay />);
    const container = document.body;
    expect(container.textContent).toMatch(/GPU initialization/);
  });

  it('shows Retry button when canRetry and isTimedOut', () => {
    vi.mocked(useEngineStatus).mockReturnValue({
      ...baseStatus,
      isTimedOut: true,
      canRetry: true,
      timeoutPhase: 'wasm_loading',
    });
    render(<InitOverlay />);
    expect(screen.getByText('Retry')).toBeDefined();
  });

  it('calls retry when Retry button clicked', () => {
    const mockRetry = vi.fn();
    vi.mocked(useEngineStatus).mockReturnValue({
      ...baseStatus,
      isTimedOut: true,
      canRetry: true,
      timeoutPhase: 'wasm_loading',
      retry: mockRetry,
    });
    render(<InitOverlay />);
    fireEvent.click(screen.getByText('Retry'));
    expect(mockRetry).toHaveBeenCalled();
  });

  it('shows failed state when retryCount >= 3', () => {
    vi.mocked(useEngineStatus).mockReturnValue({
      ...baseStatus,
      retryCount: 3,
    });
    render(<InitOverlay />);
    expect(screen.getByText('Unable to Initialize Engine')).toBeDefined();
  });

  it('shows Copy Debug Log button in failed state', () => {
    vi.mocked(useEngineStatus).mockReturnValue({
      ...baseStatus,
      retryCount: 3,
    });
    render(<InitOverlay />);
    expect(screen.getByText('Copy Debug Log')).toBeDefined();
  });

  it('shows Report Issue link in failed state', () => {
    vi.mocked(useEngineStatus).mockReturnValue({
      ...baseStatus,
      retryCount: 3,
    });
    render(<InitOverlay />);
    expect(screen.getByText('Report Issue')).toBeDefined();
  });

  it('shows error message when error is present and canRetry', () => {
    vi.mocked(useEngineStatus).mockReturnValue({
      ...baseStatus,
      error: 'WebGPU not supported',
      canRetry: true, // prevents showFailedState
    });
    render(<InitOverlay />);
    // The error text may be split across child text nodes
    expect(document.body.textContent).toMatch(/WebGPU not supported/);
  });

  it('shows attempt count when retryCount > 0', () => {
    vi.mocked(useEngineStatus).mockReturnValue({
      ...baseStatus,
      retryCount: 1,
    });
    render(<InitOverlay />);
    expect(screen.getByText(/Attempt 2\/3/)).toBeDefined();
  });
});
