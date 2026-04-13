import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSliceStore } from './sliceTestTemplate';
import {
  createOrchestratorSlice,
  _setAbortController,
  _getGateResolver,
} from '../orchestratorSlice';
import type { OrchestratorSlice } from '../orchestratorSlice';
import type { OrchestratorPlan, PlanStep, ApprovalGate, TokenEstimate } from '@/lib/game-creation/types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/game-creation/planBuilder', () => ({
  buildPlan: vi.fn().mockReturnValue(makeMockPlan()),
}));

vi.mock('@/lib/game-creation/pipelineRunner', () => ({
  runPipeline: vi.fn().mockResolvedValue(makeMockPlan()),
}));

vi.mock('@/lib/game-creation/executors', () => ({
  EXECUTOR_REGISTRY: new Map(),
}));

vi.mock('@/stores/editorStore', () => ({
  getCommandDispatcher: vi.fn().mockReturnValue(vi.fn()),
  getCommandBatchDispatcher: vi.fn().mockReturnValue(null),
  useEditorStore: { getState: vi.fn().mockReturnValue({}) },
}));

vi.mock('@/stores/userStore', () => ({
  useUserStore: {
    getState: vi.fn().mockReturnValue({
      tier: 'hobbyist',
      tokenBalance: { total: 10000, monthlyRemaining: 8000, monthlyTotal: 10000, addon: 2000, nextRefillDate: null },
    }),
  },
}));

// Mock fetch for decompose endpoint
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockPlan(): OrchestratorPlan {
  const steps: PlanStep[] = [
    { id: 'step_0', executor: 'plan_present', input: {}, dependsOn: [], maxRetries: 1, optional: false, status: 'pending' },
    { id: 'step_1', executor: 'scene_create', input: { name: 'Level 1' }, dependsOn: ['step_0'], maxRetries: 1, optional: false, status: 'pending' },
    { id: 'step_2', executor: 'entity_setup', input: {}, dependsOn: ['step_1'], maxRetries: 1, optional: false, status: 'pending' },
  ];

  const approvalGates: ApprovalGate[] = [
    { id: 'gate_plan', label: 'Review plan', description: 'Check before building', afterStepId: 'step_0', status: 'pending', displayData: {} },
  ];

  const tokenEstimate: TokenEstimate = {
    breakdown: [{ category: 'Engine operations', estimatedTokens: 0, variance: 0 }],
    totalEstimated: 500,
    totalVarianceHigh: 700,
    totalVarianceLow: 300,
    userTier: 'Hobbyist tier',
    sufficientBalance: true,
  };

  return {
    id: 'plan-1',
    projectId: 'proj-1',
    prompt: 'test game',
    gdd: {
      id: 'gdd-1',
      title: 'Test Game',
      description: 'A test game',
      systems: [],
      scenes: [],
      assetManifest: [],
      estimatedScope: 'small',
      styleDirective: 'default',
      feelDirective: { mood: 'fun', pacing: 'medium', weight: 'medium', referenceGames: [], oneLiner: 'A test game' },
      constraints: [],
      projectType: '3d',
    },
    steps,
    approvalGates,
    tokenEstimate,
    status: 'planning',
    currentStepIndex: 0,
    createdAt: Date.now(),
  };
}

function makeMockGdd() {
  return {
    id: 'gdd-1',
    title: 'Test Game',
    description: 'A test game',
    systems: [],
    scenes: [],
    assetManifest: [],
    estimatedScope: 'small',
    styleDirective: 'default',
    feelDirective: { mood: 'fun', pacing: 'medium', weight: 'medium', referenceGames: [], oneLiner: 'test' },
    constraints: [],
    projectType: '3d',
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('orchestratorSlice', () => {
  let store: ReturnType<typeof createSliceStore<OrchestratorSlice>>;

  beforeEach(() => {
    store = createSliceStore(createOrchestratorSlice);
    mockFetch.mockReset();
    _setAbortController(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initial state', () => {
    it('starts with idle status and null plan', () => {
      const state = store.getState();
      expect(state.orchestratorStatus).toBe('idle');
      expect(state.currentPlan).toBeNull();
      expect(state.currentStepIndex).toBe(0);
      expect(state.stepStatuses).toEqual({});
      expect(state.pendingGate).toBeNull();
      expect(state.tokenEstimate).toBeNull();
      expect(state.orchestratorError).toBeNull();
    });
  });

  describe('startDecomposition', () => {
    it('sets status to decomposing and calls decompose endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ gdd: makeMockGdd() }),
      });

      const promise = store.getState().startDecomposition('make a platformer', '3d');

      // Should be decomposing immediately
      expect(store.getState().orchestratorStatus).toBe('decomposing');

      await promise;

      // Should transition through planning to awaiting_approval
      expect(store.getState().orchestratorStatus).toBe('awaiting_approval');
      expect(store.getState().currentPlan).not.toBeNull();
      expect(store.getState().tokenEstimate).not.toBeNull();
    });

    it('sets status to failed on fetch error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: 'LLM failure' }),
      });

      await store.getState().startDecomposition('bad prompt', '3d');

      expect(store.getState().orchestratorStatus).toBe('failed');
      expect(store.getState().orchestratorError).toBe('LLM failure');
    });

    it('sets status to failed on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await store.getState().startDecomposition('make a game', '3d');

      expect(store.getState().orchestratorStatus).toBe('failed');
      expect(store.getState().orchestratorError).toBe('Network error');
    });

    it('clears previous state before starting', async () => {
      // Set up some previous state
      store.getState().setPlan(makeMockPlan());
      store.setState({ orchestratorError: 'old error' });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ gdd: makeMockGdd() }),
      });

      await store.getState().startDecomposition('new game', '2d');

      expect(store.getState().orchestratorError).toBeNull();
    });
  });

  describe('setPlan', () => {
    it('populates plan, token estimate, and step statuses', () => {
      const plan = makeMockPlan();
      store.getState().setPlan(plan);

      expect(store.getState().currentPlan).toBe(plan);
      expect(store.getState().tokenEstimate).toBe(plan.tokenEstimate);
      expect(store.getState().stepStatuses).toEqual({
        step_0: 'pending',
        step_1: 'pending',
        step_2: 'pending',
      });
      expect(store.getState().currentStepIndex).toBe(0);
    });
  });

  describe('updateStepStatus', () => {
    it('updates the denormalized step status map', () => {
      store.getState().setPlan(makeMockPlan());

      store.getState().updateStepStatus('step_0', 'running');
      expect(store.getState().stepStatuses.step_0).toBe('running');

      store.getState().updateStepStatus('step_0', 'completed');
      expect(store.getState().stepStatuses.step_0).toBe('completed');
    });

    it('does not affect other step statuses', () => {
      store.getState().setPlan(makeMockPlan());

      store.getState().updateStepStatus('step_0', 'completed');
      expect(store.getState().stepStatuses.step_1).toBe('pending');
      expect(store.getState().stepStatuses.step_2).toBe('pending');
    });
  });

  describe('gate resolution', () => {
    it('setPendingGate stores the gate', () => {
      const gate: ApprovalGate = {
        id: 'gate_plan',
        label: 'Review plan',
        description: 'Check it',
        afterStepId: 'step_0',
        status: 'pending',
        displayData: {},
      };

      store.getState().setPendingGate(gate);
      expect(store.getState().pendingGate).toBe(gate);
    });

    it('resolveGate approved clears gate and sets executing', () => {
      const gate: ApprovalGate = {
        id: 'gate_plan',
        label: 'Review plan',
        description: 'Check it',
        afterStepId: 'step_0',
        status: 'pending',
        displayData: {},
      };

      store.getState().setPendingGate(gate);
      store.setState({ orchestratorStatus: 'awaiting_approval' });

      store.getState().resolveGate('approved');

      expect(store.getState().pendingGate).toBeNull();
      expect(store.getState().orchestratorStatus).toBe('executing');
    });

    it('resolveGate rejected clears gate and sets cancelled', () => {
      const gate: ApprovalGate = {
        id: 'gate_plan',
        label: 'Review plan',
        description: 'Check it',
        afterStepId: 'step_0',
        status: 'pending',
        displayData: {},
      };

      store.getState().setPendingGate(gate);
      store.setState({ orchestratorStatus: 'awaiting_approval' });

      store.getState().resolveGate('rejected');

      expect(store.getState().pendingGate).toBeNull();
      expect(store.getState().orchestratorStatus).toBe('cancelled');
    });
  });

  describe('cancelPipeline', () => {
    it('aborts the controller and sets cancelled status', () => {
      const ac = new AbortController();
      _setAbortController(ac);

      store.setState({ orchestratorStatus: 'executing' });
      store.getState().cancelPipeline();

      expect(ac.signal.aborted).toBe(true);
      expect(store.getState().orchestratorStatus).toBe('cancelled');
    });

    it('resolves pending gate as rejected', () => {
      // Simulate a pending gate resolver
      const gate: ApprovalGate = {
        id: 'gate_plan',
        label: 'Review',
        description: '',
        afterStepId: 'step_0',
        status: 'pending',
        displayData: {},
      };
      store.getState().setPendingGate(gate);

      // Manually set a gate resolver via the callback path
      // (In real code, runPipelineFromPlan sets this)
      store.getState().cancelPipeline();

      expect(store.getState().pendingGate).toBeNull();
      expect(store.getState().orchestratorStatus).toBe('cancelled');
    });
  });

  describe('resetOrchestrator', () => {
    it('returns to idle initial state', () => {
      // Set up some state
      store.getState().setPlan(makeMockPlan());
      store.setState({
        orchestratorStatus: 'completed',
        orchestratorError: 'some error',
        currentStepIndex: 5,
      });

      store.getState().resetOrchestrator();

      const state = store.getState();
      expect(state.orchestratorStatus).toBe('idle');
      expect(state.currentPlan).toBeNull();
      expect(state.currentStepIndex).toBe(0);
      expect(state.stepStatuses).toEqual({});
      expect(state.pendingGate).toBeNull();
      expect(state.tokenEstimate).toBeNull();
      expect(state.orchestratorError).toBeNull();
    });
  });

  describe('setOrchestratorStatus', () => {
    it('sets the status directly', () => {
      store.getState().setOrchestratorStatus('executing');
      expect(store.getState().orchestratorStatus).toBe('executing');
    });
  });

  describe('setCurrentStepIndex', () => {
    it('updates the current step index', () => {
      store.getState().setCurrentStepIndex(3);
      expect(store.getState().currentStepIndex).toBe(3);
    });
  });

  describe('runPipelineFromPlan', () => {
    it('fails with error when no plan is set', async () => {
      await store.getState().runPipelineFromPlan();

      expect(store.getState().orchestratorStatus).toBe('failed');
      expect(store.getState().orchestratorError).toBe('No plan to execute');
    });

    it('fails with error when engine is not loaded', async () => {
      store.getState().setPlan(makeMockPlan());

      // Mock dispatcher to return null (engine not loaded)
      const { getCommandDispatcher } = await import('@/stores/editorStore');
      (getCommandDispatcher as ReturnType<typeof vi.fn>).mockReturnValueOnce(null);

      await store.getState().runPipelineFromPlan();

      expect(store.getState().orchestratorStatus).toBe('failed');
      expect(store.getState().orchestratorError).toBe('Engine not loaded');
    });

    it('calls runPipeline when plan and engine are available', async () => {
      store.getState().setPlan(makeMockPlan());

      const { runPipeline } = await import('@/lib/game-creation/pipelineRunner');

      await store.getState().runPipelineFromPlan();

      expect(runPipeline).toHaveBeenCalledOnce();
    });
  });
});
