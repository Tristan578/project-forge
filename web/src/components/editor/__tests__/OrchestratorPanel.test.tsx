/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@/test/utils/componentTestUtils';
import { OrchestratorPanel } from '../OrchestratorPanel';
import { useEditorStore } from '@/stores/editorStore';
import type { OrchestratorPlan } from '@/lib/game-creation/types';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockResolveGate = vi.fn();
const mockCancelPipeline = vi.fn();
const mockRunPipelineFromPlan = vi.fn();
const mockResetOrchestrator = vi.fn();

function makeState(overrides: Record<string, unknown> = {}) {
  return {
    orchestratorStatus: 'idle',
    currentPlan: null,
    currentStepIndex: 0,
    stepStatuses: {},
    pendingGate: null,
    tokenEstimate: null,
    orchestratorError: null,
    orchestratorWarnings: [],
    resolveGate: mockResolveGate,
    cancelPipeline: mockCancelPipeline,
    runPipelineFromPlan: mockRunPipelineFromPlan,
    resetOrchestrator: mockResetOrchestrator,
    ...overrides,
  };
}

function mockStore(overrides: Record<string, unknown> = {}) {
  const state = makeState(overrides);
  // The real hook is generic over its selector; the module mock declares it as
  // a zero-arg `vi.fn()`, so the selector-taking implementation is not
  // assignable to that narrower signature. Widen the MOCK rather than reaching
  // for `any` on the selector (PF-1229 finding #7).
  (
    vi.mocked(useEditorStore) as unknown as {
      mockImplementation: (impl: (selector: (s: unknown) => unknown) => unknown) => void;
    }
  ).mockImplementation(selector => selector(state));
}

const MOCK_PLAN = {
  id: 'plan-1',
  projectId: 'proj-1',
  prompt: 'make a platformer',
  gdd: {
    id: 'gdd-1',
    title: 'Jungle Platformer',
    description: 'A platformer in the jungle',
    systems: [],
    scenes: [],
    assetManifest: [],
    estimatedScope: 'small',
    styleDirective: 'default',
    feelDirective: { mood: 'fun', pacing: 'medium', weight: 'medium', referenceGames: [], oneLiner: 'test' },
    constraints: [],
    projectType: '3d',
  },
  steps: [
    { id: 'step-1', executor: 'scene_create', input: {}, dependsOn: [], maxRetries: 1, optional: false, status: 'pending' },
    { id: 'step-2', executor: 'entity_setup', input: {}, dependsOn: ['step-1'], maxRetries: 1, optional: false, status: 'pending' },
    { id: 'step-3', executor: 'auto_polish', input: {}, dependsOn: ['step-2'], maxRetries: 1, optional: true, status: 'pending' },
  ],
  approvalGates: [],
  tokenEstimate: {
    breakdown: [{ category: 'scenes', estimatedTokens: 50, variance: 10 }],
    totalEstimated: 50,
    totalVarianceHigh: 60,
    totalVarianceLow: 40,
    userTier: 'creator',
    sufficientBalance: true,
  },
  status: 'awaiting_approval',
  currentStepIndex: 0,
  createdAt: Date.now(),
};

const MOCK_GATE = {
  id: 'gate-1',
  label: 'Review Plan',
  description: 'Review the plan before building',
  afterStepId: 'step-1',
  status: 'pending',
  displayData: {
    sceneSummaries: [{ name: 'Level 1', entityCount: 5, systemDescriptions: ['movement'] }],
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OrchestratorPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders idle state with placeholder message', () => {
    mockStore({ orchestratorStatus: 'idle', currentPlan: null });
    render(<OrchestratorPanel />);

    expect(screen.getByText('No game creation in progress')).toBeTruthy();
  });

  it('renders game title when plan is set', () => {
    mockStore({
      orchestratorStatus: 'awaiting_approval',
      currentPlan: MOCK_PLAN,
      tokenEstimate: MOCK_PLAN.tokenEstimate,
      stepStatuses: { 'step-1': 'pending', 'step-2': 'pending', 'step-3': 'pending' },
    });
    render(<OrchestratorPanel />);

    expect(screen.getByText('Jungle Platformer')).toBeTruthy();
  });

  it('renders step list from plan', () => {
    mockStore({
      orchestratorStatus: 'executing',
      currentPlan: MOCK_PLAN,
      stepStatuses: { 'step-1': 'completed', 'step-2': 'running', 'step-3': 'pending' },
    });
    render(<OrchestratorPanel />);

    expect(screen.getByText('Creating scene')).toBeTruthy();
    expect(screen.getByText('Setting up entities')).toBeTruthy();
    expect(screen.getByText('Polishing game')).toBeTruthy();
  });

  it('shows optional badge for optional steps', () => {
    mockStore({
      orchestratorStatus: 'executing',
      currentPlan: MOCK_PLAN,
      stepStatuses: { 'step-1': 'pending', 'step-2': 'pending', 'step-3': 'pending' },
    });
    render(<OrchestratorPanel />);

    expect(screen.getByText('optional')).toBeTruthy();
  });

  /**
   * `plan.steps` can carry a hole or an explicit `null` slot — the planner's
   * own tolerance, not something this panel invents. The step list must
   * render the real steps around the gap without throwing
   * (PF-1229 finding #7b).
   */
  it('renders the real steps around a sparse plan slot without throwing', () => {
    const sparsePlan = {
      ...MOCK_PLAN,
      steps: [MOCK_PLAN.steps[0], null, MOCK_PLAN.steps[2]],
    };
    mockStore({
      orchestratorStatus: 'executing',
      currentPlan: sparsePlan as unknown as OrchestratorPlan,
      stepStatuses: { 'step-1': 'completed', 'step-3': 'pending' },
    });

    expect(() => render(<OrchestratorPanel />)).not.toThrow();
    expect(screen.getByText('Creating scene')).toBeTruthy();
    expect(screen.getByText('Polishing game')).toBeTruthy();
  });

  it('renders token cost estimate', () => {
    mockStore({
      orchestratorStatus: 'awaiting_approval',
      currentPlan: MOCK_PLAN,
      tokenEstimate: MOCK_PLAN.tokenEstimate,
      stepStatuses: {},
    });
    render(<OrchestratorPanel />);

    expect(screen.getByText('Estimated token cost')).toBeTruthy();
    // The total is shown in the header row next to "Estimated token cost"
    expect(screen.getByText('scenes')).toBeTruthy();
  });

  it('shows insufficient balance warning', () => {
    mockStore({
      orchestratorStatus: 'awaiting_approval',
      currentPlan: MOCK_PLAN,
      tokenEstimate: { ...MOCK_PLAN.tokenEstimate, sufficientBalance: false },
      stepStatuses: {},
    });
    render(<OrchestratorPanel />);

    expect(screen.getByText('Insufficient token balance')).toBeTruthy();
  });

  /**
   * PF-1229 finding #9: the insufficient-balance row was hardcoded
   * `bg-red-950/50 text-red-300` — dark-theme-only. The row's text is real
   * body copy, so it must clear WCAG AA 4.5:1 and routes through
   * `--sf-text`, same as `ERROR_SURFACE_CLASSES` above; the background
   * reuses the same `--sf-destructive`/10 tint that test already pins.
   */
  it('draws the insufficient balance row with token-based colour, not hardcoded red', () => {
    mockStore({
      orchestratorStatus: 'awaiting_approval',
      currentPlan: MOCK_PLAN,
      tokenEstimate: { ...MOCK_PLAN.tokenEstimate, sufficientBalance: false },
      stepStatuses: {},
    });
    render(<OrchestratorPanel />);

    const row = screen.getByText('Insufficient token balance').closest('div');
    const rowClasses = Array.from(row?.classList ?? []);
    expect(rowClasses.some((c) => /^(bg|text)-red-/.test(c))).toBe(false);
    expect(rowClasses).toContain('bg-[var(--sf-destructive)]/10');
    expect(rowClasses).toContain('text-[var(--sf-text)]');
  });

  it('renders approval gate dialog', () => {
    mockStore({
      orchestratorStatus: 'awaiting_approval',
      currentPlan: MOCK_PLAN,
      pendingGate: MOCK_GATE,
      stepStatuses: {},
    });
    render(<OrchestratorPanel />);

    expect(screen.getByText('Review Plan')).toBeTruthy();
    expect(screen.getByText('Level 1')).toBeTruthy();
  });

  it('approve button calls resolveGate with approved', () => {
    mockStore({
      orchestratorStatus: 'awaiting_approval',
      currentPlan: MOCK_PLAN,
      pendingGate: MOCK_GATE,
      stepStatuses: {},
    });
    render(<OrchestratorPanel />);

    fireEvent.click(screen.getByText('Approve'));
    expect(mockResolveGate).toHaveBeenCalledWith('approved');
  });

  it('cancel button in gate dialog calls resolveGate with rejected', () => {
    mockStore({
      orchestratorStatus: 'awaiting_approval',
      currentPlan: MOCK_PLAN,
      pendingGate: MOCK_GATE,
      stepStatuses: {},
    });
    render(<OrchestratorPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(mockResolveGate).toHaveBeenCalledWith('rejected');
  });

  it('Start Building button calls runPipelineFromPlan', () => {
    mockStore({
      orchestratorStatus: 'awaiting_approval',
      currentPlan: MOCK_PLAN,
      stepStatuses: {},
    });
    render(<OrchestratorPanel />);

    fireEvent.click(screen.getByText('Start Building'));
    expect(mockRunPipelineFromPlan).toHaveBeenCalled();
  });

  it('Cancel button during execution calls cancelPipeline', () => {
    mockStore({
      orchestratorStatus: 'executing',
      currentPlan: MOCK_PLAN,
      stepStatuses: { 'step-1': 'running' },
    });
    render(<OrchestratorPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(mockCancelPipeline).toHaveBeenCalled();
  });

  it('Start Over button after completion calls resetOrchestrator', () => {
    mockStore({
      orchestratorStatus: 'completed',
      currentPlan: MOCK_PLAN,
      stepStatuses: { 'step-1': 'completed', 'step-2': 'completed', 'step-3': 'completed' },
    });
    render(<OrchestratorPanel />);

    fireEvent.click(screen.getByText('Start Over'));
    expect(mockResetOrchestrator).toHaveBeenCalled();
  });

  it('renders error message when present', () => {
    mockStore({
      orchestratorStatus: 'failed',
      currentPlan: MOCK_PLAN,
      orchestratorError: 'LLM call timed out',
      stepStatuses: {},
    });
    render(<OrchestratorPanel />);

    expect(screen.getByText('LLM call timed out')).toBeTruthy();
  });

  it('Start Over button after failure calls resetOrchestrator', () => {
    mockStore({
      orchestratorStatus: 'failed',
      currentPlan: MOCK_PLAN,
      orchestratorError: 'Something broke',
      stepStatuses: {},
    });
    render(<OrchestratorPanel />);

    fireEvent.click(screen.getByText('Start Over'));
    expect(mockResetOrchestrator).toHaveBeenCalled();
  });

  describe('step failure copy', () => {
    /**
     * The executors compose a `userFacingErrorMessage` naming the next action a
     * user can actually take. Until PF-1224 nothing rendered it: a failed step
     * was a red icon and a label, and the remediation copy every executor
     * carries reached no one. `orchestratorError` is a different thing — it is
     * only set when `runPipeline` itself throws.
     */
    const FAILED_PLAN = {
      ...MOCK_PLAN,
      status: 'failed',
      steps: [
        MOCK_PLAN.steps[0],
        {
          ...MOCK_PLAN.steps[1],
          status: 'failed',
          error: {
            code: 'EXCEPTION',
            message: 'toggle_physics rejected',
            userFacingMessage: 'Could not switch physics on for the level.',
            retryable: true,
          },
        },
        MOCK_PLAN.steps[2],
      ],
    };

    it("renders a failed step's userFacingMessage", () => {
      mockStore({
        orchestratorStatus: 'failed',
        currentPlan: FAILED_PLAN,
        stepStatuses: { 'step-2': 'failed' },
      });
      render(<OrchestratorPanel />);

      expect(screen.getByText('Could not switch physics on for the level.')).toBeTruthy();
    });

    it('announces the failure copy to assistive tech', () => {
      mockStore({
        orchestratorStatus: 'failed',
        currentPlan: FAILED_PLAN,
        stepStatuses: { 'step-2': 'failed' },
      });
      render(<OrchestratorPanel />);

      const alerts = screen.getAllByRole('alert');
      const messages = alerts.map((el) => el.textContent);
      expect(messages).toContain('Could not switch physics on for the level.');
    });

    it('renders the internal message nowhere — only the user-facing one', () => {
      mockStore({
        orchestratorStatus: 'failed',
        currentPlan: FAILED_PLAN,
        stepStatuses: { 'step-2': 'failed' },
      });
      render(<OrchestratorPanel />);

      expect(screen.queryByText('toggle_physics rejected')).toBeNull();
    });

    it('renders no alert for a plan whose steps carry no error', () => {
      mockStore({
        orchestratorStatus: 'executing',
        currentPlan: MOCK_PLAN,
        stepStatuses: {},
      });
      render(<OrchestratorPanel />);

      expect(screen.queryAllByRole('alert')).toHaveLength(0);
    });

    /**
     * A step whose retries a CANCEL cut short keeps its last error.
     *
     * `runPipeline`'s `cancelledMidRetry` branch sets the step to 'skipped',
     * writes `step.error` from the last attempt, and puts the PLAN in
     * 'cancelled' — so the panel had a step reading "Cancelled" with a red
     * `role="alert"` under it telling the user something failed and to go fix
     * it in the Inspector, for something they stopped on purpose. Presence of
     * `step.error` is therefore not the render condition; the plan status is
     * what tells a cancel apart from the two skipped-with-error cases that DO
     * deserve the alert.
     */
    const CANCELLED_PLAN = {
      ...MOCK_PLAN,
      status: 'cancelled',
      steps: [
        MOCK_PLAN.steps[0],
        {
          ...MOCK_PLAN.steps[1],
          status: 'skipped',
          error: {
            code: 'EXCEPTION',
            message: 'toggle_physics rejected',
            userFacingMessage: 'Could not switch physics on for the level.',
            retryable: true,
          },
        },
        MOCK_PLAN.steps[2],
      ],
    };

    it('says nothing failed when the user cancelled mid-retry', () => {
      mockStore({
        orchestratorStatus: 'cancelled',
        currentPlan: CANCELLED_PLAN,
        stepStatuses: { 'step-2': 'skipped' },
      });
      render(<OrchestratorPanel />);

      expect(screen.queryByText('Could not switch physics on for the level.')).toBeNull();
      expect(screen.queryAllByRole('alert')).toHaveLength(0);
      // The step is still listed as one the user stopped, not one that vanished.
      expect(screen.getByText('Cancelled')).toBeTruthy();
    });

    /**
     * The other half of the same discriminator: 'skipped' is ALSO how an
     * optional step that exhausted its retries reads, and how a required step
     * that `DEPENDENCY_FAILED` reads. Neither is a cancel, and both have
     * remediation the user needs — so gating on `status === 'failed'` alone
     * would have swapped one silent surface for another.
     */
    it('still renders the copy for a skipped step on a plan that was not cancelled', () => {
      mockStore({
        orchestratorStatus: 'failed',
        currentPlan: { ...CANCELLED_PLAN, status: 'failed' },
        stepStatuses: { 'step-2': 'skipped' },
      });
      render(<OrchestratorPanel />);

      expect(screen.getByText('Could not switch physics on for the level.')).toBeTruthy();
    });

    /**
     * Both failure surfaces are on screen at once here — the plan-level banner
     * and the per-step alert — and they were drawn in two different reds. Two
     * shades of the same message a few pixels apart reads as a rendering bug,
     * not a distinction, so the colour is asserted to be one colour. Geometry
     * is deliberately NOT compared: the banner is a block of body text and the
     * step alert a small annotation, and they should differ there.
     *
     * PF-1229 finding #1: the border/background legitimately use
     * `--sf-destructive` (a non-text 3:1 floor), but the label TEXT was also
     * `--sf-destructive`, which failed WCAG AA's 4.5:1 text floor against its
     * own 10%-alpha tint in several themes. The fix repoints the text to
     * `--sf-text` (see `packages/ui/src/tokens/__tests__/themes.test.ts` for
     * the pinned contrast math), so this test now checks the surface colour
     * (border/bg) and the text colour separately, and pins that the text is
     * no longer `--sf-destructive`.
     */
    it('draws the plan-level and per-step failures in the same red surface with AA-safe text', () => {
      mockStore({
        orchestratorStatus: 'failed',
        currentPlan: FAILED_PLAN,
        orchestratorError: 'Something broke',
        stepStatuses: { 'step-2': 'failed' },
      });
      const { container } = render(<OrchestratorPanel />);

      const banner = screen.getByText('Something broke');
      const stepAlert = screen.getByText('Could not switch physics on for the level.');
      expect(container.contains(banner)).toBe(true);

      const surfaceColourOf = (el: Element) => Array.from(el.classList)
        .filter((c) => /(^|:)(border|bg)-\[var\(--sf-destructive\)\]/.test(c))
        .sort();
      const textColourOf = (el: Element) => Array.from(el.classList)
        .filter((c) => /(^|:)text-\[var\(--sf-(destructive|text)\)\]/.test(c))
        .sort();

      expect(surfaceColourOf(stepAlert)).toEqual(surfaceColourOf(banner));
      // And not vacuously equal because neither carries a red surface at all.
      expect(surfaceColourOf(banner).length).toBeGreaterThan(0);

      expect(textColourOf(stepAlert)).toEqual(textColourOf(banner));
      expect(textColourOf(banner)).toEqual(['text-[var(--sf-text)]']);
    });

    /**
     * PF-1229 finding #9: `StatusBadge`'s `failed` entry and `StepStatusIcon`'s
     * `failed` case were hardcoded `red-900/50`/`text-red-300`/`text-red-400`
     * — a dark-theme-only pairing this panel's other themes (rust, ember,
     * ice, leaf, mech, light) never see. The badge's pill TEXT ("Failed")
     * is real text, so it must clear WCAG AA 4.5:1 and therefore routes
     * through `--sf-text`, same as `ERROR_SURFACE_CLASSES` above — the badge
     * background stays `--sf-destructive` at the same 10%-alpha tint that
     * test already pins. The step icon is a graphical glyph, not text
     * characters, so it only needs WCAG 1.4.11's 3:1 non-text floor and can
     * use `--sf-destructive` directly (pinned as "destructive indicator on
     * surface" in `NONTEXT_PAIRS`, `packages/ui/src/tokens/__tests__/themes.test.ts`).
     */
    it('draws the failed status badge and step icon with token-based colour, not hardcoded red', () => {
      mockStore({
        orchestratorStatus: 'failed',
        currentPlan: FAILED_PLAN,
        stepStatuses: { 'step-2': 'failed' },
      });
      render(<OrchestratorPanel />);

      const badge = screen.getByText('Failed');
      const badgeClasses = Array.from(badge.classList);
      expect(badgeClasses.some((c) => /^(bg|text)-red-/.test(c))).toBe(false);
      expect(badgeClasses).toContain('bg-[var(--sf-destructive)]/10');
      expect(badgeClasses).toContain('text-[var(--sf-text)]');

      const stepRow = screen.getByText('Setting up entities').closest('div');
      const icon = stepRow?.querySelector('svg');
      expect(icon).toBeTruthy();
      const iconClasses = Array.from(icon?.classList ?? []);
      expect(iconClasses.some((c) => /^text-red-/.test(c))).toBe(false);
      expect(iconClasses).toContain('text-[var(--sf-destructive)]');
    });
  });

  describe('step warnings', () => {
    /**
     * A step that only partly applied still gets a green tick, because it did
     * succeed. Its note is the only thing that tells the user their camera will
     * never move — so if this block does not render, the tick is a lie.
     */
    it('renders each note against its step label', () => {
      mockStore({
        orchestratorStatus: 'completed',
        currentPlan: MOCK_PLAN,
        stepStatuses: { 'step-1': 'completed', 'step-2': 'completed', 'step-3': 'completed' },
        orchestratorWarnings: [
          {
            stepId: 'step-2',
            executor: 'camera_setup',
            message: 'Camera set to sideScroller but nothing was given for it to follow.',
          },
          {
            stepId: 'step-3',
            executor: 'auto_polish',
            message: 'Camera settings the engine has no parameter for were ignored: smoothing.',
          },
        ],
      });
      render(<OrchestratorPanel />);

      expect(screen.getByText('2 things need your attention')).toBeTruthy();
      expect(
        screen.getByText('Camera set to sideScroller but nothing was given for it to follow.', {
          exact: false,
        }),
      ).toBeTruthy();
      // The executor name is mapped to the same label the step list shows, not
      // printed raw — `camera_setup` was missing from that map entirely.
      expect(screen.getByText('Positioning camera:')).toBeTruthy();
      expect(screen.getByText('Polishing game:')).toBeTruthy();
    });

    it('singularizes the count for one note', () => {
      mockStore({
        orchestratorStatus: 'completed',
        currentPlan: MOCK_PLAN,
        stepStatuses: {},
        orchestratorWarnings: [
          { stepId: 'step-2', executor: 'camera_setup', message: 'it will not move' },
        ],
      });
      render(<OrchestratorPanel />);

      expect(screen.getByText('1 thing needs your attention')).toBeTruthy();
    });

    /**
     * A plan-level warning (e.g. "no win condition detected") names no step —
     * `orchestratorSlice` folds `currentPlan.warnings` in as bare `{ message }`
     * with no `stepId`/`executor` (PF-1229 finding #6b). It must still be
     * counted in the attention total and render without a step-label prefix
     * (PF-1229 finding #7a).
     */
    it('renders a plan-level warning with no step label prefix, counted in the total', () => {
      mockStore({
        orchestratorStatus: 'completed',
        currentPlan: MOCK_PLAN,
        stepStatuses: { 'step-1': 'completed', 'step-2': 'completed', 'step-3': 'completed' },
        orchestratorWarnings: [
          { message: 'No win condition detected — the game cannot be completed.' },
        ],
      });
      render(<OrchestratorPanel />);

      expect(screen.getByText('1 thing needs your attention')).toBeTruthy();
      expect(
        screen.getByText('No win condition detected — the game cannot be completed.'),
      ).toBeTruthy();
      // No step label ever precedes a plan-level note.
      expect(screen.queryByText(/^.+:$/)).toBeNull();
    });

    it('renders nothing when no step reported a problem', () => {
      mockStore({
        orchestratorStatus: 'completed',
        currentPlan: MOCK_PLAN,
        stepStatuses: {},
        orchestratorWarnings: [],
      });
      render(<OrchestratorPanel />);

      expect(screen.queryByLabelText('Game creation warnings')).toBeNull();
    });
  });

  /**
   * PF-1229 findings #1 and #2.
   *
   * Finding #1 was a live light-theme break. The round-2 migration paired
   * `bg-[var(--sf-destructive)]/10` with `text-[var(--sf-text)]`, but this
   * panel painted no background of its own, and a `/N` Tailwind modifier
   * composites over whatever is actually painted behind it. Every lazy panel
   * is mounted by `WorkspaceProvider`'s `withSuspense` wrapper inside a
   * hardcoded `bg-zinc-900` (#18181b), so the tint blended over #18181b in
   * all seven themes while `packages/ui/.../themes.test.ts` graded it against
   * `--sf-bg-surface`. In the `light` theme `--sf-text` IS #18181b: ~1.06:1,
   * invisible, and the pin passed anyway. The host was deliberately not
   * retokenised (its other panels are dark-only zinc designs), so the panel
   * paints its own opaque token surface instead — which is the fact that
   * makes the contrast pin honest.
   *
   * Finding #2 was the other half: the amber/zinc/blue/green literals left in
   * the file were dark-palette assumptions no theme switch could reach.
   */
  describe('theme tokens', () => {
    const ROOT_STATES: Array<[string, Record<string, unknown>]> = [
      ['idle', { orchestratorStatus: 'idle', currentPlan: null }],
      [
        'active',
        { orchestratorStatus: 'executing', currentPlan: MOCK_PLAN, stepStatuses: {} },
      ],
    ];

    it.each(ROOT_STATES)('paints an opaque token background on the %s root', (_label, state) => {
      mockStore(state);
      const { container } = render(<OrchestratorPanel />);

      const root = container.firstElementChild;
      expect(root).toBeTruthy();
      // Opaque, and a token. `bg-[var(--sf-bg-surface)]/50` would satisfy a
      // substring check while leaving the host's #18181b showing through.
      expect(Array.from(root?.classList ?? [])).toContain('bg-[var(--sf-bg-surface)]');
    });

    /**
     * A DOM assertion only covers the branches a given test renders, so it
     * goes quietly stale the moment someone hardcodes a colour in a branch
     * nobody exercises. Scan the source instead.
     */
    it('routes every colour in the component through a --sf-* token', () => {
      const source = readFileSync(resolve(__dirname, '../OrchestratorPanel.tsx'), 'utf-8');

      const PALETTES = [
        'slate', 'gray', 'zinc', 'neutral', 'stone', 'red', 'orange', 'amber',
        'yellow', 'lime', 'green', 'emerald', 'teal', 'cyan', 'sky', 'blue',
        'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose', 'white', 'black',
      ];
      const UTILITIES = ['bg', 'text', 'border', 'ring', 'fill', 'stroke', 'from', 'via', 'to'];
      const literal = new RegExp(
        `(?:^|[\\s"'\`:])(?:${UTILITIES.join('|')})-(?:${PALETTES.join('|')})` +
          `(?:-\\d{2,3})?(?:/\\d{1,3})?(?![\\w-])`
      );

      // Lines are skipped only by their LEADING token (`//`, `/*`, `*`). No
      // JSX className can start a line that way, so this cannot hide a real
      // class; it spares only the prose above ERROR_SURFACE_CLASSES and
      // WARNING_SURFACE_CLASSES, which quote the literals they replaced so
      // the reason for the migration survives in the file.
      const offenders = source
        .split('\n')
        .map((line, i) => [i + 1, line] as const)
        .filter(([, line]) => {
          const t = line.trimStart();
          return !(t.startsWith('//') || t.startsWith('/*') || t.startsWith('*'));
        })
        .filter(([, line]) => literal.test(line))
        .map(([n, line]) => `${n}: ${line.trim()}`);

      expect(offenders).toEqual([]);
    });

    /**
     * The reviewer's requirement in words: two alert surfaces sitting side by
     * side must respond to a theme switch identically. These two are mutually
     * exclusive branches of `TokenCostBar`, so each is rendered on its own and
     * graded against the same expected shape — they may differ by exactly one
     * token name and nothing else.
     */
    // Object form, not tuples: a tuple row would have its whole token-estimate
    // object printed into the test name by the `%s` formatter.
    const TINT_ROWS: Array<{
      label: string;
      tokenEstimate: Record<string, unknown>;
      copy: string;
      token: string;
    }> = [
      {
        label: 'insufficient balance',
        tokenEstimate: { ...MOCK_PLAN.tokenEstimate, sufficientBalance: false },
        copy: 'Insufficient token balance',
        token: '--sf-destructive',
      },
      {
        label: 'token warning',
        tokenEstimate: {
          ...MOCK_PLAN.tokenEstimate,
          sufficientBalance: true,
          warningMessage: 'This will use most of your balance',
        },
        copy: 'This will use most of your balance',
        token: '--sf-warning',
      },
    ];

    it.each(TINT_ROWS)(
      'draws the $label row as a semantic-token tint with an AA-safe foreground',
      ({ tokenEstimate, copy, token }) => {
        mockStore({
          orchestratorStatus: 'awaiting_approval',
          currentPlan: MOCK_PLAN,
          tokenEstimate,
          stepStatuses: {},
        });
        render(<OrchestratorPanel />);

        const row = screen.getByText(copy);
        expect(Array.from(row.classList).sort()).toEqual(
          [
            'mt-2',
            'flex',
            'items-center',
            'gap-1.5',
            'rounded',
            `bg-[var(${token})]/10`,
            'px-2',
            'py-1',
            'text-xs',
            'text-[var(--sf-text)]',
          ].sort()
        );
      }
    );

    it('builds the warnings list on the same construction as the error banner', () => {
      mockStore({
        orchestratorStatus: 'completed',
        currentPlan: MOCK_PLAN,
        stepStatuses: {},
        orchestratorWarnings: [
          { stepId: 'step-2', executor: 'physics_profile', message: 'Matched no entities.' },
        ],
      });
      render(<OrchestratorPanel />);

      // Same border/background proportions as ERROR_SURFACE_CLASSES with
      // --sf-warning substituted for --sf-destructive, and the same AA-safe
      // foreground. A theme switch therefore moves both by the same amount.
      const classes = Array.from(screen.getByLabelText('Game creation warnings').classList);
      expect(classes).toContain('border-[var(--sf-warning)]/40');
      expect(classes).toContain('bg-[var(--sf-warning)]/10');
      expect(classes).toContain('text-[var(--sf-text)]');
    });
  });
});
