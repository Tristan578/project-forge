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

vi.mock('@/hooks/useEngine', () => ({
  setPreferredBackend: vi.fn(),
}));

import { useEngineStatus, type EngineStatus, type PhaseStatus } from '@/hooks/useEngineStatus';
import type { InitPhase } from '@/lib/initLog';
import { setPreferredBackend } from '@/hooks/useEngine';

const basePhases: PhaseStatus[] = [
  { phase: 'wasm_loading', status: 'done', duration: 1500 },
  { phase: 'renderer_init', status: 'active', duration: 0 },
  { phase: 'scene_setup', status: 'pending', duration: 0 },
];

const baseStatus: EngineStatus & { retry: () => void; logEvent: (phase: InitPhase, message?: string, error?: string) => void } = {
  currentPhase: 'renderer_init',
  phases: basePhases,
  totalElapsed: 2000,
  isTimedOut: false,
  timeoutPhase: null,
  retryCount: 0,
  canRetry: false,
  isReady: false,
  retry: vi.fn(),
  logEvent: vi.fn(),
  error: null,
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
    expect(screen.getByText('Initializing Engine...')).not.toBeNull();
  });

  it('shows phase labels', () => {
    vi.mocked(useEngineStatus).mockReturnValue(baseStatus);
    render(<InitOverlay />);
    expect(screen.getByText('Loading WASM (1.5s)')).not.toBeNull();
    expect(screen.getByText('Initializing Renderer')).not.toBeNull();
    expect(screen.getByText('Setting Up Scene')).not.toBeNull();
  });

  it('shows elapsed time', () => {
    vi.mocked(useEngineStatus).mockReturnValue(baseStatus);
    render(<InitOverlay />);
    expect(screen.getByText(/Elapsed: 2\.0s/)).not.toBeNull();
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
    expect(screen.getByText('Retry')).not.toBeNull();
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
    expect(screen.getByText('Unable to Initialize Engine')).not.toBeNull();
  });

  it('shows Copy Debug Log button in failed state', () => {
    vi.mocked(useEngineStatus).mockReturnValue({
      ...baseStatus,
      retryCount: 3,
    });
    render(<InitOverlay />);
    expect(screen.getByText('Copy Debug Log')).not.toBeNull();
  });

  it('shows Report Issue link in failed state', () => {
    vi.mocked(useEngineStatus).mockReturnValue({
      ...baseStatus,
      retryCount: 3,
    });
    render(<InitOverlay />);
    expect(screen.getByText('Report Issue')).not.toBeNull();
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
    expect(screen.getByText(/Attempt 2\/3/)).not.toBeNull();
  });

  // PF-845 regression: WebGL2 fallback button must be present in failed state
  it('shows Switch to WebGL2 Mode button in failed state (PF-845)', () => {
    vi.mocked(useEngineStatus).mockReturnValue({
      ...baseStatus,
      retryCount: 3,
    });
    render(<InitOverlay />);
    expect(screen.getByText('Switch to WebGL2 Mode')).not.toBeNull();
  });

  it('clicking Switch to WebGL2 calls setPreferredBackend with webgl2 (PF-845)', () => {
    // Mock window.location.reload so it does not throw in jsdom
    const reloadMock = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload: reloadMock },
    });

    vi.mocked(useEngineStatus).mockReturnValue({
      ...baseStatus,
      retryCount: 3,
    });
    render(<InitOverlay />);
    fireEvent.click(screen.getByText('Switch to WebGL2 Mode'));
    expect(vi.mocked(setPreferredBackend)).toHaveBeenCalledWith('webgl2');
    expect(reloadMock).toHaveBeenCalled();
  });

  it('shows WebGL2 fallback button when error causes immediate failed state (PF-845)', () => {
    vi.mocked(useEngineStatus).mockReturnValue({
      ...baseStatus,
      error: 'WebGPU adapter not available',
      canRetry: false,
      isTimedOut: false,
    });
    render(<InitOverlay />);
    // showFailedState = retryCount>=3 || (!canRetry && (isTimedOut || error))
    // here: !canRetry=true, error is truthy → showFailedState=true
    expect(screen.getByText('Switch to WebGL2 Mode')).not.toBeNull();
  });
});
