/**
 * Render tests for PerformanceProfiler component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, fireEvent, cleanup, waitFor } from '@/test/utils/componentTestUtils';
import {
  PRIMITIVE_ATTR,
  controlsIn,
  expectedPrimitive,
  findColourLiterals,
  findRawControls,
  hasMobileTouchTarget,
} from '@/test/utils/designSystemAudit';
import { PerformanceProfiler } from '../PerformanceProfiler';
import { usePerformanceStore } from '@/stores/performanceStore';
import type { MeasurementManifest } from '@/lib/config/measurementManifest';
import { getActiveEngineBackend } from '@/hooks/useEngine';

vi.mock('@/hooks/useEngine', () => ({
  getActiveEngineBackend: vi.fn(() => 'webgl2'),
  getWasmModule: vi.fn(() => null),
}));

vi.mock('@/stores/performanceStore', () => ({
  usePerformanceStore: vi.fn(() => ({})),
}));

// The REAL library components, each marking the element it renders.
vi.mock('@spawnforge/ui', async (importOriginal) =>
  (await import('@/test/utils/designSystemAudit')).tagUiPrimitives(await importOriginal()),
);

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

const unknownSystemCosts = [
  { group: 'entitySync', label: 'Entity sync', totalMs: 'unknown' as const },
  { group: 'transformApply', label: 'Transform apply', totalMs: 'unknown' as const },
  { group: 'physics', label: 'Physics', totalMs: 'unknown' as const },
  { group: 'rendering', label: 'Rendering', totalMs: 'unknown' as const },
];

describe('PerformanceProfiler', () => {
  const mockSetProfilerOpen = vi.fn();
  const mockUpdateStats = vi.fn();
  const mockCaptureReport = vi.fn();
  const mockStartSystemCapture = vi.fn();
  const mockStopSystemCapture = vi.fn();

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
    captureActive = false,
    systemCosts = unknownSystemCosts as Array<{ group: string; label: string; totalMs: number | 'unknown' }>,
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
      captureActive,
      systemCosts,
      startSystemCapture: mockStartSystemCapture,
      stopSystemCapture: mockStopSystemCapture,
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

  it('shows the engine mesh memory when expanded', () => {
    setupStore({ isProfilerOpen: true, stats: { ...defaultStats, memoryUsage: 64.3 } });
    render(<PerformanceProfiler />);
    const row = screen.getByText('Mesh memory').parentElement!;
    expect(row.textContent).toContain('64.3 MB');
  });

  // #10013: a missing measurement must read "unknown", never "0.0 MB".
  it('shows mesh memory and JS heap as unknown until measured', () => {
    setupStore({ isProfilerOpen: true, stats: { ...defaultStats, memoryUsage: 'unknown', jsHeapMb: 'unknown' } as never });
    render(<PerformanceProfiler />);
    expect(screen.getByText('Mesh memory').parentElement!.textContent).toBe('Mesh memoryunknown');
    expect(screen.getByText('JS heap').parentElement!.textContent).toBe('JS heapunknown');
    expect(screen.queryByText(/0\.0 MB/)).toBeNull();
  });

  it('shows the JS heap when the browser measures it', () => {
    setupStore({ isProfilerOpen: true, stats: { ...defaultStats, jsHeapMb: 42.5 } as never });
    render(<PerformanceProfiler />);
    expect(screen.getByText('JS heap').parentElement!.textContent).toContain('42.5 MB');
  });

  it('reports the JS heap as unknown — not 0 MB — where performance.memory does not exist (#10013)', () => {
    // jsdom, like Firefox and Safari, has no performance.memory.
    expect((performance as unknown as { memory?: unknown }).memory).toBeUndefined();
    setupStore({ isProfilerOpen: true });
    render(<PerformanceProfiler />);
    vi.advanceTimersByTime(1100);
    expect(mockUpdateStats).toHaveBeenCalled();
    const update = mockUpdateStats.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(update.jsHeapMb).toBe('unknown');
    // And the profiler no longer overwrites the engine's mesh-memory figure.
    expect(update).not.toHaveProperty('memoryUsage');
  });

  it('reports the measured JS heap in MB where performance.memory exists', () => {
    const perf = performance as unknown as { memory?: unknown };
    perf.memory = { usedJSHeapSize: 50 * 1024 * 1024, jsHeapSizeLimit: 4096 * 1024 * 1024 };
    try {
      setupStore({ isProfilerOpen: true });
      render(<PerformanceProfiler />);
      vi.advanceTimersByTime(1100);
      const update = mockUpdateStats.mock.calls.at(-1)![0] as Record<string, unknown>;
      expect(update.jsHeapMb).toBe(50);
    } finally {
      delete perf.memory;
    }
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

  // Top costly systems panel — operation performance.FR-1.OP-01 / OP-04 (#9880)
  describe('top costly systems (performance.FR-1.OP-01 / OP-04)', () => {
    it('renders the panel with every group label when expanded', () => {
      setupStore({ isProfilerOpen: true });
      render(<PerformanceProfiler />);
      const panel = screen.getByLabelText('Top costly systems');
      expect(panel).toBeInTheDocument();
      expect(panel.textContent).toContain('Entity sync');
      expect(panel.textContent).toContain('Transform apply');
      expect(panel.textContent).toContain('Physics');
      expect(panel.textContent).toContain('Rendering');
      // The over-claiming labels must not reappear (#9880 review round 1).
      expect(panel.textContent).not.toContain('Scripting');
      expect(panel.textContent).not.toContain('Bridge');
    });

    it('shows an unmeasured group as "unknown", never as 0', () => {
      // Physics measured; rendering unavailable this slice (OP-02).
      setupStore({
        isProfilerOpen: true,
        systemCosts: [
          { group: 'physics', label: 'Physics', totalMs: 12.5 },
          { group: 'rendering', label: 'Rendering', totalMs: 'unknown' },
        ],
      });
      render(<PerformanceProfiler />);
      const panel = screen.getByLabelText('Top costly systems');
      expect(panel.textContent).toContain('12.50 ms');
      expect(panel.textContent).toContain('unknown');
      // The unavailable group must not read as a real, cheap 0.
      expect(panel.textContent).not.toContain('0.00 ms');
    });

    it('renders a measured zero distinctly from unavailable', () => {
      setupStore({
        isProfilerOpen: true,
        systemCosts: [
          { group: 'transformApply', label: 'Transform apply', totalMs: 0 },
          { group: 'rendering', label: 'Rendering', totalMs: 'unknown' },
        ],
      });
      render(<PerformanceProfiler />);
      const panel = screen.getByLabelText('Top costly systems');
      // A measured, effectively-free group is 0.00 ms; the unmeasured one is unknown.
      expect(panel.textContent).toContain('0.00 ms');
      expect(panel.textContent).toContain('unknown');
    });

    it('arms a capture session when Capture systems is clicked', () => {
      setupStore({ isProfilerOpen: true, captureActive: false });
      render(<PerformanceProfiler />);
      const btn = screen.getByRole('button', { name: 'Capture systems' });
      expect(btn.getAttribute('aria-pressed')).toBe('false');
      fireEvent.click(btn);
      expect(mockStartSystemCapture).toHaveBeenCalledTimes(1);
      expect(mockStopSystemCapture).not.toHaveBeenCalled();
    });

    it('stops the session when active and Stop capture is clicked', () => {
      setupStore({ isProfilerOpen: true, captureActive: true });
      render(<PerformanceProfiler />);
      const btn = screen.getByRole('button', { name: 'Stop capture' });
      expect(btn.getAttribute('aria-pressed')).toBe('true');
      fireEvent.click(btn);
      expect(mockStopSystemCapture).toHaveBeenCalledTimes(1);
      expect(mockStartSystemCapture).not.toHaveBeenCalled();
    });

    it('does not render the panel when collapsed', () => {
      setupStore({ isProfilerOpen: false });
      render(<PerformanceProfiler />);
      expect(screen.queryByLabelText('Top costly systems')).not.toBeInTheDocument();
    });
  });

  /**
   * #9904 board round 1 (ux). The timed-capture panel this PR nests here was
   * moved onto --sf-* tokens and library primitives. Its tokens are only
   * readable on a THEMED background: left on this host's fixed gray-900, the
   * light theme would put #52525b secondary text on #111827. So the host
   * paints the token surface its children's contrast pins are graded against
   * (packages/ui/src/tokens/__tests__/themes.test.ts), and follows the same
   * rules itself.
   */
  describe('design system', () => {
    const SOURCE = readFileSync(resolve(__dirname, '../PerformanceProfiler.tsx'), 'utf-8');

    it.each([false, true])('paints the opaque theme surface and text colour (expanded: %s)', (isProfilerOpen) => {
      setupStore({ isProfilerOpen });
      const { container } = render(<PerformanceProfiler />);
      const root = container.firstElementChild!;
      expect(root.classList).toContain('bg-[var(--sf-bg-surface)]');
      expect(root.classList).toContain('text-[var(--sf-text)]');
    });

    it.each([
      [false, 1],
      // Toggle, triangle + draw-call bars, Capture systems, Capture report,
      // and the nested capture panel's 2 inputs, 2 selects and Run capture.
      [true, 10],
    ])('renders every control through the library, with a 44px touch target (expanded: %s)', (isProfilerOpen, count) => {
      setupStore({ isProfilerOpen, warnings: ['Low FPS'] });
      const { container } = render(<PerformanceProfiler />);
      const controls = controlsIn(container);
      expect(controls).toHaveLength(count);
      const nameOf = (el: HTMLElement) => el.getAttribute('aria-label') || el.textContent?.trim() || el.tagName.toLowerCase();
      expect(controls.map((el) => `${nameOf(el)}: ${el.getAttribute(PRIMITIVE_ATTR)}`)).toEqual(
        controls.map((el) => `${nameOf(el)}: ${expectedPrimitive(el)}`),
      );
      const short = controls
        .filter((el) => el.getAttribute('role') !== 'progressbar' && !hasMobileTouchTarget(el))
        .map((el) => `${nameOf(el)}: ${el.className}`);
      expect(short).toEqual([]);
    });

    it.each([
      [5_000, 'healthy'], // 1% of the triangle budget
      [350_000, 'degraded'], // 70%: past the 60% caution line
      [450_000, 'down'], // 90%: past the 80% warning threshold
    ])('fills a %i-triangle budget bar with the %s status token', (triangleCount, status) => {
      setupStore({ isProfilerOpen: true, stats: { ...defaultStats, triangleCount } });
      render(<PerformanceProfiler />);
      const bar = screen.getByRole('progressbar', { name: 'Triangle budget usage' });
      expect(bar.getAttribute(PRIMITIVE_ATTR)).toBe('Progress');
      expect(bar.style.getPropertyValue('--sf-accent')).toBe(`var(--sf-status-${status}-indicator)`);
    });

    it.each([
      [60, 'healthy'],
      [30, 'down'],
    ])('colours %i FPS, its readouts and its sparkline with the %s status token', (fps, status) => {
      const token = `var(--sf-status-${status}-indicator)`;
      setupStore({ isProfilerOpen: false, stats: { ...defaultStats, fps } });
      const { unmount } = render(<PerformanceProfiler />);
      expect(screen.getByText(`${fps} FPS`).classList).toContain(`text-[${token}]`);
      unmount();

      setupStore({ isProfilerOpen: true, stats: { ...defaultStats, fps }, history: [{ fps }, { fps }] });
      const { container } = render(<PerformanceProfiler />);
      expect(screen.getByText('FPS').nextElementSibling!.classList).toContain(`text-[${token}]`);
      expect(container.querySelector('polyline')!.classList).toContain(`stroke-[${token}]`);
    });

    it('lists warnings in the library warning notice', () => {
      setupStore({ isProfilerOpen: true, warnings: ['High triangle count', 'Low FPS'] });
      render(<PerformanceProfiler />);
      const notice = screen.getByLabelText('Performance warnings');
      expect(notice.getAttribute(PRIMITIVE_ATTR)).toBe('InlineAlert');
      expect(notice.textContent).toBe('High triangle countLow FPS');
    });

    // A DOM walk only covers rendered branches; the source scan covers all of them.
    it('names every colour through a var(--sf-*) token, in every branch', () => {
      expect(findColourLiterals(SOURCE)).toEqual([]);
    });

    it('renders no raw form control where a library primitive exists', () => {
      expect(findRawControls(SOURCE)).toEqual([]);
    });
  });
});
