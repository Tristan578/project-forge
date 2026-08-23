/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@/test/utils/componentTestUtils';
import { OrchestratorPanel } from '../OrchestratorPanel';
import { useEditorStore } from '@/stores/editorStore';

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useEditorStore).mockImplementation((selector: any) => selector(state));
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
     */
    it('draws the plan-level and per-step failures in the same red', () => {
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

      const colourOf = (el: Element) => Array.from(el.classList)
        .filter((c) => /(^|:)(border|bg|text)-\[var\(--sf-destructive\)\]/.test(c))
        .sort();

      expect(colourOf(stepAlert)).toEqual(colourOf(banner));
      // And not vacuously equal because neither carries a red at all.
      expect(colourOf(banner).length).toBeGreaterThan(0);
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
});
