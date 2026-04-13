/**
 * Orchestrator slice — manages game creation pipeline state.
 *
 * Drives the decompose -> plan -> approve -> execute flow.
 * The pipeline runs client-side (executors call dispatchCommand to the WASM engine).
 * Only the decomposition step makes a server call (LLM via /api/game/decompose).
 *
 * Spec: specs/2026-04-12-e1-pipeline-integration.md (Deliverable 1)
 */

import type { StateCreator } from 'zustand';
import type {
  OrchestratorPlan,
  PlanStep,
  ApprovalGate,
  TokenEstimate,
  ExecutorContext,
  UserTier,
} from '@/lib/game-creation/types';
import type { ProjectType } from './types';
import { buildPlan } from '@/lib/game-creation/planBuilder';
import { runPipeline } from '@/lib/game-creation/pipelineRunner';
import type { PipelineCallbacks } from '@/lib/game-creation/pipelineRunner';
import { EXECUTOR_REGISTRY } from '@/lib/game-creation/executors';
import { getCommandDispatcher, getCommandBatchDispatcher } from '@/stores/editorStore';
import { captureException } from '@/lib/monitoring/sentry-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OrchestratorStatus =
  | 'idle'
  | 'decomposing'
  | 'planning'
  | 'awaiting_approval'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface OrchestratorSlice {
  // Pipeline state
  orchestratorStatus: OrchestratorStatus;
  currentPlan: OrchestratorPlan | null;
  currentStepIndex: number;
  stepStatuses: Record<string, PlanStep['status']>;

  // Gate resolution
  pendingGate: ApprovalGate | null;

  // Token estimate & budget
  tokenEstimate: TokenEstimate | null;
  reservationId: string | null;

  // Error state
  orchestratorError: string | null;

  // Actions
  startDecomposition: (prompt: string, projectType: ProjectType) => Promise<void>;
  setPlan: (plan: OrchestratorPlan) => void;
  setOrchestratorStatus: (status: OrchestratorStatus) => void;
  updateStepStatus: (stepId: string, status: PlanStep['status']) => void;
  setCurrentStepIndex: (index: number) => void;
  setPendingGate: (gate: ApprovalGate | null) => void;
  resolveGate: (decision: 'approved' | 'rejected') => void;
  cancelPipeline: () => void;
  resetOrchestrator: () => void;
  runPipelineFromPlan: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Module-level state for AbortController and gate resolution
// (not in Zustand — these are imperative handles, not reactive state)
// ---------------------------------------------------------------------------

let _abortController: AbortController | null = null;
let _gateResolver: ((decision: 'approved' | 'rejected') => void) | null = null;

/** Exposed for testing — allows injection of a custom abort controller. */
export function _setAbortController(ac: AbortController | null): void {
  _abortController = ac;
}

/** Exposed for testing — allows checking if a gate resolver is pending. */
export function _getGateResolver(): ((decision: 'approved' | 'rejected') => void) | null {
  return _gateResolver;
}

// ---------------------------------------------------------------------------
// Slice creator
// ---------------------------------------------------------------------------

export const createOrchestratorSlice: StateCreator<
  OrchestratorSlice,
  [],
  [],
  OrchestratorSlice
> = (set, get) => ({
  // Initial state
  orchestratorStatus: 'idle',
  currentPlan: null,
  currentStepIndex: 0,
  stepStatuses: {},
  pendingGate: null,
  tokenEstimate: null,
  reservationId: null,
  orchestratorError: null,

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  startDecomposition: async (prompt, projectType) => {
    set({
      orchestratorStatus: 'decomposing',
      orchestratorError: null,
      currentPlan: null,
      stepStatuses: {},
      pendingGate: null,
      tokenEstimate: null,
      reservationId: null,
    });

    try {
      const res = await fetch('/api/game/decompose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, projectType }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(body.error ?? body.message ?? `Decomposition failed (${res.status})`);
      }

      const { gdd } = await res.json();

      // Build plan client-side
      set({ orchestratorStatus: 'planning' });

      // Read user tier and balance from userStore (separate store)
      // Dynamic import avoids circular dependency with editorStore
      const { useUserStore } = await import('@/stores/userStore');
      const { tier, tokenBalance } = useUserStore.getState();
      const projectId = crypto.randomUUID();

      const plan = buildPlan(
        gdd,
        projectId,
        tier as UserTier,
        tokenBalance?.total ?? 0,
      );

      // Initialize step statuses map
      const stepStatuses: Record<string, PlanStep['status']> = {};
      for (const step of plan.steps) {
        stepStatuses[step.id] = step.status;
      }

      // Reserve tokens for the pipeline (server-side via API)
      let reservationId: string | null = null;
      if (plan.tokenEstimate.totalVarianceHigh > 0) {
        const reserveRes = await fetch('/api/game/pipeline', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'reserve',
            estimatedTotal: plan.tokenEstimate.totalVarianceHigh,
          }),
        });

        if (!reserveRes.ok) {
          const reserveBody = await reserveRes.json().catch(() => ({ error: 'Token reservation failed' }));
          throw new Error(reserveBody.error === 'insufficient_tokens'
            ? 'Insufficient tokens — add tokens or upgrade your plan'
            : reserveBody.error ?? 'Token reservation failed');
        }

        const reserveData = await reserveRes.json();
        if (typeof reserveData.reservationId !== 'string' || reserveData.reservationId.length === 0) {
          throw new Error('Token reservation returned invalid ID');
        }
        reservationId = reserveData.reservationId;
      }

      set({
        currentPlan: plan,
        tokenEstimate: plan.tokenEstimate,
        reservationId,
        stepStatuses,
        orchestratorStatus: 'awaiting_approval',
        currentStepIndex: 0,
      });
    } catch (err) {
      set({
        orchestratorStatus: 'failed',
        orchestratorError: err instanceof Error ? err.message : String(err),
      });
    }
  },

  setPlan: (plan) => {
    const stepStatuses: Record<string, PlanStep['status']> = {};
    for (const step of plan.steps) {
      stepStatuses[step.id] = step.status;
    }
    set({
      currentPlan: plan,
      tokenEstimate: plan.tokenEstimate,
      stepStatuses,
      currentStepIndex: 0,
    });
  },

  setOrchestratorStatus: (status) => set({ orchestratorStatus: status }),

  updateStepStatus: (stepId, status) => {
    const prev = get().stepStatuses;
    set({ stepStatuses: { ...prev, [stepId]: status } });
  },

  setCurrentStepIndex: (index) => set({ currentStepIndex: index }),

  setPendingGate: (gate) => set({ pendingGate: gate }),

  resolveGate: (decision) => {
    if (_gateResolver) {
      _gateResolver(decision);
      _gateResolver = null;
    }
    set({
      pendingGate: null,
      orchestratorStatus: decision === 'approved' ? 'executing' : 'cancelled',
    });
  },

  cancelPipeline: () => {
    if (_abortController) {
      _abortController.abort();
    }
    // Clean up any pending gate
    if (_gateResolver) {
      _gateResolver('rejected');
      _gateResolver = null;
    }
    set({
      orchestratorStatus: 'cancelled',
      pendingGate: null,
    });
  },

  resetOrchestrator: () => {
    _abortController = null;
    _gateResolver = null;
    set({
      orchestratorStatus: 'idle',
      currentPlan: null,
      currentStepIndex: 0,
      stepStatuses: {},
      pendingGate: null,
      tokenEstimate: null,
      reservationId: null,
      orchestratorError: null,
    });
  },

  runPipelineFromPlan: async () => {
    const { currentPlan } = get();
    if (!currentPlan) {
      set({ orchestratorStatus: 'failed', orchestratorError: 'No plan to execute' });
      return;
    }

    const dispatcher = getCommandDispatcher();
    if (!dispatcher) {
      set({ orchestratorStatus: 'failed', orchestratorError: 'Engine not loaded' });
      return;
    }

    _abortController = new AbortController();
    set({ orchestratorStatus: 'executing' });

    // Read user tier from userStore
    const { useUserStore } = await import('@/stores/userStore');
    const { tier } = useUserStore.getState();

    // Build executor context
    // Dynamic import of editorStore to get fresh state — avoids stale closure
    const { useEditorStore } = await import('@/stores/editorStore');

    const ctx: ExecutorContext = {
      dispatchCommand: dispatcher,
      dispatchCommandBatch: getCommandBatchDispatcher() ?? undefined,
      store: useEditorStore.getState(),
      projectType: currentPlan.gdd.projectType,
      userTier: tier as UserTier,
      signal: _abortController.signal,
      resolveStepOutput: () => undefined, // overridden by runPipeline
    };

    const { reservationId } = get();
    let completedSteps = 0;
    const totalSteps = currentPlan.steps.length;

    const callbacks: PipelineCallbacks = {
      onStepComplete: (stepId, result) => {
        const status = result.success ? 'completed' : 'failed';
        get().updateStepStatus(stepId, status);

        // Update currentStepIndex
        const plan = get().currentPlan;
        if (plan) {
          const idx = plan.steps.findIndex(s => s.id === stepId);
          if (idx >= 0) {
            set({ currentStepIndex: idx });
          }
        }

        if (result.success) {
          completedSteps += 1;
        }
      },

      onGateReached: (gate) => {
        return new Promise<'approved' | 'rejected'>((resolve) => {
          _gateResolver = resolve;
          set({
            pendingGate: gate,
            orchestratorStatus: 'awaiting_approval',
          });
        });
      },

      onPlanStatusChange: (planStatus) => {
        // Map plan status to orchestrator status
        const statusMap: Record<string, OrchestratorStatus> = {
          executing: 'executing',
          completed: 'completed',
          failed: 'failed',
          cancelled: 'cancelled',
        };
        const mapped = statusMap[planStatus];
        if (mapped) {
          set({ orchestratorStatus: mapped });
        }
      },
    };

    try {
      await runPipeline(currentPlan, EXECUTOR_REGISTRY, ctx, callbacks);

      // Final status is set by onPlanStatusChange callback
    } catch (err) {
      set({
        orchestratorStatus: 'failed',
        orchestratorError: err instanceof Error ? err.message : String(err),
      });
    } finally {
      _abortController = null;

      // Release unused tokens — prorate by completed steps (fire-and-forget)
      if (reservationId) {
        const estimated = currentPlan.tokenEstimate.totalEstimated;
        const actualUsed = totalSteps > 0
          ? Math.round(estimated * (completedSteps / totalSteps))
          : 0;
        fetch('/api/game/pipeline', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'release', reservationId, actualUsed }),
        }).catch((releaseErr) => {
          captureException(releaseErr instanceof Error ? releaseErr : new Error(String(releaseErr)), {
            extra: { context: 'orchestrator.releaseTokens', reservationId, actualUsed },
          });
        });
      }
    }
  },
});
