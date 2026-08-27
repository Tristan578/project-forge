import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSliceStore } from './sliceTestTemplate';
import {
  createOrchestratorSlice,
  isOrchestratorRunLive,
  _setAbortController,
  _getGateResolver,
} from '../orchestratorSlice';
import type { OrchestratorSlice } from '../orchestratorSlice';
import type {
  OrchestratorPlan,
  PlanStep,
  ApprovalGate,
  TokenEstimate,
  ExecutorResult,
} from '@/lib/game-creation/types';
import { runPipeline } from '@/lib/game-creation/pipelineRunner';
import type { PipelineCallbacks } from '@/lib/game-creation/pipelineRunner';

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

vi.mock('@/lib/monitoring/sentry-client', () => ({
  captureException: vi.fn(),
}));

/**
 * `setProjectType` is on the mock because the pipeline calls it before the first
 * step — see the `set_project_type` test below. It has to be a stable spy across
 * `getState()` calls (the slice reads state more than once), so the mocked state
 * object is a module-level singleton rather than a fresh literal per call.
 */
const mockEditorState = {
  setProjectType: vi.fn(),
};

vi.mock('@/stores/editorStore', () => ({
  getCommandDispatcher: vi.fn().mockReturnValue(vi.fn()),
  getCommandBatchDispatcher: vi.fn().mockReturnValue(null),
  useEditorStore: { getState: vi.fn(() => mockEditorState) },
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
    userTier: 'Starter tier',
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
    // `runPipeline` is a bare `vi.fn()` from the module factory, and
    // `vi.restoreAllMocks()` does NOT clear a `vi.fn()`'s implementation in
    // vitest 4 — so a test that installs a persistent `mockImplementation`
    // leaks it into every test that follows and the suite becomes
    // order-dependent. Reset it here and re-establish the factory default the
    // tests which install no implementation of their own rely on
    // (PF-1229 round-2 finding #6).
    vi.mocked(runPipeline).mockReset();
    vi.mocked(runPipeline).mockResolvedValue(makeMockPlan());
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
      expect(state.reservationId).toBeNull();
      expect(state.orchestratorError).toBeNull();
      expect(state.orchestratorWarnings).toEqual([]);
      expect(Array.from(state.autoApproveGateIds)).toEqual([]);
    });
  });

  describe('startDecomposition', () => {
    it('sets status to decomposing and calls decompose endpoint', async () => {
      // First call: decompose endpoint
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ gdd: makeMockGdd() }),
      });
      // Second call: token reservation
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ reservationId: 'res-123', remaining: { total: 9300 } }),
      });

      const promise = store.getState().startDecomposition('make a platformer', '3d');

      // Should be decomposing immediately
      expect(store.getState().orchestratorStatus).toBe('decomposing');

      await promise;

      // Should transition through planning to awaiting_approval
      expect(store.getState().orchestratorStatus).toBe('awaiting_approval');
      expect(store.getState().currentPlan).not.toBeNull();
      expect(store.getState().tokenEstimate).not.toBeNull();
      expect(store.getState().reservationId).toBe('res-123');
    });

    it('fails when token reservation returns insufficient', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ gdd: makeMockGdd() }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'insufficient_tokens' }),
      });

      await store.getState().startDecomposition('make a game', '3d');

      expect(store.getState().orchestratorStatus).toBe('failed');
      expect(store.getState().orchestratorError).toContain('Insufficient tokens');
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
      store.setState({ orchestratorError: 'old error', reservationId: 'old-res' });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ gdd: makeMockGdd() }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ reservationId: 'new-res', remaining: { total: 9000 } }),
      });

      await store.getState().startDecomposition('new game', '2d');

      expect(store.getState().orchestratorError).toBeNull();
      expect(store.getState().reservationId).toBe('new-res');
    });

    it('respects cancellation during decomposing phase', async () => {
      // Simulate fetch that rejects with AbortError when signal fires
      mockFetch.mockImplementationOnce((_url: string, opts?: { signal?: AbortSignal }) => {
        return new Promise((_resolve, reject) => {
          if (opts?.signal) {
            opts.signal.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted.', 'AbortError'));
            });
          }
        });
      });

      const promise = store.getState().startDecomposition('make a game', '3d');

      expect(store.getState().orchestratorStatus).toBe('decomposing');

      // Cancel while decomposing — aborts the fetch
      store.getState().cancelPipeline();
      expect(store.getState().orchestratorStatus).toBe('cancelled');

      await promise;

      // Status must remain cancelled, not overwritten to awaiting_approval or failed
      expect(store.getState().orchestratorStatus).toBe('cancelled');
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
        orchestratorWarnings: [
          { stepId: 'step_1', executor: 'camera_setup', message: 'it will not move' },
        ],
        currentStepIndex: 5,
        reservationId: 'res-123',
      });

      store.getState().resetOrchestrator();

      const state = store.getState();
      expect(state.orchestratorStatus).toBe('idle');
      expect(state.currentPlan).toBeNull();
      expect(state.currentStepIndex).toBe(0);
      expect(state.stepStatuses).toEqual({});
      expect(state.pendingGate).toBeNull();
      expect(state.tokenEstimate).toBeNull();
      expect(state.reservationId).toBeNull();
      expect(state.orchestratorError).toBeNull();
      expect(state.orchestratorWarnings).toEqual([]);
      expect(Array.from(state.autoApproveGateIds)).toEqual([]);
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

    // The engine's `ProjectType` resource defaults to `ThreeD`, is registered
    // with `init_resource`, and its ONLY writer is the `set_project_type`
    // command. Nothing on this pipeline ever dispatched it — every executor
    // merely read `ctx.projectType`, which is a TypeScript-side field the engine
    // never sees. So a generated 2D game ran the whole engine in 3D mode: the
    // character controller steered the player along the depth axis an
    // orthographic camera cannot show. Silent, as ever, because a command that
    // is never sent raises nothing.
    describe('project type reaches the engine', () => {
      beforeEach(() => {
        mockEditorState.setProjectType.mockClear();
      });

      it('sets the project type from the GDD before running the pipeline', async () => {
        const plan = makeMockPlan();
        plan.gdd.projectType = '2d';
        store.getState().setPlan(plan);

        await store.getState().runPipelineFromPlan();

        expect(mockEditorState.setProjectType).toHaveBeenCalledWith('2d');
      });

      it('sets it for 3D too rather than relying on the engine default', async () => {
        // Relying on the default would be correct today and wrong the moment a
        // previous session left the resource on TwoD — the resource outlives any
        // one generation run.
        store.getState().setPlan(makeMockPlan());

        await store.getState().runPipelineFromPlan();

        expect(mockEditorState.setProjectType).toHaveBeenCalledWith('3d');
      });

      // Ordering is the whole point: scene, camera and character steps all read
      // the resource, so setting it after the first step would leave those steps
      // running in the wrong mode.
      it('sets it before the first step runs', async () => {
        const plan = makeMockPlan();
        plan.gdd.projectType = '2d';
        store.getState().setPlan(plan);

        // The observation is CAPTURED inside the mock and asserted afterwards,
        // never asserted inside it. `runPipelineFromPlan` wraps the call in a
        // try/catch that turns any throw into `orchestratorStatus: 'failed'`, so
        // an `expect` in here would have its AssertionError swallowed and the
        // test would pass no matter which order the two calls happened in.
        let projectTypeCallsBeforePipeline = -1;
        const { runPipeline } = await import('@/lib/game-creation/pipelineRunner');
        (runPipeline as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
          projectTypeCallsBeforePipeline = mockEditorState.setProjectType.mock.calls.length;
          return makeMockPlan();
        });

        await store.getState().runPipelineFromPlan();

        expect(runPipeline).toHaveBeenCalled();
        expect(projectTypeCallsBeforePipeline).toBe(1);
        expect(mockEditorState.setProjectType).toHaveBeenCalledWith('2d');
        // And the run really completed — a swallowed throw would leave 'failed'.
        expect(store.getState().orchestratorStatus).not.toBe('failed');
      });

      it('does not touch the project type when there is no plan', async () => {
        await store.getState().runPipelineFromPlan();

        expect(mockEditorState.setProjectType).not.toHaveBeenCalled();
      });
    });
  });

  /**
   * `OrchestratorPlan.steps` is typed as a non-nullable `PlanStep[]`, but
   * `setPlan` is public and a plan can legitimately arrive with a hole or an
   * explicit `null` slot (a step the planner decided not to schedule).
   * `deriveStepStatuses` already tolerates this (indexed loop, `if (!step)
   * continue`), but `onStepComplete`'s `plan.steps.findIndex(s => s.id ===
   * stepId)` did not: `findIndex` visits every index including holes,
   * invoking its predicate with `undefined`, so `s.id` threw before
   * `runPipeline`'s own tolerance of the gap was ever reached
   * (PF-1229 finding #2).
   */
  describe('sparse plan tolerance in onStepComplete', () => {
    function makeSparsePlan(): OrchestratorPlan {
      const plan = makeMockPlan();
      return {
        ...plan,
        steps: [
          plan.steps[0],
          null as unknown as PlanStep,
          plan.steps[2],
        ] as PlanStep[],
      };
    }

    it('does not fail the run when a completed step is reported past a null slot', async () => {
      const plan = makeSparsePlan();
      store.getState().setPlan(plan);

      const { runPipeline } = await import('@/lib/game-creation/pipelineRunner');
      (runPipeline as ReturnType<typeof vi.fn>).mockImplementationOnce(
        async (
          _plan: unknown,
          _registry: unknown,
          _ctx: unknown,
          callbacks: PipelineCallbacks,
        ) => {
          // The real runner writes the step's status onto the plan BEFORE it
          // fires the callback, and the finally block re-reads the plan once
          // the run settles — so a fake runner that only fires the callback
          // would leave the plan saying 'pending' and the re-read would
          // rewind what the callback set (same convention as
          // `runWithStepResults` above).
          const step = plan.steps.find((s) => s && s.id === 'step_2');
          if (step) step.status = 'completed';
          callbacks.onStepComplete?.('step_2', { success: true });
          return plan;
        },
      );

      await store.getState().runPipelineFromPlan();

      // A throw inside onStepComplete is swallowed by runPipelineFromPlan's
      // outer try/catch and surfaces as a failed run with an unrelated-looking
      // "Cannot read properties of undefined" message, not a hard crash — but
      // exactly as wrong: the step DID complete and the UI must say so.
      expect(store.getState().orchestratorStatus).not.toBe('failed');
      expect(store.getState().orchestratorError).toBeNull();
      expect(store.getState().stepStatuses['step_2']).toBe('completed');
    });
  });

  /**
   * An abandoned run keeps writing to the store.
   *
   * `resetOrchestrator` now calls `.abort()`, but an abort is COOPERATIVE:
   * the runner checks `ctx.signal` between steps, so a step already in flight
   * still settles and still fires its callbacks, and the promise chain still
   * reaches the `catch`/`finally`. If the user has reset and started a
   * DIFFERENT plan in the meantime, four separate writers would paint the
   * abandoned run's progress onto the new plan — `onStepComplete`
   * (`step_${n}` ids collide across plans by construction),
   * `onPlanStatusChange` (reports the new run completed/failed
   * mid-execution), the `catch` (fails it outright) and the `finally` fold.
   * Every one of them is gated on run identity (PF-1229 finding #4).
   *
   * Each case here drives the callbacks LATE — after `setPlan(planB)` — which
   * is the only way to exercise the three non-`finally` writers: a fake runner
   * that fires no callbacks after the reset can only ever prove the `finally`
   * guard.
   */
  describe('stale-run guard on resetOrchestrator race', () => {
    /**
     * Start planA's run, hand back a promise that never settles on its own,
     * and capture the callbacks + context the slice passed in so the test can
     * drive them by hand after the reset.
     */
    async function startAbandonedRun(): Promise<{
      planA: OrchestratorPlan;
      planB: OrchestratorPlan;
      callbacks: PipelineCallbacks;
      ctx: { signal: AbortSignal };
      settle: (plan: OrchestratorPlan) => void;
      reject: (err: Error) => void;
      runPromise: Promise<void>;
    }> {
      const planA = makeMockPlan();
      store.getState().setPlan(planA);

      const { runPipeline } = await import('@/lib/game-creation/pipelineRunner');
      let capturedCallbacks!: PipelineCallbacks;
      let capturedCtx!: { signal: AbortSignal };
      let settle!: (plan: OrchestratorPlan) => void;
      let reject!: (err: Error) => void;
      let markCalled!: () => void;
      const called = new Promise<void>((resolve) => {
        markCalled = resolve;
      });
      const pending = new Promise<OrchestratorPlan>((resolve, rejectFn) => {
        settle = resolve;
        reject = rejectFn;
      });
      (runPipeline as ReturnType<typeof vi.fn>).mockImplementationOnce(
        (
          _plan: unknown,
          _registry: unknown,
          ctx: { signal: AbortSignal },
          callbacks: PipelineCallbacks,
        ) => {
          capturedCtx = ctx;
          capturedCallbacks = callbacks;
          markCalled();
          return pending;
        },
      );

      const runPromise = store.getState().runPipelineFromPlan();
      // Wait for the runner to actually be CALLED rather than counting
      // microtasks: `runPipelineFromPlan` awaits three dynamic imports first,
      // and a fixed number of `await Promise.resolve()` hops is a guess that
      // silently stops covering this the moment another await is added.
      await called;

      // The user resets and starts a brand-new plan while planA's run is
      // still in flight.
      store.getState().resetOrchestrator();
      const planB = makeMockPlan();
      store.getState().setPlan(planB);

      return { planA, planB, callbacks: capturedCallbacks, ctx: capturedCtx, settle, reject, runPromise };
    }

    it('aborts the in-flight run rather than only dropping the handle', async () => {
      const planA = makeMockPlan();
      store.getState().setPlan(planA);

      const { runPipeline } = await import('@/lib/game-creation/pipelineRunner');
      let capturedSignal!: AbortSignal;
      let settle!: (plan: OrchestratorPlan) => void;
      let markCalled!: () => void;
      const called = new Promise<void>((resolve) => {
        markCalled = resolve;
      });
      const pending = new Promise<OrchestratorPlan>((resolve) => {
        settle = resolve;
      });
      (runPipeline as ReturnType<typeof vi.fn>).mockImplementationOnce(
        (_plan: unknown, _registry: unknown, ctx: { signal: AbortSignal }) => {
          capturedSignal = ctx.signal;
          markCalled();
          return pending;
        },
      );

      const runPromise = store.getState().runPipelineFromPlan();
      await called;

      expect(capturedSignal.aborted).toBe(false);

      store.getState().resetOrchestrator();

      // The runner honours `ctx.signal`; nulling the handle without aborting
      // left the abandoned run doing real engine work for the rest of its life.
      expect(capturedSignal.aborted).toBe(true);

      settle(planA);
      await runPromise;
    });

    it("does not let an abandoned run's finally-block write clobber a newer plan", async () => {
      const { planA, planB, settle, runPromise } = await startAbandonedRun();

      // planA is only now reported complete, after planB is already on
      // screen. The real runner writes step status onto the plan object
      // before resolving, so mirror that here.
      planA.steps[0] = { ...planA.steps[0], status: 'completed' };
      settle(planA);
      await runPromise;

      // planB never ran step_0 — its own freshly-derived 'pending' status
      // must survive, not be overwritten by planA's stale fold.
      expect(store.getState().currentPlan).toBe(planB);
      expect(store.getState().stepStatuses['step_0']).toBe('pending');
    });

    it('ignores a late onStepComplete from the abandoned run', async () => {
      const { planA, callbacks, settle, runPromise } = await startAbandonedRun();

      // planA's runner finally gets around to reporting step_0 — long after
      // planB replaced it. `step_0` exists in BOTH plans, so an unguarded
      // write lands squarely on planB's own step.
      callbacks.onStepComplete?.('step_0', {
        success: true,
        output: { warning: 'stale note from the abandoned run' },
      });

      expect(store.getState().stepStatuses['step_0']).toBe('pending');
      expect(store.getState().orchestratorWarnings).toEqual([]);
      expect(store.getState().currentStepIndex).toBe(0);

      settle(planA);
      await runPromise;

      expect(store.getState().stepStatuses['step_0']).toBe('pending');
      expect(store.getState().orchestratorWarnings).toEqual([]);
    });

    it('ignores a late onPlanStatusChange from the abandoned run', async () => {
      const { planA, callbacks, settle, runPromise } = await startAbandonedRun();

      // `setPlan` leaves the status alone, so the store is still 'idle' from
      // the reset — a fresh plan awaiting the user, not a finished run.
      expect(store.getState().orchestratorStatus).toBe('idle');

      callbacks.onPlanStatusChange?.('completed');
      expect(store.getState().orchestratorStatus).toBe('idle');

      callbacks.onPlanStatusChange?.('failed');
      expect(store.getState().orchestratorStatus).toBe('idle');

      settle(planA);
      await runPromise;

      expect(store.getState().orchestratorStatus).toBe('idle');
      expect(store.getState().orchestratorError).toBeNull();
    });

    it('ignores a late throw from the abandoned run', async () => {
      const { reject, runPromise } = await startAbandonedRun();

      // The abort provoked by `resetOrchestrator` surfaces here as a rejected
      // run. Reporting it would mark the plan the user just started as failed.
      reject(new Error('pipeline aborted'));
      await runPromise;

      expect(store.getState().orchestratorStatus).toBe('idle');
      expect(store.getState().orchestratorError).toBeNull();
      expect(store.getState().stepStatuses['step_0']).toBe('pending');
    });

    /**
     * Start a run for whatever plan is CURRENTLY live, capturing its context
     * and callbacks the same way `startAbandonedRun` does.
     *
     * The two guards below are about what a superseded run must not damage,
     * and neither is observable without a real second run to damage: a stale
     * `finally` can only clobber an abort handle some live run owns, and a
     * stale `onGateReached` can only clobber a `_gateResolver` some live run
     * is parked on. A fixture with only the abandoned run in it passes either
     * way.
     */
    async function startLiveRun(): Promise<{
      callbacks: PipelineCallbacks;
      ctx: { signal: AbortSignal };
      settle: (plan: OrchestratorPlan) => void;
      runPromise: Promise<void>;
    }> {
      const { runPipeline } = await import('@/lib/game-creation/pipelineRunner');
      let capturedCallbacks!: PipelineCallbacks;
      let capturedCtx!: { signal: AbortSignal };
      let settle!: (plan: OrchestratorPlan) => void;
      let markCalled!: () => void;
      const called = new Promise<void>((resolve) => {
        markCalled = resolve;
      });
      const pending = new Promise<OrchestratorPlan>((resolve) => {
        settle = resolve;
      });
      (runPipeline as ReturnType<typeof vi.fn>).mockImplementationOnce(
        (
          _plan: unknown,
          _registry: unknown,
          ctx: { signal: AbortSignal },
          callbacks: PipelineCallbacks,
        ) => {
          capturedCtx = ctx;
          capturedCallbacks = callbacks;
          markCalled();
          return pending;
        },
      );

      const runPromise = store.getState().runPipelineFromPlan();
      await called;

      return { callbacks: capturedCallbacks, ctx: capturedCtx, settle, runPromise };
    }

    it('unparks a superseded onGateReached without repainting the live gate', async () => {
      const {
        planA,
        planB,
        callbacks: staleCallbacks,
        settle: settleStale,
        runPromise: stalePromise,
      } = await startAbandonedRun();

      // planB is the live run now, and it parks at its OWN gate.
      const live = await startLiveRun();
      const liveGate = planB.approvalGates[0];
      const liveGatePromise = live.callbacks.onGateReached?.(liveGate);
      expect(store.getState().pendingGate).toBe(liveGate);
      expect(store.getState().orchestratorStatus).toBe('awaiting_approval');
      const liveResolver = _getGateResolver();
      expect(liveResolver).not.toBeNull();

      // planA's runner only NOW reaches its gate. `pipelineRunner` checks
      // `ctx.signal` at the top of each step iteration, so a step that settled
      // just before the reset still arrives here with no abort check in
      // between. It must be answered — an unresolved gate parks the abandoned
      // run forever, so its `finally` never runs and the token reservation
      // leaks for the rest of the session — but answering it must not touch
      // the live run's gate state.
      await expect(staleCallbacks.onGateReached?.(planA.approvalGates[0])).resolves.toBe(
        'rejected',
      );

      expect(store.getState().pendingGate).toBe(liveGate);
      expect(store.getState().orchestratorStatus).toBe('awaiting_approval');
      // Identity, not merely non-null: an unguarded stale gate overwrites
      // `_gateResolver` with its own, and the user's Approve then unparks the
      // ABANDONED run while the live one stays stuck.
      expect(_getGateResolver()).toBe(liveResolver);

      // Unwind both runs so neither leaks into the next test.
      store.getState().resolveGate('approved');
      await expect(liveGatePromise).resolves.toBe('approved');
      settleStale(planA);
      live.settle(planB);
      await Promise.all([stalePromise, live.runPromise]);
    });

    it("does not let an abandoned run's finally-block drop the live run's abort handle", async () => {
      const { planA, planB, settle: settleStale, runPromise: stalePromise } =
        await startAbandonedRun();

      const live = await startLiveRun();
      expect(live.ctx.signal.aborted).toBe(false);

      // planA settles LAST — after `runPipelineFromPlan` handed the shared
      // module-level handle to planB's run.
      settleStale(planA);
      await stalePromise;

      // The live run must still be cancellable. An unguarded `finally` nulls
      // `_abortController` here, and both `cancelPipeline` and
      // `resetOrchestrator` no-op silently on a null handle — so the defect
      // presents as a Cancel button that changes the status and stops nothing.
      store.getState().cancelPipeline();
      expect(live.ctx.signal.aborted).toBe(true);

      live.settle(planB);
      await live.runPromise;
    });

    it('lets a run parked at a gate unwind when the user resets', async () => {
      const plan = makeMockPlan();
      store.getState().setPlan(plan);

      const { runPipeline } = await import('@/lib/game-creation/pipelineRunner');
      let decision: 'approved' | 'rejected' | undefined;
      let markCalled!: () => void;
      const called = new Promise<void>((resolve) => {
        markCalled = resolve;
      });
      (runPipeline as ReturnType<typeof vi.fn>).mockImplementationOnce(
        async (
          _plan: unknown,
          _registry: unknown,
          _ctx: unknown,
          callbacks: PipelineCallbacks,
        ) => {
          // `pipelineRunner` awaits this gate BARE, so the entire run is parked
          // on it until something resolves the promise.
          const onGateReached = callbacks.onGateReached;
          if (!onGateReached) {
            throw new Error('runPipeline was given no onGateReached callback');
          }
          const gatePromise = onGateReached(plan.approvalGates[0]);
          markCalled();
          decision = await gatePromise;
          return plan;
        },
      );

      const runPromise = store.getState().runPipelineFromPlan();
      await called;
      expect(store.getState().orchestratorStatus).toBe('awaiting_approval');
      expect(_getGateResolver()).not.toBeNull();

      store.getState().resetOrchestrator();

      // An `AbortSignal` does not settle a promise. If `resetOrchestrator` only
      // DROPPED the resolver, this await would never return: the run would sit
      // at the gate for the rest of the session, its `finally` would never run
      // and the token reservation would never be released. A regression here
      // therefore reads as a test timeout, which is the accurate symptom.
      await runPromise;
      expect(decision).toBe('rejected');
      expect(_getGateResolver()).toBeNull();
      expect(store.getState().pendingGate).toBeNull();
    });
  });

  /**
   * `setPlan` (and `startDecomposition`'s eventual `setPlan` call) must
   * tolerate the same sparse-array shapes `deriveStepStatuses` already
   * handles internally — this is coverage for that tolerance, not a
   * regression driver (PF-1229 finding #6c).
   */
  describe('setPlan with a sparse steps array', () => {
    it('derives stepStatuses only for the real slots, tolerating an array hole', () => {
      const plan = makeMockPlan();
      const sparseSteps = Array.from({ length: 3 }) as PlanStep[];
      sparseSteps[0] = plan.steps[0];
      sparseSteps[2] = plan.steps[2];
      // sparseSteps[1] stays an actual elided array hole, not a stored null.

      expect(() => store.getState().setPlan({ ...plan, steps: sparseSteps })).not.toThrow();
      expect(store.getState().stepStatuses).toEqual({
        step_0: 'pending',
        step_2: 'pending',
      });
    });

    it('derives stepStatuses only for the real slots, tolerating an explicit null slot', () => {
      const plan = makeMockPlan();
      const sparseSteps: PlanStep[] = [
        plan.steps[0],
        null as unknown as PlanStep,
        plan.steps[2],
      ];

      expect(() => store.getState().setPlan({ ...plan, steps: sparseSteps })).not.toThrow();
      expect(store.getState().stepStatuses).toEqual({
        step_0: 'pending',
        step_2: 'pending',
      });
    });
  });

  describe('step warnings', () => {
    /**
     * A step that could only do part of its job reports that on its OUTPUT and
     * still returns `success: true`. `onStepComplete` used to read `result.success`
     * and discard the rest, so every one of those notes was computed and thrown
     * away — the same "value with no consumer" defect the notes exist to warn
     * about (PF-1125).
     */
    async function runWithStepResults(
      results: Array<[string, ExecutorResult]>,
      planOverride?: OrchestratorPlan,
    ): Promise<void> {
      const plan = planOverride ?? makeMockPlan();
      // step_1 is the camera step here so the recorded executor is the one whose
      // label the panel shows next to the note.
      plan.steps[1] = { ...plan.steps[1], executor: 'camera_setup' };
      store.getState().setPlan(plan);

      const { runPipeline } = await import('@/lib/game-creation/pipelineRunner');
      (runPipeline as ReturnType<typeof vi.fn>).mockImplementationOnce(
        async (
          _plan: unknown,
          _registry: unknown,
          _ctx: unknown,
          callbacks: PipelineCallbacks,
        ) => {
          for (const [stepId, result] of results) {
            // The real runner writes the step's status onto the plan BEFORE it
            // fires the callback, and the store re-reads the plan once the run
            // settles (the plan is where every 'skipped' lives) — so a fake
            // runner that only fires callbacks would leave the plan saying
            // 'pending' and the re-read would rewind what the callback set.
            const step = plan.steps.find((s) => s.id === stepId);
            if (step) step.status = result.success ? 'completed' : 'failed';
            callbacks.onStepComplete?.(stepId, result);
          }
          return plan;
        },
      );

      await store.getState().runPipelineFromPlan();
    }

    it('records a partially-applied step against its executor', async () => {
      await runWithStepResults([
        [
          'step_1',
          {
            success: true,
            output: {
              cameraMode: 'sideScroller',
              applied: true,
              warning: 'Camera set to sideScroller but nothing was given for it to follow — it will not move.',
            },
          },
        ],
      ]);

      expect(store.getState().orchestratorWarnings).toEqual([
        {
          stepId: 'step_1',
          executor: 'camera_setup',
          message: 'Camera set to sideScroller but nothing was given for it to follow — it will not move.',
        },
      ]);
      // The step succeeded and the run finished — a note is not a failure.
      expect(store.getState().stepStatuses['step_1']).toBe('completed');
      expect(store.getState().orchestratorError).toBeNull();
    });

    it('reads the plural `warnings` array too', async () => {
      // `verifyExecutor` reports a list, `cameraSetupExecutor` a single string.
      // Both spellings are already in the tree; neither reached the user.
      await runWithStepResults([
        ['step_1', { success: true, output: { warnings: ['Scene has no entities', 'No camera entity found in scene'] } }],
      ]);

      expect(store.getState().orchestratorWarnings.map((w) => w.message)).toEqual([
        'Scene has no entities',
        'No camera entity found in scene',
      ]);
    });

    it('accumulates across steps rather than overwriting', async () => {
      await runWithStepResults([
        ['step_1', { success: true, output: { warning: 'first note' } }],
        ['step_2', { success: true, output: { warning: 'second note' } }],
      ]);

      expect(store.getState().orchestratorWarnings).toEqual([
        { stepId: 'step_1', executor: 'camera_setup', message: 'first note' },
        { stepId: 'step_2', executor: 'entity_setup', message: 'second note' },
      ]);
    });

    it('stays empty when every step applied cleanly', async () => {
      await runWithStepResults([
        ['step_1', { success: true, output: { cameraMode: 'sideScroller', applied: true } }],
        ['step_2', { success: true }],
      ]);

      expect(store.getState().orchestratorWarnings).toEqual([]);
    });

    it('drops the previous run notes when the plan is run again', async () => {
      await runWithStepResults([['step_1', { success: true, output: { warning: 'stale note' } }]]);
      expect(store.getState().orchestratorWarnings).toHaveLength(1);

      // Same plan, second attempt: showing the first attempt's notes would tell
      // the user a problem persists after they fixed it.
      await runWithStepResults([['step_2', { success: true, output: { warning: 'fresh note' } }]]);

      expect(store.getState().orchestratorWarnings.map((w) => w.message)).toEqual(['fresh note']);
    });

    /**
     * `plan.warnings` (plan-level, e.g. "no win condition detected") is a
     * separate source from a step's own output.warning/output.warnings: the
     * finally block folds `currentPlan.warnings` in as bare `{ message }`
     * entries with no `stepId`/`executor`, because they are not about any one
     * step (PF-1229 finding #6b). Asserted with `toEqual` on the full array,
     * not a length check, so an entry accidentally carrying a stray stepId
     * or executor field would fail this.
     */
    it('folds plan-level warnings as bare messages with no stepId or executor', async () => {
      const plan = makeMockPlan();
      plan.warnings = ['No win condition detected — the game cannot be completed.'];
      store.getState().setPlan(plan);

      const { runPipeline } = await import('@/lib/game-creation/pipelineRunner');
      (runPipeline as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => plan);

      await store.getState().runPipelineFromPlan();

      expect(store.getState().orchestratorWarnings).toEqual([
        { message: 'No win condition detected — the game cannot be completed.' },
      ]);
    });

    /**
     * Same clear-on-run-start mechanism that Finding #3 fixed for step-level
     * warnings (`orchestratorWarnings: []` at the top of `runPipelineFromPlan`)
     * also has to hold for plan-level `.warnings` specifically — a re-run of a
     * plan whose own warnings array is unchanged must not accumulate a second
     * copy (PF-1229 finding #6d).
     */
    it('does not duplicate plan-level warnings across a re-run of the same plan', async () => {
      const plan = makeMockPlan();
      plan.warnings = ['No win condition detected — the game cannot be completed.'];
      store.getState().setPlan(plan);

      const { runPipeline } = await import('@/lib/game-creation/pipelineRunner');
      // One implementation per run — a persistent `mockImplementation` here
      // would outlive this test (see the `beforeEach` note).
      (runPipeline as ReturnType<typeof vi.fn>)
        .mockImplementationOnce(async () => plan)
        .mockImplementationOnce(async () => plan);

      await store.getState().runPipelineFromPlan();
      await store.getState().runPipelineFromPlan();

      expect(store.getState().orchestratorWarnings).toEqual([
        { message: 'No win condition detected — the game cannot be completed.' },
      ]);
    });
  });

  describe('skipped step status reaches the panel', () => {
    /**
     * The runner writes 'skipped' straight onto the plan's step objects with
     * NO callback — a required step whose dependency failed, the cascade
     * after a failure or cancel, or an optional step that exhausted its
     * retries. `onStepComplete` never fires for it, so the finally block's
     * re-read via `deriveStepStatuses(currentPlan)` is the ONLY path that can
     * ever surface it; `updateStepStatus` alone would leave it stuck on
     * whatever `setPlan` originally seeded (PF-1229 finding #6a).
     */
    it('reaches stepStatuses for a step the runner skipped with no callback', async () => {
      const plan = makeMockPlan();
      store.getState().setPlan(plan);
      expect(store.getState().stepStatuses.step_2).toBe('pending');

      const { runPipeline } = await import('@/lib/game-creation/pipelineRunner');
      (runPipeline as ReturnType<typeof vi.fn>).mockImplementationOnce(
        async (
          _plan: unknown,
          _registry: unknown,
          _ctx: unknown,
          callbacks: PipelineCallbacks,
        ) => {
          const step0 = plan.steps.find((s) => s && s.id === 'step_0');
          if (step0) step0.status = 'failed';
          const step2 = plan.steps.find((s) => s && s.id === 'step_2');
          if (step2) step2.status = 'skipped';
          callbacks.onStepComplete?.('step_0', { success: false });
          return plan;
        },
      );

      await store.getState().runPipelineFromPlan();

      expect(store.getState().stepStatuses.step_2).toBe('skipped');
    });

    it('reaches stepStatuses even when the run throws before settling normally', async () => {
      const plan = makeMockPlan();
      store.getState().setPlan(plan);

      const { runPipeline } = await import('@/lib/game-creation/pipelineRunner');
      (runPipeline as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
        const step2 = plan.steps.find((s) => s && s.id === 'step_2');
        if (step2) step2.status = 'skipped';
        throw new Error('pipeline exploded');
      });

      await store.getState().runPipelineFromPlan();

      // The finally block runs regardless of the catch above it.
      expect(store.getState().stepStatuses.step_2).toBe('skipped');
      expect(store.getState().orchestratorStatus).toBe('failed');
    });
  });

  /**
   * The quick-start entry point ("Make me a game").
   *
   * Two manual confirmations used to sit between a prompt and a playable game:
   * `startDecomposition` parks the run at 'awaiting_approval' waiting for the
   * panel's "Start Building" button, and then `gate_plan` fires and parks it
   * again. A user who clicked "Make me a game" and typed a prompt has already
   * said yes to both, so the flow asked the same question twice and stranded
   * anyone who did not know to look at the orchestrator panel (PF-1215).
   */
  describe('startQuickStart', () => {
    /** Answers the decompose call and the token reservation that follows it. */
    function mockDecomposeOk(): void {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ gdd: makeMockGdd() }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ reservationId: 'res-qs', remaining: { total: 9300 } }),
      });
      // `runPipelineFromPlan` releases the unused reservation in its `finally`;
      // without a default the queue runs dry and the fire-and-forget `.catch`
      // throws on `undefined`.
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    }

    it('runs the pipeline without a "Start Building" click', async () => {
      mockDecomposeOk();
      const { runPipeline } = await import('@/lib/game-creation/pipelineRunner');
      (runPipeline as ReturnType<typeof vi.fn>).mockClear();

      await store.getState().startQuickStart('Platformer: a jungle level', '3d');

      // The whole point: decomposition produced a plan AND the plan ran, with no
      // second user action in between.
      expect(store.getState().currentPlan).not.toBeNull();
      expect(runPipeline).toHaveBeenCalledOnce();
      expect(store.getState().orchestratorStatus).not.toBe('awaiting_approval');
    });

    it('opts the run into auto-approving gate_plan and nothing else', async () => {
      mockDecomposeOk();

      await store.getState().startQuickStart('Platformer: a jungle level', '3d');

      expect(Array.from(store.getState().autoApproveGateIds)).toEqual(['gate_plan']);
    });

    it('does not run the pipeline when decomposition fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Decomposition exploded' }),
      });
      const { runPipeline } = await import('@/lib/game-creation/pipelineRunner');
      (runPipeline as ReturnType<typeof vi.fn>).mockClear();

      await store.getState().startQuickStart('Platformer: a jungle level', '3d');

      expect(store.getState().orchestratorStatus).toBe('failed');
      expect(runPipeline).not.toHaveBeenCalled();
    });

    it('reports it owned the run when it started one', async () => {
      mockDecomposeOk();

      await expect(
        store.getState().startQuickStart('Platformer: a jungle level', '3d'),
      ).resolves.toBe(true);
    });

    /**
     * The dialog can be closed mid-run and reopened, so "Build it" is reachable
     * while a run is live. `startDecomposition` clears `currentPlan`,
     * `stepStatuses`, `pendingGate` and `autoApproveGateIds` on entry and
     * replaces the abort controller, so a second start does not race the first —
     * it orphans it, and `cancelPipeline` can then only reach the second run.
     */
    describe.each([
      ['decomposing'],
      ['planning'],
      ['awaiting_approval'],
      ['executing'],
    ] as const)('while a run is %s', (liveStatus) => {
      it('refuses to start a second run and leaves the first run untouched', async () => {
        const plan = makeMockPlan();
        const gate: ApprovalGate = {
          id: 'gate_assets',
          label: 'Generate assets?',
          description: 'These cost tokens.',
          afterStepId: 'step_0',
          status: 'pending',
          displayData: {},
        };
        store.setState({
          orchestratorStatus: liveStatus,
          currentPlan: plan,
          stepStatuses: { step_0: 'completed' },
          pendingGate: gate,
          autoApproveGateIds: ['gate_plan'],
          reservationId: 'res-first',
        });

        const { runPipeline } = await import('@/lib/game-creation/pipelineRunner');
        (runPipeline as ReturnType<typeof vi.fn>).mockClear();
        mockFetch.mockClear();

        const started = await store
          .getState()
          .startQuickStart('Shooter: a second run', '3d');

        expect(started).toBe(false);
        expect(mockFetch).not.toHaveBeenCalled();
        expect(runPipeline).not.toHaveBeenCalled();

        // Every field `startDecomposition`'s opening set() would have cleared.
        const after = store.getState();
        expect(after.orchestratorStatus).toBe(liveStatus);
        expect(after.currentPlan).toBe(plan);
        expect(after.stepStatuses).toEqual({ step_0: 'completed' });
        expect(after.pendingGate).toBe(gate);
        expect(Array.from(after.autoApproveGateIds)).toEqual(['gate_plan']);
        expect(after.reservationId).toBe('res-first');
      });
    });

    it.each([['completed'], ['failed'], ['cancelled']] as const)(
      'starts a fresh run after a previous one finished (%s)',
      async (finishedStatus) => {
        mockDecomposeOk();
        store.setState({ orchestratorStatus: finishedStatus });

        const started = await store
          .getState()
          .startQuickStart('Platformer: a jungle level', '3d');

        expect(started).toBe(true);
        expect(store.getState().currentPlan).not.toBeNull();
      },
    );
  });

  describe('isOrchestratorRunLive', () => {
    it.each([['decomposing'], ['planning'], ['awaiting_approval'], ['executing']] as const)(
      'reports %s as live',
      (status) => {
        expect(isOrchestratorRunLive(status)).toBe(true);
      },
    );

    it.each([['idle'], ['completed'], ['failed'], ['cancelled']] as const)(
      'reports %s as restartable',
      (status) => {
        expect(isOrchestratorRunLive(status)).toBe(false);
      },
    );
  });

  describe('gate auto-approval', () => {
    /**
     * Drives the real `onGateReached` callback the slice hands to `runPipeline`,
     * which is the only place the auto-approve decision is made.
     */
    async function reachGate(
      gateId: string,
    ): Promise<{ decision: Promise<'approved' | 'rejected'> }> {
      const plan = makeMockPlan();
      store.getState().setPlan(plan);

      const gate: ApprovalGate = {
        id: gateId,
        label: 'Review',
        description: '',
        afterStepId: 'step_0',
        status: 'pending',
        displayData: {},
      };

      let decision!: Promise<'approved' | 'rejected'>;
      const { runPipeline } = await import('@/lib/game-creation/pipelineRunner');
      (runPipeline as ReturnType<typeof vi.fn>).mockImplementationOnce(
        async (
          _plan: unknown,
          _registry: unknown,
          _ctx: unknown,
          callbacks: PipelineCallbacks,
        ) => {
          decision = callbacks.onGateReached!(gate);
          return plan;
        },
      );

      await store.getState().runPipelineFromPlan();
      return { decision };
    }

    it('approves a listed gate without ever setting a pendingGate', async () => {
      store.setState({ autoApproveGateIds: ['gate_plan'] });

      const { decision } = await reachGate('gate_plan');

      await expect(decision).resolves.toBe('approved');
      // No confirmation is rendered and the run never leaves 'executing', so
      // there is nothing for the user to click and nothing to be stranded on.
      expect(store.getState().pendingGate).toBeNull();
      expect(store.getState().orchestratorStatus).toBe('executing');
      // Nothing dangling for cancelPipeline to reject.
      expect(_getGateResolver()).toBeNull();
    });

    it('still asks for gate_assets — it gates real token spend', async () => {
      store.setState({ autoApproveGateIds: ['gate_plan'] });

      await reachGate('gate_assets');

      expect(store.getState().pendingGate?.id).toBe('gate_assets');
      expect(store.getState().orchestratorStatus).toBe('awaiting_approval');
      expect(_getGateResolver()).not.toBeNull();

      store.getState().resolveGate('approved');
    });

    it('still asks for gate_final — it gates the finished result', async () => {
      store.setState({ autoApproveGateIds: ['gate_plan'] });

      await reachGate('gate_final');

      expect(store.getState().pendingGate?.id).toBe('gate_final');
      expect(store.getState().orchestratorStatus).toBe('awaiting_approval');

      store.getState().resolveGate('approved');
    });

    it('asks for gate_plan on a run that did not opt in', async () => {
      // The default. A chat-initiated run must still show the plan.
      await reachGate('gate_plan');

      expect(store.getState().pendingGate?.id).toBe('gate_plan');
      expect(store.getState().orchestratorStatus).toBe('awaiting_approval');

      store.getState().resolveGate('approved');
    });

    it('clears the list on a chat-initiated run started after a quick-start', async () => {
      store.setState({ autoApproveGateIds: ['gate_plan'] });

      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ gdd: makeMockGdd() }) });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ reservationId: 'res-chat', remaining: { total: 9300 } }),
      });

      // No opts — chatStore calls startDecomposition with two arguments.
      await store.getState().startDecomposition('make a shooter', '3d');

      expect(Array.from(store.getState().autoApproveGateIds)).toEqual([]);
    });

    it('cancelPipeline clears the list', () => {
      store.setState({ autoApproveGateIds: ['gate_plan'], orchestratorStatus: 'executing' });

      store.getState().cancelPipeline();

      expect(Array.from(store.getState().autoApproveGateIds)).toEqual([]);
    });

    it('resetOrchestrator clears the list', () => {
      store.setState({ autoApproveGateIds: ['gate_plan'] });

      store.getState().resetOrchestrator();

      expect(Array.from(store.getState().autoApproveGateIds)).toEqual([]);
    });
  });
});
