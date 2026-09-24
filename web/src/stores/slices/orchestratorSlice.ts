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
import {
  clearEntityObservations,
  readEntityObservation,
} from '@/lib/game-creation/engineObservation';

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
 * inline disjunction) because its consumers have to agree: the slice guard in
 * `startQuickStart`, the quick-start dialog's reopen behaviour (a live status
 * resumes the running view, including a plan waiting at 'awaiting_approval'),
 * and `OnboardingGate`, which keeps a first-run AI attempt pending, and the
 * welcome wizard hidden, for exactly as long as the run is live (#6831).
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
   * Quick-start entry point: decompose, auto-approving `gate_plan`, and stop at
   * 'awaiting_approval'. The caller shows the plan and its cost and runs it with
   * `runPipelineFromPlan` only on the user's explicit confirmation (#6831).
   *
   * Resolves `false` — having changed nothing at all — when a run is already
   * live (`isOrchestratorRunLive`). `true` means this call owned the
   * decomposition; it is NOT a claim a plan was produced, which callers read
   * off `orchestratorStatus` ('awaiting_approval' vs 'failed'/'cancelled').
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

/**
 * What a refused build reservation reports when the balance is short (402).
 * Every surface that shows it offers "Buy tokens" beside it, through
 * `OrchestratorErrorNotice`.
 */
export const INSUFFICIENT_TOKENS_MESSAGE = 'Insufficient tokens — add tokens or upgrade your plan';

/**
 * Shown when the reserve request's outcome is unknown, so the hold may or may
 * not have been taken. Three paths lead here: the request never got a reply
 * (network); the reply was a 2xx the client could not read; or the status was
 * not one of `RESERVE_REFUSAL_STATUSES` -- every 5xx, where `deductTokens` may
 * already have committed, and any other status. It must NOT claim nothing was
 * spent.
 */
export const RESERVATION_UNCONFIRMED_MESSAGE =
  'We could not confirm the build started. Check your token balance before trying again.';

/** A 401 on reserve: the session ended. Building again cannot succeed until they sign in. */
export const SIGNED_OUT_MESSAGE = 'Your session has ended. Sign in again to build this plan.';

/**
 * A 400 on reserve: the route rejected the plan's cost estimate
 * (`validation_error`). Pressing Build it again sends the same estimate, so the
 * way forward is a new plan.
 */
export const PLAN_REJECTED_MESSAGE =
  'This plan could not be priced for a build. Discard it and plan your game again.';

/** A 429 whose body carried no readable wait. */
export const RATE_LIMITED_MESSAGE = 'Too many build requests. Wait a minute, then build it again.';

/** A 403 or 422 whose body carried no readable `message`. */
export const ACCOUNT_BLOCKED_MESSAGE =
  'Your account cannot start builds right now. Contact support@spawnforge.ai if this is unexpected.';

/**
 * The statuses `POST /api/game/pipeline` refuses a reserve with BEFORE
 * `deductTokens` runs, so they prove nothing was taken:
 * - 400 `validation_error` (the route's JSON and schema checks)
 * - 402 `insufficient_tokens` (the route; `deductTokens` refused)
 * - 401 `Unauthorized`, 403 `ACCOUNT_BANNED`, 422 `ACCOUNT_NOT_SYNCABLE`
 *   (`authenticateRequest`, via `withApiMiddleware`)
 * - 429 (`withApiMiddleware`'s rate limit, `rateLimitResponse`)
 *
 * Every other status is treated as unconfirmed. A 5xx proves nothing:
 * `deductTokens` commits and then reads the balance, so a failure there, the
 * egress guard, or a gateway timeout can all answer 5xx after the hold exists.
 * That includes `authenticateRequest`'s 503 `SERVICE_DEGRADED`, which is
 * pre-deduction but shares its status with a post-deduction gateway 503; it is
 * deliberately left unconfirmed rather than trusted on its body.
 */
const RESERVE_REFUSAL_STATUSES = new Set([400, 401, 402, 403, 422, 429]);

/**
 * The route refused the reserve with one of `RESERVE_REFUSAL_STATUSES`. Its
 * message is the user-facing sentence for that refusal, next step included.
 */
class ReservationRefusedError extends Error {}

/**
 * The user-facing sentence for a documented refusal. The route and middleware
 * send machine codes in `error` ('validation_error', 'Unauthorized',
 * 'ACCOUNT_BANNED'), so those are never shown; a readable `message` (the 403
 * and 422 bodies carry one, with the support contact or the missing field) is.
 */
function refusalMessage(status: number, body: { error?: unknown; message?: unknown }): string {
  const readable = typeof body.message === 'string' && body.message.trim() !== '' ? body.message : null;
  switch (status) {
    case 402:
      return INSUFFICIENT_TOKENS_MESSAGE;
    case 401:
      return SIGNED_OUT_MESSAGE;
    case 403:
    case 422:
      return readable ?? ACCOUNT_BLOCKED_MESSAGE;
    case 429:
      // `rateLimitResponse` puts the wait in `error` as a sentence.
      return typeof body.error === 'string' && body.error.startsWith('Too many requests')
        ? body.error
        : RATE_LIMITED_MESSAGE;
    default:
      return PLAN_REJECTED_MESSAGE;
  }
}

/**
 * Reserve the plan's high-variance token total for a build that is starting.
 *
 * Server-side this is `reserveTokenBudget` -> `deductTokens('pipeline_reserve')`:
 * a real deduction from the balance, refunded only by an explicit `release`
 * POST (the run's `finally`, or `cancelPipeline`). Nothing expires it. So it
 * must be taken only when the user has said "build", never while a plan waits
 * for that answer: a plan left on screen, a closed tab or a reload would
 * otherwise keep the whole estimate forever (#6831 review).
 *
 * Resolves to the reservation id, or `null` when the plan has nothing to
 * reserve. Throws with a user-facing message when the server refuses.
 */
async function reserveBuildBudget(estimatedTotal: number): Promise<string | null> {
  if (estimatedTotal <= 0) return null;
  // Deliberately NO abort signal. Aborting a fetch only stops the browser
  // reading the reply: the route still runs `deductTokens` to completion, and
  // the client would throw away the one thing that can refund it, the
  // reservation id. The caller lets this settle and releases it if the user
  // cancelled in the meantime (#6831 review).
  const reserveRes = await fetch('/api/game/pipeline', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'reserve', estimatedTotal }),
  });

  if (!reserveRes.ok) {
    // Anything but a documented refusal leaves the hold's fate unknown; the
    // caller shows RESERVATION_UNCONFIRMED_MESSAGE, so this text is for Sentry.
    if (!RESERVE_REFUSAL_STATUSES.has(reserveRes.status)) {
      throw new Error(`Token reservation failed (${reserveRes.status})`);
    }
    const reserveBody: unknown = await reserveRes.json().catch(() => ({}));
    throw new ReservationRefusedError(
      refusalMessage(reserveRes.status, typeof reserveBody === 'object' && reserveBody !== null ? reserveBody : {}),
    );
  }

  const reserveData = await reserveRes.json();
  if (typeof reserveData.reservationId !== 'string' || reserveData.reservationId.length === 0) {
    throw new Error('Token reservation returned invalid ID');
  }
  return reserveData.reservationId;
}

/** Fire-and-forget refund of a reservation; failures go to Sentry. */
function releaseReservation(reservationId: string, actualUsed: number, context: string): void {
  fetch('/api/game/pipeline', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'release', reservationId, actualUsed }),
  }).catch((err) => {
    captureException(err instanceof Error ? err : new Error(String(err)), {
      extra: { context, reservationId, actualUsed },
    });
  });
}
let _gateResolver: ((decision: 'approved' | 'rejected') => void) | null = null;

/**
 * The plan a `runPipelineFromPlan` call is currently starting or running.
 * A second call for the SAME plan while that one is in flight is refused: the
 * reservation round trip made the window between "Build it" and 'executing'
 * wide enough for a double click to reserve and run the plan twice. Keyed on
 * the plan object, not the status, so a reset followed by a new plan (while
 * the abandoned run unwinds) still starts, and a finished plan can be re-run.
 */
let _inFlightPlan: OrchestratorPlan | null = null;

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
        // `message` before `error`: /api/game/decompose sends a machine code in
        // `error` (e.g. 'decomposition_failed', 'validation_error') and the
        // human-readable text in `message` — picking `error` first showed users
        // the code itself. Falls back to `error` for the one response shape
        // that has no `message` (the ApiKeyError branch, where `error` IS the
        // human-readable text), then to the generic status-code string.
        throw new Error(body.message ?? body.error ?? `Decomposition failed (${res.status})`);
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

      // No token reservation here. The plan now waits for the user's "build"
      // (the orchestrator panel's Start Building, or the quick-start dialog's
      // Build it), and `runPipelineFromPlan` reserves at that moment. A
      // reservation taken here was a real deduction that nothing refunded if
      // the plan was never built.

      // If cancelled during decomposition, don't override status
      if (get().orchestratorStatus === 'cancelled') return;

      set({
        currentPlan: plan,
        tokenEstimate: plan.tokenEstimate,
        reservationId: null,
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
    // destructive on entry, so a second "Plan my game" over a live run orphans the
    // first one — see `isOrchestratorRunLive`. The dialog keeps its own guard
    // too; this one is what makes the invariant hold for every caller.
    if (isOrchestratorRunLive(get().orchestratorStatus)) return false;

    // The quick-start entry point decomposes and STOPS at 'awaiting_approval'.
    // Nothing that spends tokens runs until the user confirms the plan and its
    // estimated cost in the quick-start dialog, which then calls
    // `runPipelineFromPlan` (owner decision on #6831: confirm cost first). That
    // one confirmation is the user's answer to `gate_plan`, so the gate stays
    // auto-approved — asking again at the gate would be a second "are you
    // sure" for the same plan.
    //
    // Designing the game is metered by /api/game/decompose itself. The build's
    // token reservation is taken only when the build starts
    // (`runPipelineFromPlan`), so a plan the user walks away from costs
    // nothing more.
    await get().startDecomposition(prompt, projectType, {
      autoApproveGateIds: QUICK_START_AUTO_GATES,
    });
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
      releaseReservation(reservationId, 0, 'orchestrator.cancelPipeline.releaseTokens');
    }
    set({
      orchestratorStatus: 'cancelled',
      reservationId: null,
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

    // One run per plan at a time (see `_inFlightPlan`). Every return below
    // goes through `settle()` so the guard never outlives this call.
    if (_inFlightPlan === currentPlan) return;
    _inFlightPlan = currentPlan;
    const settle = () => {
      if (_inFlightPlan === currentPlan) _inFlightPlan = null;
    };

    // Dynamic imports break circular dependency (editorStore imports this slice)
    const { getCommandDispatcher, getCommandBatchDispatcher } = await import('@/stores/editorStore');

    const dispatcher = getCommandDispatcher();
    if (!dispatcher) {
      // Nothing ran and nothing was reserved: the plan is intact, so it goes
      // back to waiting for "build" with the reason attached, rather than to
      // 'failed', whose only way on is designing (and paying for) it again.
      // Same run-identity gate as every other writer here: a reset during the
      // import above must not get a live status painted over its idle store.
      if (get().currentPlan === currentPlan) {
        set({ orchestratorStatus: 'awaiting_approval', orchestratorError: 'Engine not loaded' });
      }
      settle();
      return;
    }

    _abortController = new AbortController();
    const signal = _abortController.signal;
    // Cleared per RUN, not per plan: re-running the same plan after a fix must
    // not show the notes the previous attempt produced.
    // A new attempt starts with no error: a reason left by a refused earlier
    // attempt must not be read as this run's failure (#6831 review).
    set({ orchestratorStatus: 'executing', orchestratorWarnings: [], orchestratorError: null });

    // Reserve BEFORE the first engine command, so a refused reservation leaves
    // the scene exactly as it was.
    let reservationId: string | null;
    try {
      reservationId = await reserveBuildBudget(currentPlan.tokenEstimate.totalVarianceHigh);
    } catch (err) {
      settle();
      // A cancel while reserving already set 'cancelled'; do not repaint it.
      if (signal.aborted) return;
      if (get().currentPlan === currentPlan) {
        if (err instanceof ReservationRefusedError) {
          // The route refused with a documented status: nothing was taken and
          // the plan is intact, so it goes back to the review with the reason.
          // As store state it outlives the dialog and in-app navigation; a full
          // page load (Stripe checkout returns to the site root) still drops
          // it, like all editor state.
          set({ orchestratorStatus: 'awaiting_approval', orchestratorError: err.message });
        } else {
          // No reply, a 5xx, or a 2xx we could not read: the hold may already
          // have been taken, with no id to release it by. Say so, and do not
          // offer a one-click retry that could take a second hold. Reported,
          // because only the server's ledger can say whether tokens moved.
          captureException(err instanceof Error ? err : new Error(String(err)), {
            extra: {
              context: 'orchestrator.reserveUnconfirmed',
              estimatedTotal: currentPlan.tokenEstimate.totalVarianceHigh,
            },
          });
          set({ orchestratorStatus: 'failed', orchestratorError: RESERVATION_UNCONFIRMED_MESSAGE });
        }
      }
      return;
    }
    // Cancelled or reset while the reservation was in flight. The request ran
    // to completion (no signal, above), so its id is in hand: `cancelPipeline`
    // could not release a reservation it had not seen yet, so release it here.
    if (signal.aborted || get().currentPlan !== currentPlan) {
      if (reservationId) releaseReservation(reservationId, 0, 'orchestrator.releaseTokens.cancelledWhileReserving');
      settle();
      return;
    }
    set({ reservationId });

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

    // From here the reservation is held, so every path, a throw included,
    // must reach the `finally` below: it releases the unused tokens and
    // settles the in-flight guard. Nothing between the reservation and the
    // run may sit outside it (#6831 review).
    try {
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

      // A fresh run must not read a spawn/transform observation left in the cache
      // by an earlier run (or an earlier cancelled operation on the same id) —
      // that would let stale engine state satisfy a new observation (#9899).
      clearEntityObservations();

      const ctx: ExecutorContext = {
        dispatchCommand: dispatcher,
        dispatchCommandBatch: getCommandBatchDispatcher() ?? undefined,
        getStore: () => useEditorStore.getState(),
        projectType: currentPlan.gdd.projectType,
        userTier: tier as UserTier,
        signal,
        resolveStepOutput: () => undefined, // overridden by runPipeline
        resolveStepOutputs: () => [], // overridden by runPipeline
        // Confirmed-effect query (#9899). Each call FIRES a fresh
        // `get_entity_details` and RETURNS the latest cached answer: the engine
        // answers asynchronously on `QUERY_ENTITY_DETAILS` a frame later, so the
        // observation adapter's next poll reads the state this poll requested.
        // A miss (`undefined`) means no answer is cached. The engine emits
        // nothing for an absent entity, but a present entity's reply may also
        // still be in flight; a miss must not authorize another spawn.
        observeEntity: (entityId: string) => {
          dispatcher('get_entity_details', { entityId });
          return readEntityObservation(entityId);
        },
      };

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
      settle();
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
        releaseReservation(reservationId, actualUsed, 'orchestrator.releaseTokens');
      }
    }
  },
});
