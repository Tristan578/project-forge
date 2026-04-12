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
});
