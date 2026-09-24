'use client';

/**
 * QuickStartDialog — the one visible "make me a game" entry point.
 *
 * Before this existed, `startDecomposition` could only be reached by typing
 * something the chat intent classifier happened to recognise (chatStore.ts), so
 * the product's headline capability had no control anywhere in the UI.
 *
 * Three states, in order: pick a game type -> describe it -> watch it build.
 * "Plan my game" on the describe step calls `startQuickStart`, which only
 * DESIGNS the game (metered by the decompose route) and stops at
 * 'awaiting_approval'. The running view then shows the plan and its estimated
 * token cost, and the build's tokens are reserved only when the user presses
 * "Build it" there (owner decision on #6831: confirm the cost first). "Build
 * it" means exactly that one action. "Discard plan" drops the plan; "Close"
 * keeps it, and reopening the dialog returns to the review. The confirmation
 * is the user's answer to `gate_plan`, which the slice therefore
 * auto-approves; `gate_assets` / `gate_final` still stop the
 * pipeline, so this dialog renders the very same `ApprovalGateDialog` the
 * orchestrator panel uses rather than leaving a quick-start user stranded
 * behind a gate they cannot see.
 *
 * Once the build completes the dialog offers "Play now": the status line
 * tells the user to press Play, and the only Play control lived in the
 * toolbar behind the modal (#10166).
 *
 * PF-1215 (#9338), golden-path item 4.
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Compass, Crosshair, Gamepad2, Loader2, Puzzle, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button, Dialog, Label, Textarea } from '@spawnforge/ui';
import { useEditorStore } from '@/stores/editorStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import Link from 'next/link';
import {
  INSUFFICIENT_TOKENS_MESSAGE,
  isOrchestratorRunLive,
  type OrchestratorStatus,
} from '@/stores/slices/orchestratorSlice';
import { SETTINGS_BILLING_HREF } from '@/lib/navigation/settingsRoutes';
import {
  QUICK_START_GAME_TYPES,
  buildQuickStartPrompt,
  findQuickStartGameType,
  quickStartPromptMaxLength,
  type QuickStartGameType,
} from '@/lib/game-creation/quickStart';
import type { ApprovalGate } from '@/lib/game-creation/types';
import { ApprovalGateDialog } from '@/components/editor/ApprovalGateDialog';
import { TokenCostBar } from '@/components/editor/TokenCostBar';
import { claimQuickStartGate } from '@/components/editor/quickStartGateOwner';

/**
 * Icons live here, not in `lib/game-creation/quickStart.ts`: that module is
 * reachable from an API route, and a value import of a React component would
 * drag a client-only module into a server graph (`serverSafeImports.test.ts`).
 */
const GAME_TYPE_ICONS: Record<QuickStartGameType, LucideIcon> = {
  platformer: Gamepad2,
  shooter: Crosshair,
  puzzle: Puzzle,
  explorer: Compass,
};

const STATUS_MESSAGES: Record<OrchestratorStatus, string> = {
  idle: 'Getting ready…',
  decomposing: 'Designing your game…',
  planning: 'Working out the build order…',
  awaiting_approval: 'Waiting on your approval…',
  executing: 'Building your game…',
  completed: 'Your game is ready — press Play.',
  failed: 'The build stopped early.',
  cancelled: 'Build cancelled.',
};

const GENERIC_FAILURE = 'Could not start building your game. Please try again.';

/** Status line while the designed plan waits for the user's "Build it". */
const PLAN_READY = 'Your game plan is ready. Review it, then build.';

/** Status line between "Build it" and the run reporting 'executing'. */
const STARTING_BUILD = 'Starting the build…';

/** Status line for a plan whose build was refused before any step ran. */
const BUILD_NOT_STARTED = 'The build did not start.';

/**
 * Stand-in for a plan with no `gate_plan`. `planBuilder` always adds one, but
 * the plan is caller-supplied data (`setPlan` is public), and a missing gate
 * must not leave a designed plan with no "Build it" control at all.
 */
const FALLBACK_PLAN_GATE: ApprovalGate = {
  id: 'gate_plan',
  label: 'Review your game plan',
  description: 'Check the plan and its cost before building starts.',
  afterStepId: '',
  status: 'pending',
  displayData: {},
};

/**
 * Shown when "Plan my game" is pressed while a run is already live. The slice
 * refuses (it would clear the live run's plan, gates and abort controller), so
 * the user has to be told why nothing new started.
 */
const ALREADY_RUNNING = 'A build is already running. Wait for it to finish, or stop it first.';

type Phase = 'pick' | 'describe' | 'running';

export interface QuickStartDialogProps {
  open: boolean;
  onClose: () => void;
}

export function QuickStartDialog({ open, onClose }: QuickStartDialogProps) {
  // Lazily initialised rather than a bare 'pick': the dialog can mount already
  // open while a run from a previous mount is still live, and 'pick' would put
  // "Plan my game" in front of a user whose second run the slice refuses.
  const [phase, setPhase] = useState<Phase>(() =>
    open && isOrchestratorRunLive(useEditorStore.getState().orchestratorStatus)
      ? 'running'
      : 'pick',
  );
  const [selectedId, setSelectedId] = useState<QuickStartGameType | null>(null);
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  // True from the plan review's "Build it" until that run settles: it disables
  // the button for the whole run. The slice refuses a second start of the same
  // plan on its own (`_inFlightPlan`), so this is the visible half of that
  // guard, not the only one. It must not drive the status line; see
  // `startingBuild`.
  const [confirming, setConfirming] = useState(false);

  const promptRef = useRef<HTMLTextAreaElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const runningRef = useRef<HTMLDivElement>(null);
  const firstCardRef = useRef<HTMLButtonElement>(null);
  const playNowRef = useRef<HTMLButtonElement>(null);
  const prevPhaseRef = useRef<Phase | null>(null);

  const status = useEditorStore((s) => s.orchestratorStatus);
  const pendingGate = useEditorStore((s) => s.pendingGate);
  const resolveGate = useEditorStore((s) => s.resolveGate);
  const cancelPipeline = useEditorStore((s) => s.cancelPipeline);
  const currentPlan = useEditorStore((s) => s.currentPlan);
  const tokenEstimate = useEditorStore((s) => s.tokenEstimate);
  const runPipelineFromPlan = useEditorStore((s) => s.runPipelineFromPlan);
  const orchestratorError = useEditorStore((s) => s.orchestratorError);
  const play = useEditorStore((s) => s.play);

  const runIsLive = isOrchestratorRunLive(status);
  // 'awaiting_approval' with no pending gate is the moment between design and
  // build: mid-run gates always set `pendingGate` (see `onGateReached`).
  const planGate =
    status === 'awaiting_approval' && !pendingGate && currentPlan
      ? currentPlan.approvalGates.find((g) => g.id === 'gate_plan') ?? FALLBACK_PLAN_GATE
      : null;
  // "Starting the build…" covers only the gap between the click and the run
  // reporting 'executing'. `confirming` itself stays true until the whole run
  // settles (it guards the click), so it must not drive the status line:
  // "Building your game…" and the mid-run gates' "Waiting on your approval…"
  // have to show, and be announced, while the build goes on.
  const startingBuild = confirming && planGate !== null;
  // A build refused before any step ran (its reservation was declined, or the
  // engine was not ready) returns the plan to the review with the reason on
  // the store. It is shown ON the review, so it survives the dialog closing,
  // a reload of this component, and a trip to billing and back (#6831).
  const reviewError = planGate ? orchestratorError : null;

  // While this dialog is open it is the only place the user can reach a gate
  // (it is modal and covers the orchestrator panel), so it owns the gate UI.
  useEffect(() => {
    if (!open) return undefined;
    return claimQuickStartGate();
  }, [open]);

  // Reopening starts a fresh run; leaving the previous prompt and error on
  // screen would read as state belonging to whatever is happening now.
  //
  // Unless a run is still live: this dialog can be closed mid-run, and resetting
  // to 'pick' put "Plan my game" back in front of the user, whose second run the
  // slice now refuses. Resume the running view instead, which is also where the
  // pending gate is rendered.
  //
  // Adjusted DURING RENDER, not in an effect: an effect would paint the previous
  // run's prompt and error for one frame before clearing them, and calling
  // setState synchronously in an effect body is what `set-state-in-effect`
  // rejects. React re-runs this render before committing, so nothing downstream
  // ever observes the stale values. Same shape as FeedbackDialog.
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) {
      setError(null);
      setStarting(false);
      setConfirming(false);
      if (isOrchestratorRunLive(useEditorStore.getState().orchestratorStatus)) {
        setPhase('running');
      } else {
        setPhase('pick');
        setSelectedId(null);
        setPrompt('');
      }
    }
  }

  // Every phase change unmounts the element that was focused (the card on
  // pick->describe, "Plan my game" on describe->running), which drops focus to
  // document.body inside an aria-modal region. Move it explicitly.
  //
  // Except when the build view already placed focus itself: a plan review or
  // gate that mounts in the SAME commit as the phase change focuses its own
  // primary button first (child effects run before this parent effect), and
  // pulling focus back to the status line would undo it. That happens whenever
  // the design finishes before React commits the phase change.
  useEffect(() => {
    const previous = prevPhaseRef.current;
    prevPhaseRef.current = phase;
    if (previous === null || previous === phase) return;
    if (phase === 'describe') promptRef.current?.focus();
    else if (phase === 'running') {
      const active = document.activeElement;
      if (!(active && runningRef.current?.contains(active))) statusRef.current?.focus();
    } else firstCardRef.current?.focus();
  }, [phase]);

  // The plan review and the approval gates own the focused button while they
  // are up, and each one unmounts the moment it is answered ("Build it" moves
  // the run to 'executing', Approve resolves the gate). That drops focus to
  // document.body inside an aria-modal region, and the phase effect above does
  // not fire because the phase stays 'running'. Hand focus to the live status
  // line, unless something else in the build view already took it.
  const askingUser = planGate !== null || pendingGate !== null;
  const wasAskingRef = useRef(false);
  useEffect(() => {
    const was = wasAskingRef.current;
    wasAskingRef.current = askingUser;
    if (!was || askingUser || phase !== 'running') return;
    const active = document.activeElement;
    if (!(active && active !== document.body && runningRef.current?.contains(active))) {
      statusRef.current?.focus();
    }
  }, [askingUser, phase]);

  // "Play now" appears when the run completes, which is the moment the user
  // has been waiting for: put focus on it so Enter plays. Declared after the
  // phase effect so it wins when both fire in the same commit.
  useEffect(() => {
    if (phase === 'running' && status === 'completed') playNowRef.current?.focus();
  }, [phase, status]);

  const selected = findQuickStartGameType(selectedId);
  const promptMax = selected ? quickStartPromptMaxLength(selected) : 0;

  const handlePick = useCallback((id: QuickStartGameType) => {
    setSelectedId(id);
    setError(null);
    setPhase('describe');
  }, []);

  const handleSubmit = useCallback(async () => {
    const card = findQuickStartGameType(selectedId);
    if (!card) {
      setError('Pick a game type first.');
      setPhase('pick');
      return;
    }

    setError(null);
    setStarting(true);
    setPhase('running');

    try {
      // The orchestrator panel owns the later approval gates, so it has to be
      // on screen before the run starts (mirrors chatStore's game-creation path).
      useWorkspaceStore.getState().openPanel('orchestrator');
      const editor = useEditorStore.getState();
      const started = await editor.startQuickStart(
        buildQuickStartPrompt(card, prompt),
        editor.projectType
      );

      // Refused: a run was already live and starting a second one would have
      // orphaned it. Nothing changed, so say so rather than showing a build view.
      if (!started) {
        setPhase('describe');
        setError(ALREADY_RUNNING);
        toast.error(ALREADY_RUNNING);
        return;
      }

      // `startDecomposition` records its failures on the store rather than
      // throwing. (A step that fails mid-run does the same, which is why
      // `handleConfirmBuild` below repeats this check after the build:
      // `runPipelineFromPlan`'s `onPlanStatusChange` callback sets
      // `orchestratorStatus: 'failed'` without ever touching
      // `orchestratorError` -- that field is reserved for a genuine throw
      // (see the design-intent comment on `OrchestratorPanel`'s `StepItem`,
      // PF-1224). Checking `orchestratorError` alone left the dialog stuck on
      // the common case of a normal step failure: `error` here stayed null,
      // so neither "Try again" nor "Stop" rendered and only "Close" was
      // left, with no way back into the flow short of closing and reopening
      // the dialog. Read `status` instead, and fall back to a generic
      // message when the store has no more specific one.)
      const state = useEditorStore.getState();
      if (state.orchestratorStatus === 'failed') {
        const message = state.orchestratorError ?? GENERIC_FAILURE;
        setError(message);
        toast.error(message);
      }
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : GENERIC_FAILURE;
      setError(message);
      toast.error(message);
    } finally {
      setStarting(false);
    }
  }, [prompt, selectedId]);

  // The plan review's "Build it": the first point at which build tokens are
  // spent. Failures land on the store, not as throws (same contract as
  // `handleSubmit` above), so read the status the run left behind.
  const handleConfirmBuild = useCallback(async () => {
    setError(null);
    setConfirming(true);
    try {
      await runPipelineFromPlan();
      const state = useEditorStore.getState();
      if (state.orchestratorStatus === 'failed') {
        const message = state.orchestratorError ?? GENERIC_FAILURE;
        setError(message);
        toast.error(message);
      } else if (state.orchestratorStatus === 'awaiting_approval' && state.orchestratorError) {
        // Refused before it started: the review shows the reason itself.
        toast.error(state.orchestratorError);
      }
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : GENERIC_FAILURE;
      setError(message);
      toast.error(message);
    } finally {
      setConfirming(false);
    }
  }, [runPipelineFromPlan]);

  const handleRetry = useCallback(() => {
    setError(null);
    setPhase('describe');
  }, []);

  const handleCancelRun = useCallback(() => {
    cancelPipeline();
    onClose();
  }, [cancelPipeline, onClose]);

  // Close whichever way play() went. A refusal (the winnability gate, or no
  // engine) has already opened the chat overlay with its explanation, and
  // that overlay and this Dialog are both z-50 modals listening for Escape,
  // so keeping the dialog open would stack two. `engineMode` only moves when
  // the engine emits ENGINE_MODE_CHANGED, so it is never set from here.
  const handlePlayNow = useCallback(() => {
    play();
    onClose();
  }, [play, onClose]);

  if (!open) return null;

  const actions =
    phase === 'describe' ? (
      <>
        <Button variant="ghost" size="sm" onClick={() => setPhase('pick')}>
          Back
        </Button>
        <Button size="sm" onClick={handleSubmit} disabled={starting || runIsLive}>
          Plan my game
        </Button>
      </>
    ) : phase === 'running' ? (
      <>
        {error && (
          <Button variant="outline" size="sm" onClick={handleRetry}>
            Try again
          </Button>
        )}
        {/* Only while there is something to stop: cancelPipeline after a run
            has completed or failed flips the status to 'cancelled' and re-POSTs
            the token release. Mirrors OrchestratorPanel's footer guard. */}
        {/* The plan review carries its own "Discard plan", which does the same thing;
            a second one beside it would be two controls for one action. */}
        {runIsLive && !planGate && (
          <Button variant="ghost" size="sm" onClick={handleCancelRun}>
            Stop
          </Button>
        )}
        {status === 'completed' && (
          <Button
            ref={playNowRef}
            size="sm"
            data-testid="quick-start-play-now"
            onClick={handlePlayNow}
          >
            Play now
          </Button>
        )}
        <Button variant={status === 'completed' ? 'ghost' : undefined} size="sm" onClick={onClose}>
          Close
        </Button>
      </>
    ) : (
      <Button variant="ghost" size="sm" onClick={onClose}>
        Cancel
      </Button>
    );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Make me a game"
      description={
        phase === 'pick'
          ? 'Pick a kind of game. We build a playable scene from there.'
          : phase === 'describe'
            ? 'Describe it in your own words, or leave it blank for our take.'
            : planGate && !startingBuild
              ? reviewError
                ? 'Nothing was spent. Build it again when you are ready, or discard the plan. Close keeps it for later.'
                : 'The build starts, and its tokens are taken, only when you press Build it. Close keeps this plan for later.'
              : status === 'completed'
                ? 'Your game is built.'
                : status === 'failed' || status === 'cancelled'
                  ? 'Nothing is running now.'
                  : 'Building. You can keep working while this runs.'
      }
      className="max-w-lg"
      actions={actions}
    >
      {phase === 'pick' && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {QUICK_START_GAME_TYPES.map((card, index) => {
            const Icon = GAME_TYPE_ICONS[card.id];
            return (
              <button
                key={card.id}
                ref={index === 0 ? firstCardRef : undefined}
                type="button"
                onClick={() => handlePick(card.id)}
                className="flex items-start gap-3 rounded-[var(--sf-radius-md)] border border-[var(--sf-border)] bg-[var(--sf-bg-app)] p-3 text-left transition-colors hover:border-[var(--sf-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sf-accent)]"
              >
                {/* The accent is a theme token handed in as a CSS variable, so
                    the icon follows all seven themes; `color` is never set to a
                    literal here (see `accentToken`). */}
                <Icon
                  className="mt-0.5 h-5 w-5 shrink-0 text-[var(--qs-accent)]"
                  style={{ '--qs-accent': card.accentToken } as CSSProperties}
                  aria-hidden="true"
                />
                <span>
                  <span className="block text-sm font-medium text-[var(--sf-text)]">
                    {card.label}
                  </span>
                  <span className="block text-xs text-[var(--sf-text-secondary)]">
                    {card.description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {phase === 'describe' && selected && (
        <div className="space-y-2">
          <Label htmlFor="quick-start-prompt">
            What happens in your {selected.label.toLowerCase()}?
          </Label>
          <Textarea
            ref={promptRef}
            id="quick-start-prompt"
            rows={4}
            value={prompt}
            maxLength={promptMax}
            aria-describedby="quick-start-prompt-count"
            placeholder={selected.placeholder}
            onChange={(e) => setPrompt(e.target.value)}
          />
          {/* /api/game/decompose rejects a COMPOSED prompt over 1000 chars, and
              the composed prompt carries this card's label prefix. Capping here
              is what stops a bare `validation_error` arriving after the user has
              already committed to the build. */}
          <p
            id="quick-start-prompt-count"
            className="text-right text-xs text-[var(--sf-text-muted)]"
          >
            {prompt.length} / {promptMax}
          </p>
        </div>
      )}

      {phase === 'running' && (
        <div ref={runningRef} className="space-y-3">
          <div
            ref={statusRef}
            tabIndex={-1}
            role="status"
            aria-live="polite"
            className="flex items-center gap-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sf-accent)]"
          >
            {(starting || startingBuild || status === 'decomposing' || status === 'planning' || status === 'executing') && (
              <Loader2 className="h-4 w-4 animate-spin text-[var(--sf-accent)]" aria-hidden="true" />
            )}
            <span>
              {startingBuild
                ? STARTING_BUILD
                : planGate
                  ? reviewError
                    ? BUILD_NOT_STARTED
                    : PLAN_READY
                  : STATUS_MESSAGES[status]}
            </span>
          </div>

          {/* Plan review. "Build it" is where the build's tokens are reserved,
              and the server's answer to that reservation is the real balance
              check: `sufficientBalance` reads a cached client balance, so it
              does not disable the button (the orchestrator panel's Start
              Building makes the same choice). A refused reservation comes back
              as an error here, with nothing spent. */}
          {planGate && (
            <ApprovalGateDialog
              gate={planGate}
              approveLabel="Build it"
              approveDisabled={confirming}
              onApprove={() => void handleConfirmBuild()}
              onCancel={handleCancelRun}
              cancelLabel="Discard plan"
              autoFocus
            >
              {reviewError && (
                <div
                  role="alert"
                  className="mb-3 rounded-[var(--sf-radius-md)] border border-[var(--sf-destructive)] bg-[color-mix(in_srgb,var(--sf-destructive)_12%,transparent)] px-3 py-2 text-xs text-[var(--sf-text)]"
                >
                  {reviewError}
                  {reviewError === INSUFFICIENT_TOKENS_MESSAGE && (
                    <>
                      {' '}
                      <Link href={SETTINGS_BILLING_HREF} className="underline underline-offset-2">
                        Buy tokens
                      </Link>
                    </>
                  )}
                </div>
              )}
              {tokenEstimate && <TokenCostBar estimate={tokenEstimate} />}
            </ApprovalGateDialog>
          )}

          {/* A gate_assets list is as long as the plan makes it. ApprovalGateDialog
              already bounds its own scrollable body to max-h-[50vh] and renders
              Approve/Cancel OUTSIDE that scroll region, so those buttons are never
              pushed off-screen. A second `max-h-[45vh] overflow-y-auto` wrapper
              here previously clipped the WHOLE dialog (heading, description, and
              action row included) to a bound smaller than the inner one — the
              outer scrollbar always engaged first, the inner max-h-[50vh] region
              could never reach its own limit, and the buttons scrolled out of
              view again inside the outer box (round 2 review, 4/5 agreement). */}
          {pendingGate && (
            <ApprovalGateDialog
              gate={pendingGate}
              onApprove={() => resolveGate('approved')}
              onCancel={() => resolveGate('rejected')}
              autoFocus
            />
          )}
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mt-3 rounded-[var(--sf-radius-md)] border border-[var(--sf-destructive)] bg-[color-mix(in_srgb,var(--sf-destructive)_12%,transparent)] px-3 py-2 text-xs text-[var(--sf-text)]"
        >
          {error}
        </div>
      )}
    </Dialog>
  );
}
