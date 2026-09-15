/**
 * Render tests for PerformanceProfiler component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@/test/utils/componentTestUtils';
import { PerformanceProfiler } from '../PerformanceProfiler';
import { usePerformanceStore } from '@/stores/performanceStore';
import type { MeasurementManifest } from '@/lib/config/measurementManifest';
import { getActiveEngineBackend } from '@/hooks/useEngine';

vi.mock('@/hooks/useEngine', () => ({
  getActiveEngineBackend: vi.fn(() => 'webgl2'),
}));

vi.mock('@/stores/performanceStore', () => ({
  usePerformanceStore: vi.fn(() => ({})),
}));

vi.mock('lucide-react', () => ({
  ChevronDown: (props: Record<string, unknown>) => <span data-testid="chevron-down" {...props} />,
  ChevronUp: (props: Record<string, unknown>) => <span data-testid="chevron-up" {...props} />,
  AlertTriangle: (props: Record<string, unknown>) => <span data-testid="alert-triangle" {...props} />,
}));

const defaultStats = {
  fps: 60,
  frameTime: 16.7,
  triangleCount: 5000,
  drawCalls: 10,
  entityCount: 20,
  memoryUsage: 128.5,
};

const defaultBudget = {
  targetFps: 60,
  maxTriangles: 500000,
  maxDrawCalls: 100,
  warningThreshold: 0.8,
};

const sampleManifest: MeasurementManifest = {
  schemaVersion: 1,
  buildSha: 'abc12345',
  fixtureChecksum: 'deadbeef',
  os: 'macOS',
  browserVersion: 'Chrome 140',
  gpuDriver: 'unknown',
  backend: 'webgpu',
  viewport: { width: 1920, height: 1080, devicePixelRatio: 2 },
  deviceMemory: 8,
  cacheState: 'cold',
  sampleCount: 5,
};

describe('PerformanceProfiler', () => {
  const mockSetProfilerOpen = vi.fn();
  const mockUpdateStats = vi.fn();
  const mockCaptureReport = vi.fn();

  function setupStore({
    isProfilerOpen = false,
    stats = defaultStats,
    budget = defaultBudget,
    history = [] as { fps: number }[],
    warnings = [] as string[],
    capturedReport = null as null | {
      stats: typeof defaultStats;
      manifest: MeasurementManifest;
      capturedAt: number;
    },
  } = {}) {
    vi.mocked(usePerformanceStore).mockReturnValue({
      stats,
      isProfilerOpen,
      history,
      budget,
      warnings,
      setProfilerOpen: mockSetProfilerOpen,
      updateStats: mockUpdateStats,
      captureReport: mockCaptureReport,
      capturedReport,
    });
    // getState is used nowhere in the component's render path, but guard it so
    // any future use in this suite does not throw against the mocked module.
    (usePerformanceStore as unknown as { getState: () => unknown }).getState = () => ({ stats });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renders Performance heading', () => {
    setupStore();
    render(<PerformanceProfiler />);
    expect(screen.getByText('Performance')).toBeInTheDocument();
  });

  it('shows FPS in collapsed view', () => {
    setupStore({ isProfilerOpen: false, stats: { ...defaultStats, fps: 55 } });
    render(<PerformanceProfiler />);
    expect(screen.getByText('55 FPS')).toBeInTheDocument();
  });

  it('shows triangle count in collapsed view', () => {
    setupStore({ isProfilerOpen: false });
    render(<PerformanceProfiler />);
    expect(screen.getByText(/tris/)).toBeInTheDocument();
  });

  it('calls setProfilerOpen when toggle button is clicked', () => {
    setupStore({ isProfilerOpen: false });
    render(<PerformanceProfiler />);
    fireEvent.click(screen.getByRole('button'));
    expect(mockSetProfilerOpen).toHaveBeenCalledWith(true);
  });

  it('shows expanded stats when isProfilerOpen is true', () => {
    setupStore({ isProfilerOpen: true });
    render(<PerformanceProfiler />);
    expect(screen.getByText('Frame Time')).toBeInTheDocument();
    expect(screen.getByText('Triangles')).toBeInTheDocument();
    expect(screen.getByText('Draw Calls')).toBeInTheDocument();
  });

  it('shows entity count when expanded', () => {
    setupStore({ isProfilerOpen: true, stats: { ...defaultStats, entityCount: 42 } });
    render(<PerformanceProfiler />);
    expect(screen.getByText('Entities')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('shows memory usage when expanded', () => {
    setupStore({ isProfilerOpen: true, stats: { ...defaultStats, memoryUsage: 64.3 } });
    render(<PerformanceProfiler />);
    expect(screen.getByText('Memory')).toBeInTheDocument();
    expect(screen.getByText(/64\.3 MB/)).toBeInTheDocument();
  });

  it('shows warnings when present', () => {
    setupStore({
      isProfilerOpen: true,
      warnings: ['High triangle count', 'Low FPS'],
    });
    render(<PerformanceProfiler />);
    expect(screen.getByText('High triangle count')).toBeInTheDocument();
    expect(screen.getByText('Low FPS')).toBeInTheDocument();
  });

  it('shows alert icon when warnings exist', () => {
    setupStore({
      isProfilerOpen: false,
      warnings: ['High triangle count'],
    });
    render(<PerformanceProfiler />);
    expect(screen.getByTestId('alert-triangle')).toBeInTheDocument();
  });

  it('aria-expanded is false when collapsed', () => {
    setupStore({ isProfilerOpen: false });
    render(<PerformanceProfiler />);
    const button = screen.getByRole('button');
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('aria-expanded is true when expanded', () => {
    setupStore({ isProfilerOpen: true });
    render(<PerformanceProfiler />);
    // Target the toggle specifically — the expanded view also has a Capture button.
    const button = screen.getByRole('button', { name: /performance panel/i });
    expect(button.getAttribute('aria-expanded')).toBe('true');
  });

  // Manual capture + manifest display — operation performance.FR-3.OP-01 (#9904)
  describe('manual capture (performance.FR-3.OP-01)', () => {
    it('renders a Capture report button when expanded', () => {
      setupStore({ isProfilerOpen: true });
      render(<PerformanceProfiler />);
      expect(screen.getByRole('button', { name: 'Capture report' })).toBeInTheDocument();
    });

    it('does not render the Capture button when collapsed', () => {
      setupStore({ isProfilerOpen: false });
      render(<PerformanceProfiler />);
      expect(screen.queryByRole('button', { name: 'Capture report' })).not.toBeInTheDocument();
    });

    it('invokes captureReport with a manifest when the button is clicked', async () => {
      vi.useRealTimers(); // handleCapture awaits async backend detection
      setupStore({ isProfilerOpen: true, history: [{ fps: 60 }, { fps: 59 }] });
      render(<PerformanceProfiler />);

      fireEvent.click(screen.getByRole('button', { name: 'Capture report' }));

      await waitFor(() => expect(mockCaptureReport).toHaveBeenCalledTimes(1));
      const report = mockCaptureReport.mock.calls[0][0];
      expect(report.manifest.schemaVersion).toBe(1);
      expect(report.manifest.sampleCount).toBe(2); // history length
      expect(report.manifest.backend).toBe('webgl2');
      expect(typeof report.capturedAt).toBe('number');
    });

    it('reports the active WebGL2 fallback even when WebGPU is available', async () => {
      vi.useRealTimers();
      vi.mocked(getActiveEngineBackend).mockReturnValue('webgl2');
      const requestAdapter = vi.fn(async () => ({}));
      vi.stubGlobal('navigator', { gpu: { requestAdapter } });
      try {
        setupStore({ isProfilerOpen: true });
        render(<PerformanceProfiler />);
        fireEvent.click(screen.getByRole('button', { name: 'Capture report' }));
        await waitFor(() => expect(mockCaptureReport).toHaveBeenCalledTimes(1));
        expect(mockCaptureReport.mock.calls[0][0].manifest.backend).toBe('webgl2');
        expect(requestAdapter).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('renders captured manifest fields, showing unsupported metrics as "unknown" not zero', () => {
      const unknownManifest = {
        ...sampleManifest,
        deviceMemory: 'unknown' as const,
        gpuDriver: 'unknown' as const,
        backend: 'unknown' as const,
      };
      setupStore({
        isProfilerOpen: true,
        capturedReport: { stats: defaultStats, manifest: unknownManifest, capturedAt: 1 },
      });
      render(<PerformanceProfiler />);

      const panel = screen.getByLabelText('Captured measurement manifest');
      expect(panel).toBeInTheDocument();
      // Unsupported metrics render literally as "unknown", never as 0.
      expect(panel.textContent).toContain('unknown');
      expect(panel.textContent).not.toMatch(/Device memory \(GB\)\s*0/);
      // Supported fields still render their real values.
      expect(panel.textContent).toContain('Chrome 140');
      expect(panel.textContent).toContain('1920×1080');
    });
  });
});
