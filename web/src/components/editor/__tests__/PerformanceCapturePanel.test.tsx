/**
 * Manual controls for the timed performance capture (#9904 / #10013,
 * operation performance.FR-3.OP-01). Runs against the REAL store and the REAL
 * `editorCapture` functions (only the browser/engine environment is faked), so
 * a parity assertion here compares the text the AI tool would receive with the
 * text the creator sees.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, fireEvent, cleanup, within } from '@/test/utils/componentTestUtils';
import {
  PRIMITIVE_ATTR,
  controlsIn,
  expectedPrimitive,
  findColourLiterals,
  findRawControls,
  hasMobileTouchTarget,
} from '@/test/utils/designSystemAudit';
import { PerformanceCapturePanel } from '../PerformanceCapturePanel';
import { usePerformanceStore, IDLE_TIMED_CAPTURE } from '@/stores/performanceStore';
import {
  cancelPerformanceCapture,
  resetCaptureEnvironment,
  setCaptureEnvironment,
  startPerformanceCapture,
  type CaptureEnvironment,
} from '@/lib/perf/editorCapture';
import { buildPerformanceReport, type PerformanceReport } from '@/lib/perf/performanceReport';
import { performanceHandlers } from '@/lib/chat/handlers/performanceHandlers';
import { UNKNOWN } from '@/lib/config/measurementManifest';

vi.mock('@/hooks/useEngine', () => ({
  getActiveEngineBackend: vi.fn(() => 'webgpu'),
  getEngineReadyMs: vi.fn(() => 'unknown'),
  getEngineWasmMemory: vi.fn(() => null),
}));

// The REAL library components, each marking the element it renders so a test
// can tell a library <Button> from a raw <button> styled to look like one.
vi.mock('@spawnforge/ui', async (importOriginal) =>
  (await import('@/test/utils/designSystemAudit')).tagUiPrimitives(await importOriginal()),
);

const env: CaptureEnvironment = {
  requestFrame: () => 1,
  cancelFrame: () => undefined,
  isHidden: () => false,
  onVisibilityChange: () => () => undefined,
  onSceneChange: () => () => undefined,
  backend: () => 'webgpu',
  engineReadyMs: () => UNKNOWN,
  readSceneChecksum: () => new Promise(() => undefined),
  wasmMemory: () => undefined,
  performanceMemory: () => undefined,
  resourceEntries: () => [],
  navigator: () => undefined,
  window: () => undefined,
  now: () => new Date('2026-09-22T12:00:00.000Z'),
};

function report(
  id: string,
  browserVersion: string,
  intervalMs = 10,
  cacheState: 'warm' | 'cold' | typeof UNKNOWN = 'warm',
): PerformanceReport {
  return buildPerformanceReport({
    raw: {
      captureProtocolVersion: 1,
      source: 'editor',
      protocol: { warmupMs: 10_000, captureMs: 60_000 },
      frameTimestampsMs: Array.from({ length: Math.floor(70_000 / intervalMs) + 1 }, (_, i) => i * intervalMs),
      firstInteractiveMs: 1800,
      firstInteractiveBasis: 'editor-navigation-to-engine-ready',
      hiddenDuringCapture: false,
      memory: { jsHeapUsedMb: 40, jsHeapLimitMb: 4096, wasmLinearMemoryMb: UNKNOWN, jsHeapSource: 'performance.memory', wasmMemorySource: 'unavailable' },
      startedAt: '2026-09-22T11:58:50.000Z',
      completedAt: '2026-09-22T12:00:00.000Z',
    },
    manifest: {
      schemaVersion: 1,
      buildSha: 'abc1234',
      fixtureChecksum: '5e285ced',
      os: 'Windows',
      browserVersion,
      gpuDriver: 'nvidia turing',
      backend: 'webgpu',
      viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
      deviceMemory: 8,
      cacheState,
      sampleCount: UNKNOWN,
    },
    profileKey: 'desktop@1',
    reportId: id,
    now: () => new Date('2026-09-22T12:00:01.000Z'),
  });
}

beforeEach(() => {
  localStorage.clear();
  setCaptureEnvironment(env);
  usePerformanceStore.setState({
    timedCapture: { ...IDLE_TIMED_CAPTURE },
    performanceReports: [],
    baselineReport: null,
    lastComparison: null,
  });
});

afterEach(() => {
  cancelPerformanceCapture();
  resetCaptureEnvironment();
  cleanup();
});

describe('PerformanceCapturePanel', () => {
  it('labels every control', () => {
    render(<PerformanceCapturePanel />);
    for (const name of ['Warm-up (s)', 'Capture (s)', 'Device profile', 'Cache state']) {
      expect(screen.getByLabelText(name)).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Run capture' })).toBeInTheDocument();
  });

  it('shows the exact validation error the AI tool returns for the same input (parity)', async () => {
    render(<PerformanceCapturePanel />);
    fireEvent.change(screen.getByLabelText('Capture (s)'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run capture' }));
    const shown = screen.getByRole('alert').textContent;

    const viaAi = await performanceHandlers.capture_performance_report(
      { warmupSeconds: 10, captureSeconds: 1, profileId: 'desktop@1' },
      { store: {} as never, dispatchCommand: vi.fn() },
    );
    expect(viaAi.success).toBe(false);
    expect(shown).toBe(viaAi.error);
    expect(shown).toBe('Invalid arguments: captureSeconds: Too small: expected number to be >=5');
  });

  it('passes a fractional entry to the validator instead of silently rounding it', () => {
    const expected = startPerformanceCapture({ warmupSeconds: 10, captureSeconds: 0.5, profileId: 'desktop@1' });
    expect(expected.ok).toBe(false);
    render(<PerformanceCapturePanel />);
    fireEvent.change(screen.getByLabelText('Capture (s)'), { target: { value: '0.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run capture' }));
    expect(screen.getByRole('alert').textContent).toBe(expected.ok ? 'unexpected success' : expected.error);
  });

  it('starts a capture, shows progress, and offers Cancel', () => {
    render(<PerformanceCapturePanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Run capture' }));
    expect(usePerformanceStore.getState().timedCapture.status).toBe('running');
    expect(screen.getByRole('progressbar', { name: 'Capture progress' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel capture' }));
    expect(usePerformanceStore.getState().timedCapture.status).toBe('cancelled');
    expect(screen.getByText('Capture cancelled.')).toBeInTheDocument();
  });

  it('shows the latest report: verdict, percentiles, first interactive, memory and budgets', () => {
    usePerformanceStore.getState().addPerformanceReport(report('perf-a', 'Chrome 153.0.8010.53'));
    render(<PerformanceCapturePanel />);
    const panel = screen.getByLabelText('Latest performance report');
    expect(panel.textContent).toContain('Verdictpass');
    expect(panel.textContent).toContain('perf-3d@1 (5e285ced)');
    expect(panel.textContent).toContain('10 ms / 10 ms / 10 ms');
    expect(panel.textContent).toContain('First interactive1800 ms');
    expect(panel.textContent).toContain('40 MB / unknown');
    const budgets = within(screen.getByLabelText('Budgets'));
    expect(budgets.getByText('frame-time-p95').nextSibling?.textContent).toBe('pass (10 / 16.7 ms)');
    expect(budgets.getByText('first-interactive-cold').nextSibling?.textContent).toBe('not_applicable (1800 / 5000 ms)');
  });

  it('downloads the full report — manifest, raw samples and aggregates — as JSON', async () => {
    const r = report('perf-a', 'Chrome 153.0.8010.53');
    usePerformanceStore.getState().addPerformanceReport(r);
    let blob: Blob | null = null;
    const createObjectURL = vi.fn((b: Blob) => {
      blob = b;
      return 'blob:report';
    });
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    try {
      render(<PerformanceCapturePanel />);
      fireEvent.click(screen.getByRole('button', { name: 'Download report (JSON)' }));
      expect(click).toHaveBeenCalledTimes(1);
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:report');
      const downloaded = JSON.parse(await blob!.text()) as PerformanceReport;
      expect(downloaded.manifest).toEqual(r.manifest);
      expect(downloaded.samples.frameTimesMs).toHaveLength(6000);
      expect(downloaded.aggregates).toEqual(r.aggregates);
    } finally {
      click.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('pins and unpins the baseline, and flags an incompatible comparison without claiming an improvement', () => {
    const store = usePerformanceStore.getState();
    store.addPerformanceReport(report('perf-old', 'Chrome 152.0.7990.10', 15));
    render(<PerformanceCapturePanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Pin as baseline' }));
    expect(usePerformanceStore.getState().baselineReport?.reportId).toBe('perf-old');
    expect(screen.getByRole('button', { name: 'Unpin baseline' })).toBeInTheDocument();

    // A newer, faster run on a different browser version.
    usePerformanceStore.getState().addPerformanceReport(report('perf-new', 'Chrome 153.0.8010.53', 10));
    fireEvent.click(screen.getByRole('button', { name: 'Compare with baseline' }));
    const cmp = screen.getByLabelText('Baseline comparison').textContent;
    expect(cmp).toContain('Incompatible baseline');
    expect(cmp).toContain('browserVersion (Chrome 153.0.8010.53 vs Chrome 152.0.7990.10)');
    expect(cmp).not.toMatch(/improved/);
  });

  it('shows "No baseline is pinned" when comparing with nothing pinned', () => {
    usePerformanceStore.getState().addPerformanceReport(report('perf-a', 'Chrome 153.0.8010.53'));
    render(<PerformanceCapturePanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Compare with baseline' }));
    expect(screen.getByRole('alert').textContent).toMatch(/No baseline is pinned/);
  });
});

/**
 * #9904 board round 1 (ux): the panel was built from raw <input>/<select>/
 * <button> elements, a hand-rolled progress bar and fixed Tailwind palette
 * colours, so it bypassed @spawnforge/ui and could not follow the seven themes.
 */
describe('PerformanceCapturePanel design system', () => {
  const SOURCE = readFileSync(resolve(__dirname, '../PerformanceCapturePanel.tsx'), 'utf-8');

  /** The idle panel with a report, then the running panel, then an error: every control state. */
  function renderEveryControlState() {
    usePerformanceStore.getState().addPerformanceReport(report('perf-a', 'Chrome 153.0.8010.53'));
    const { container } = render(<PerformanceCapturePanel />);
    const idle = controlsIn(container);
    fireEvent.click(screen.getByRole('button', { name: 'Compare with baseline' }));
    const alert = screen.getByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Run capture' }));
    const running = controlsIn(container);
    return { container, idle, running, alert };
  }

  it('renders every control through the @spawnforge/ui primitives', () => {
    const { container, idle, running, alert } = renderEveryControlState();

    // Name each control so a failure says which one.
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- test helper: a blank aria-label falls back to element text content for naming a control
    const nameOf = (el: HTMLElement) => el.getAttribute('aria-label') || el.textContent?.trim() || el.tagName.toLowerCase();
    const primitiveOf = (el: HTMLElement) => `${nameOf(el)}: ${el.getAttribute(PRIMITIVE_ATTR)}`;
    const expected = (el: HTMLElement) => `${nameOf(el)}: ${expectedPrimitive(el)}`;

    // 2 number inputs, 2 selects, Run + Download + Pin + Compare.
    expect(idle).toHaveLength(8);
    expect(idle.map(primitiveOf)).toEqual(idle.map(expected));
    // Cancel replaces Run, and the progress bar appears.
    expect(running).toHaveLength(9);
    expect(running.map(primitiveOf)).toEqual(running.map(expected));
    expect(running.filter((el) => el.getAttribute('role') === 'progressbar')).toHaveLength(1);

    // Field labels and the error notice come from the library too.
    const labels = Array.from(container.querySelectorAll('label'));
    expect(labels.map((l) => `${l.textContent}: ${l.getAttribute(PRIMITIVE_ATTR)}`)).toEqual([
      'Warm-up (s): Label',
      'Capture (s): Label',
      'Device profile: Label',
      'Cache state: Label',
    ]);
    expect(alert.getAttribute(PRIMITIVE_ATTR)).toBe('InlineAlert');
  });

  it('gives every control a 44px touch target below the sm breakpoint', () => {
    const { idle, running } = renderEveryControlState();
    const interactive = [...idle, ...running].filter((el) => el.getAttribute('role') !== 'progressbar');
    expect(interactive.length).toBeGreaterThan(0);
    const short = interactive
      .filter((el) => !hasMobileTouchTarget(el))
      .map((el) => `${el.textContent?.trim() || el.tagName.toLowerCase()}: ${el.className}`);
    expect(short).toEqual([]);
  });

  const STATUS_TOKEN = {
    pass: 'text-[var(--sf-status-healthy-indicator)]',
    fail: 'text-[var(--sf-status-down-indicator)]',
    unknown: 'text-[var(--sf-status-unknown-indicator)]',
    not_applicable: 'text-[var(--sf-text-secondary)]',
  } as const;

  it.each([
    ['pass', report('perf-pass', 'Chrome 153.0.8010.53', 10), { 'frame-time-p95': 'pass', 'first-interactive-cold': 'not_applicable' }],
    ['fail', report('perf-fail', 'Chrome 153.0.8010.53', 20), { 'frame-time-p95': 'fail', 'first-interactive-cold': 'not_applicable' }],
    ['unknown', report('perf-unknown', 'Chrome 153.0.8010.53', 10, UNKNOWN), { 'frame-time-p95': 'pass', 'first-interactive-cold': 'unknown' }],
  ] as const)('colours a %s verdict and its budgets with the per-theme status tokens', (verdict, r, budgetStatuses) => {
    usePerformanceStore.getState().addPerformanceReport(r);
    render(<PerformanceCapturePanel />);
    const verdictEl = screen.getByText('Verdict').nextElementSibling!;
    expect(verdictEl.textContent).toBe(verdict);
    expect(verdictEl.classList).toContain(STATUS_TOKEN[verdict]);

    const budgets = within(screen.getByLabelText('Budgets'));
    for (const [id, status] of Object.entries(budgetStatuses) as Array<[string, keyof typeof STATUS_TOKEN]>) {
      const statusEl = budgets.getByText(id).nextElementSibling!;
      expect(statusEl.textContent?.startsWith(`${status} (`), `${id}: ${statusEl.textContent}`).toBe(true);
      expect(statusEl.classList, `${id}: ${statusEl.className}`).toContain(STATUS_TOKEN[status]);
    }
  });

  it('reports an incompatible baseline in the library warning notice', () => {
    usePerformanceStore.getState().addPerformanceReport(report('perf-old', 'Chrome 152.0.7990.10', 15));
    render(<PerformanceCapturePanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Pin as baseline' }));
    usePerformanceStore.getState().addPerformanceReport(report('perf-new', 'Chrome 153.0.8010.53', 10));
    fireEvent.click(screen.getByRole('button', { name: 'Compare with baseline' }));
    const notice = within(screen.getByLabelText('Baseline comparison')).getByRole('status');
    expect(notice.getAttribute(PRIMITIVE_ATTR)).toBe('InlineAlert');
    expect(notice.textContent).toContain('Incompatible baseline — no improvement or regression is claimed');
  });

  // A DOM walk only covers rendered branches; the source scan covers all of them.
  it('names every colour through a var(--sf-*) token, in every branch', () => {
    expect(findColourLiterals(SOURCE)).toEqual([]);
  });

  it('renders no raw form control where a library primitive exists', () => {
    expect(findRawControls(SOURCE)).toEqual([]);
  });
});
