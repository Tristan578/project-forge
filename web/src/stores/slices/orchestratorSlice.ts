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
import { collectStepWarnings } from '@/lib/game-creation/stepWarnings';
import { QUICK_START_AUTO_GATES } from '@/lib/game-creation/quickStart';
import { captureException } from '@/lib/monitoring/sentry-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A step that succeeded but could not do everything it was asked.
 *
 * Kept separate from `orchestratorError`: that field means the pipeline stopped,
 * and folding a "your camera will not move" note into it would either read as a
 * failure or, worse, be overwritten by the next step's note. Warnings accumulate
 * across the run and are never fatal.
 */
export interface OrchestratorWarning {
  /**
   * Absent for a note about the PLAN rather than a step — an empty `steps` slot
   * has no step to name. Optional rather than a sentinel id so the UI has to
   * decide what to render instead of printing a fake step label.
   */
  stepId?: string;
  /** Executor name — the UI already maps this to a human step label. */
  executor?: string;
  message: string;
}

export type OrchestratorStatus =
  | 'idle'
  | 'decomposing'
  | 'planning'
  | 'awaiting_approval'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'cancelled';

/**
 * Statuses in which NO pipeline run holds the slice, so a new run may start.
 *
 * The complement is what `isOrchestratorRunLive` reports. Kept as data (not an
 * inline disjunction) because three call sites have to agree: the slice guard
 * below, the quick-start dialog's reopen behaviour, and `EditorLayout`'s
 * trigger.
 */
const RESTARTABLE_STATUSES: readonly OrchestratorStatus[] = [
  'idle',
  'completed',
  'failed',
  'cancelled',
];

/**
 * Is a pipeline run currently holding the orchestrator slice?
 *
 * Starting a second run over a live one is destructive, and silently so:
 * `startDecomposition`'s opening `set()` clears `currentPlan`, `stepStatuses`,
 * `pendingGate` and `autoApproveGateIds`, and replaces `_abortController` — so
 * the first run keeps executing against a store that no longer describes it,
 * its gate resolver is stranded, and `cancelPipeline` can only ever reach the
 * second controller.
 */
export function isOrchestratorRunLive(status: OrchestratorStatus): boolean {
  return !RESTARTABLE_STATUSES.includes(status);
}

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

  /** Non-fatal notes from steps that succeeded partially. Accumulates per run. */
  orchestratorWarnings: OrchestratorWarning[];

  /**
   * Approval gates this run answers with 'approved' without asking the user.
   *
   * Set once, in `startDecomposition`'s opening `set()`, so a run started from
   * chat can never inherit the previous quick-start run's list. Empty for every
   * entry point except `startQuickStart`.
   */
  autoApproveGateIds: readonly string[];

  // Actions
  startDecomposition: (
    prompt: string,
    projectType: ProjectType,
    opts?: { autoApproveGateIds?: readonly string[] },
  ) => Promise<void>;
  /**
   * Quick-start entry point: decompose, then run, with no "Start Building" click.
   *
   * Resolves `false` — having changed nothing at all — when a run is already
   * live (`isOrchestratorRunLive`). `true` means this call owned the run and
   * drove it to completion; it is NOT a claim the run succeeded, which callers
   * read off `orchestratorStatus` / `orchestratorError` as before.
   */
  startQuickStart: (prompt: string, projectType: ProjectType) => Promise<boolean>;
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

/**
 * Build the `stepStatuses` map from a plan, tolerating an empty `steps` slot.
 *
 * `plan` is caller-supplied (`setPlan` is public and takes any
 * `OrchestratorPlan`), so a hole or a `null` in `steps` reaches here as data.
 * `for (const step of plan.steps)` does NOT skip a hole — it yields `undefined`
 * — so the old loop threw on `step.id` before `runPipeline` ever ran, which
 * made the runner's own tolerance of that gap unreachable in the product.
 * Indexed, because only an indexed read sees every slot.
 */
function deriveStepStatuses(plan: OrchestratorPlan): Record<string, PlanStep['status']> {
  const statuses: Record<string, PlanStep['status']> = {};
  for (let i = 0; i < plan.steps.length; i += 1) {
    const step = plan.steps[i];
    if (!step) continue;
    statuses[step.id] = step.status;
  }
  return statuses;
}

/**
 * Find a step's index by id, tolerating the same hole/`null` slots
 * `deriveStepStatuses` tolerates.
 *
 * `Array.prototype.findIndex` does NOT skip holes (unlike forEach/map/filter/
 * some/every) — it visits every index, invoking the predicate with `undefined`
 * for a hole or an explicit null slot. `onStepComplete` used to call
 * `plan.steps.findIndex(s => s.id === stepId)` directly, so `s.id` threw
 * before `runPipeline`'s own tolerance of the same gap was ever reached
 * (PF-1229 finding #2).
 */
function findStepIndex(plan: OrchestratorPlan, stepId: string): number {
  for (let i = 0; i < plan.steps.length; i += 1) {
    const step = plan.steps[i];
    if (step && step.id === stepId) return i;
  }
  return -1;
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
  orchestratorWarnings: [],
  autoApproveGateIds: [],

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  startDecomposition: async (prompt, projectType, opts) => {
    // Create abort controller so cancelPipeline can stop in-flight fetches
    _abortController = new AbortController();

    set({
      orchestratorStatus: 'decomposing',
      orchestratorError: null,
      orchestratorWarnings: [],
      currentPlan: null,
      stepStatuses: {},
      pendingGate: null,
      tokenEstimate: null,
      reservationId: null,
      // The ONLY write point. Every run passes through here, so a run that does
      // not opt in explicitly clears whatever the previous run left behind —
      // a chat-initiated run after a quick-start must still ask for the plan.
      autoApproveGateIds: opts?.autoApproveGateIds ?? [],
    });

    try {
      const res = await fetch('/api/game/decompose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, projectType }),
        signal: _abortController.signal,
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
      const stepStatuses = deriveStepStatuses(plan);

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
          signal: _abortController?.signal,
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
        // Persist reservationId immediately so cancelPipeline can release
        // tokens even if the user cancels before the full set() below.
        set({ reservationId });
      }

      // If cancelled during decomposition, don't override status
      if (get().orchestratorStatus === 'cancelled') return;

      set({
        currentPlan: plan,
        tokenEstimate: plan.tokenEstimate,
        reservationId,
        stepStatuses,
        orchestratorStatus: 'awaiting_approval',
        currentStepIndex: 0,
      });
    } catch (err) {
      // AbortError from cancellation — don't override 'cancelled' status
      if (err instanceof DOMException && err.name === 'AbortError') return;

      set({
        orchestratorStatus: 'failed',
        orchestratorError: err instanceof Error ? err.message : String(err),
      });
    } finally {
      // Clear abort controller after decomposition completes (runPipelineFromPlan creates its own)
      if (get().orchestratorStatus !== 'executing') {
        _abortController = null;
      }
    }
  },

  startQuickStart: async (prompt, projectType) => {
    // Refuse rather than clobber. `startDecomposition` is unconditionally
    // destructive on entry, so a second "Build it" over a live run orphans the
    // first one — see `isOrchestratorRunLive`. The dialog keeps its own guard
    // too; this one is what makes the invariant hold for every caller.
    if (isOrchestratorRunLive(get().orchestratorStatus)) return false;

    // The quick-start entry point: decompose, then run, with no "Start Building"
    // click in between. `gate_plan` exists so a chat user can review the plan
    // before spending tokens — a user who clicked "Make me a game" and typed a
    // prompt has already said yes to exactly that, and re-asking twice (once for
    // the plan, once at the gate) is the break this closes.
    await get().startDecomposition(prompt, projectType, {
      autoApproveGateIds: QUICK_START_AUTO_GATES,
    });

    // Read status fresh: `startDecomposition` swallows its own errors into
    // 'failed'/'cancelled', so the only way to know it produced a plan is to
    // look at the state it left behind.
    if (get().orchestratorStatus !== 'awaiting_approval') return true;

    await get().runPipelineFromPlan();
    return true;
  },

  setPlan: (plan) => {
    const stepStatuses = deriveStepStatuses(plan);
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
    // Release reserved tokens so they aren't leaked on cancel
    const { reservationId } = get();
    if (reservationId) {
      fetch('/api/game/pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'release', reservationId, actualUsed: 0 }),
      }).catch((err) => {
        captureException(err instanceof Error ? err : new Error(String(err)), {
          extra: { context: 'orchestrator.cancelPipeline.releaseTokens', reservationId },
        });
      });
    }
    set({
      orchestratorStatus: 'cancelled',
      pendingGate: null,
      // A cancelled run must not leave the next one auto-approving: the next
      // run may be chat-initiated and never passes through an opt-in.
      autoApproveGateIds: [],
    });
  },

  resetOrchestrator: () => {
    // Abort BEFORE dropping the handle. Nulling it alone leaves an in-flight
    // `runPipeline` running to completion against an engine the user has
    // already walked away from — the runner honours `ctx.signal`, so this is
    // the only thing that actually stops the abandoned run doing more work
    // (PF-1229 finding #4).
    if (_abortController) {
      _abortController.abort();
    }
    _abortController = null;
    // Resolve BEFORE dropping the handle, exactly as `cancelPipeline` does.
    // An `AbortSignal` does not settle a promise, and `pipelineRunner` awaits
    // this gate bare — so nulling the resolver alone parks the abandoned run
    // at `await callbacks.onGateReached(gate)` forever: `runPipeline` never
    // returns, its `finally` never runs, and the token reservation is never
    // released (PF-1229 finding #3).
    if (_gateResolver) {
      _gateResolver('rejected');
      _gateResolver = null;
    }
    set({
      orchestratorStatus: 'idle',
      currentPlan: null,
      currentStepIndex: 0,
      stepStatuses: {},
      pendingGate: null,
      tokenEstimate: null,
      reservationId: null,
      orchestratorError: null,
      orchestratorWarnings: [],
      autoApproveGateIds: [],
    });
  },

  runPipelineFromPlan: async () => {
    const { currentPlan } = get();
    if (!currentPlan) {
      set({ orchestratorStatus: 'failed', orchestratorError: 'No plan to execute' });
      return;
    }

    // Dynamic imports break circular dependency (editorStore imports this slice)
    const { getCommandDispatcher, getCommandBatchDispatcher } = await import('@/stores/editorStore');

    const dispatcher = getCommandDispatcher();
    if (!dispatcher) {
      set({ orchestratorStatus: 'failed', orchestratorError: 'Engine not loaded' });
      return;
    }

    _abortController = new AbortController();
    // Cleared per RUN, not per plan: re-running the same plan after a fix must
    // not show the notes the previous attempt produced.
    set({ orchestratorStatus: 'executing', orchestratorWarnings: [] });

    // Read user tier from userStore
    const { useUserStore } = await import('@/stores/userStore');
    const { tier } = useUserStore.getState();

    // Get fresh editorStore state
    const { useEditorStore } = await import('@/stores/editorStore');

    // The engine's `ProjectType` resource defaults to `ThreeD` and its ONLY
    // writer is the `set_project_type` command. Nothing on this pipeline
    // dispatched it — every executor merely read `ctx.projectType` — so a
    // generated 2D game ran the whole engine in 3D mode: the character
    // controller steered the player along the depth axis an orthographic camera
    // cannot show, and no Camera2d was created. Setting it through the store
    // (which dispatches) keeps store and engine in step, and it has to happen
    // before the first step rather than inside one, because scene, camera and
    // character steps all depend on it.
    useEditorStore.getState().setProjectType(currentPlan.gdd.projectType);

    const ctx: ExecutorContext = {
      dispatchCommand: dispatcher,
      dispatchCommandBatch: getCommandBatchDispatcher() ?? undefined,
      getStore: () => useEditorStore.getState(),
      projectType: currentPlan.gdd.projectType,
      userTier: tier as UserTier,
      signal: _abortController.signal,
      resolveStepOutput: () => undefined, // overridden by runPipeline
      resolveStepOutputs: () => [], // overridden by runPipeline
    };

    const { reservationId } = get();
    let completedSteps = 0;
    const totalSteps = currentPlan.steps.length;

    /**
     * Run identity: is the store still showing the plan THIS run belongs to?
     *
     * `resetOrchestrator` aborts, but an abort is cooperative — the runner
     * checks `ctx.signal` between steps, so a step already in flight still
     * settles and still fires its callbacks. If the user has since reset and
     * started a DIFFERENT plan, every writer below would be writing the
     * abandoned run's progress onto the new plan: `step_${n}` ids collide
     * across plans by construction. Every writer below is gated on it, and
     * the list here is exhaustive on purpose — an unguarded one is invisible
     * until it ships: a stale `onStepComplete` marks a step the new plan has
     * not run, a stale `onGateReached` repaints an approval gate over an idle
     * store and hijacks `approveGate`/`cancelPipeline`, a stale
     * `onPlanStatusChange` reports the new run completed/failed
     * mid-execution, a stale `catch` fails it outright, and the `finally`
     * both drops the LIVE run's abort handle and folds the abandoned run's
     * step statuses onto the new plan.
     * Identity on the captured plan object is the whole test —
     * `setPlan` stores the reference, so it holds across a re-run of the same
     * plan and breaks the moment a different one (or `null`) is live
     * (PF-1229 finding #4).
     */
    const isCurrentRun = () => get().currentPlan === currentPlan;

    const callbacks: PipelineCallbacks = {
      onStepComplete: (stepId, result) => {
        if (!isCurrentRun()) return;

        const status = result.success ? 'completed' : 'failed';
        get().updateStepStatus(stepId, status);

        // Update currentStepIndex
        const plan = get().currentPlan;
        const idx = plan ? findStepIndex(plan, stepId) : -1;
        if (idx >= 0) {
          set({ currentStepIndex: idx });
        }

        // A partially-applied step reports itself on its output rather than
        // failing, so this is the only place those notes can reach the user —
        // and until now the whole `output` was discarded here.
        const messages = collectStepWarnings(result.output);
        if (messages.length > 0) {
          const executor = plan?.steps[idx]?.executor ?? stepId;
          set(s => ({
            orchestratorWarnings: [
              ...s.orchestratorWarnings,
              ...messages.map(message => ({ stepId, executor, message })),
            ],
          }));
        }

        if (result.success) {
          completedSteps += 1;
        }
      },

      onGateReached: (gate) => {
        // A superseded run must not repaint an approval gate over the live
        // store — but it still has to be UNPARKED, or its `await` never
        // returns, `runPipeline` never reaches its `finally`, and the token
        // reservation leaks for the rest of the session. `pipelineRunner`
        // checks `ctx.signal` only at the top of each step iteration, so a
        // step that settles just before a reset still reaches this gate with
        // no abort check in between, and `planBuilder` gives every plan
        // gates. Resolve with the VALUE 'rejected' rather than rejecting the
        // promise: the runner reads that as a decision, cancels the abandoned
        // plan, skips its remaining steps and returns normally
        // (PF-1229 finding #1).
        //
        // This check comes BEFORE the auto-approve one below: a superseded run
        // must be cancelled whether or not its gate was pre-approved, and
        // answering 'approved' here would let a dead run keep executing steps
        // against the store that replaced it.
        if (!isCurrentRun()) {
          return Promise.resolve<'approved' | 'rejected'>('rejected');
        }

        // Auto-approved gates never become a `pendingGate`, so the status stays
        // 'executing' and no UI is asked to render a confirmation the user has
        // already given. Resolving synchronously also means no `_gateResolver`
        // is left dangling for `cancelPipeline` to reject.
        if (get().autoApproveGateIds.includes(gate.id)) {
          return Promise.resolve<'approved' | 'rejected'>('approved');
        }

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
        if (mapped && isCurrentRun()) {
          set({ orchestratorStatus: mapped });
        }
      },
    };

    try {
      await runPipeline(currentPlan, EXECUTOR_REGISTRY, ctx, callbacks);

      // Final status is set by onPlanStatusChange callback
    } catch (err) {
      // Same run-identity gate as the callbacks: an abandoned run that throws
      // (including the AbortError `resetOrchestrator` now provokes) must not
      // paint the plan the user moved on to as failed.
      if (isCurrentRun()) {
        set({
          orchestratorStatus: 'failed',
          orchestratorError: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      // Only the CURRENT run may drop the shared abort handle. A superseded
      // run settling after `startPipeline` assigned a fresh
      // `_abortController` would otherwise null out the LIVE run's handle,
      // leaving `cancelPipeline` and `resetOrchestrator` with nothing to
      // abort — silently, since both no-op on a null handle. That is the
      // Round-2 defect this gate exists to close, one scope out
      // (PF-1229 finding #2).
      if (isCurrentRun()) {
        _abortController = null;
      }

      // Re-read the plan the runner mutated.
      //
      // `onStepComplete` is the only other writer of `stepStatuses` (the other
      // callback writers touch `orchestratorStatus`/`orchestratorWarnings`,
      // and the `catch` writes the error), and it fires ONLY for a step that
      // actually executed, mapping its result to 'completed' or
      // 'failed'. Every 'skipped' the runner writes — a required step whose
      // dependency failed, the cascade after a failure or a cancel, an optional
      // step that exhausted its retries — is written straight onto the plan with
      // no callback, and `setPlan` seeded an entry for every step id, so
      // `stepStatuses[step.id] ?? step.status` in the panel never falls back.
      // Without this pass a dependency-skipped step renders as 'Pending' with no
      // alert for the whole life of a failed run. Same for `plan.warnings`,
      // which nothing else reads.
      //
      // In `finally` so a run that threw still shows how far it got.
      //
      // `resetOrchestrator` aborts, but an abort is cooperative — a step
      // already in flight still settles, so this promise chain still reaches
      // here. `currentPlan` is a stale closure capture from function entry, so
      // folding it unconditionally would resurrect the abandoned run's step
      // statuses under the new plan's ids (`step_${n}` collides across plans
      // by construction) after the user has already moved on. Same
      // `isCurrentRun()` gate every other writer in this run uses
      // (PF-1229 finding #4).
      if (isCurrentRun()) {
        set(s => ({
          stepStatuses: { ...s.stepStatuses, ...deriveStepStatuses(currentPlan) },
          orchestratorWarnings: [
            ...s.orchestratorWarnings,
            ...(currentPlan.warnings ?? []).map(message => ({ message })),
          ],
        }));
      }

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
