'use client';

/**
 * QuickStartDialog — the one visible "make me a game" entry point.
 *
 * Before this existed, `startDecomposition` could only be reached by typing
 * something the chat intent classifier happened to recognise (chatStore.ts), so
 * the product's headline capability had no control anywhere in the UI.
 *
 * Three states, in order: pick a game type -> describe it -> watch it build.
 * The run is started with `startQuickStart`, which auto-approves `gate_plan`
 * only — `gate_assets` / `gate_final` still stop the pipeline, so this dialog
 * renders the very same `ApprovalGateDialog` the orchestrator panel uses rather
 * than leaving a quick-start user stranded behind a gate they cannot see.
 *
 * PF-1215 (#9338), golden-path item 4.
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Compass, Crosshair, Gamepad2, Loader2, Puzzle, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button, Dialog, Label, Textarea } from '@spawnforge/ui';
import { useEditorStore } from '@/stores/editorStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import {
  isOrchestratorRunLive,
  type OrchestratorStatus,
} from '@/stores/slices/orchestratorSlice';
import {
  QUICK_START_GAME_TYPES,
  buildQuickStartPrompt,
  findQuickStartGameType,
  quickStartPromptMaxLength,
  type QuickStartGameType,
} from '@/lib/game-creation/quickStart';
import { ApprovalGateDialog } from '@/components/editor/ApprovalGateDialog';
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

/**
 * Shown when "Build it" is pressed while a run is already live. The slice
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
  const [phase, setPhase] = useState<Phase>('pick');
  const [selectedId, setSelectedId] = useState<QuickStartGameType | null>(null);
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const promptRef = useRef<HTMLTextAreaElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const firstCardRef = useRef<HTMLButtonElement>(null);
  const prevPhaseRef = useRef<Phase | null>(null);

  const status = useEditorStore((s) => s.orchestratorStatus);
  const pendingGate = useEditorStore((s) => s.pendingGate);
  const resolveGate = useEditorStore((s) => s.resolveGate);
  const cancelPipeline = useEditorStore((s) => s.cancelPipeline);

  const runIsLive = isOrchestratorRunLive(status);

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
  // to 'pick' put "Build it" back in front of the user, whose second run the
  // slice now refuses. Resume the running view instead, which is also where the
  // pending gate is rendered.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setStarting(false);
    if (isOrchestratorRunLive(useEditorStore.getState().orchestratorStatus)) {
      setPhase('running');
      return;
    }
    setPhase('pick');
    setSelectedId(null);
    setPrompt('');
  }, [open]);

  // Every phase change unmounts the element that was focused (the card on
  // pick->describe, "Build it" on describe->running), which drops focus to
  // document.body inside an aria-modal region. Move it explicitly.
  useEffect(() => {
    const previous = prevPhaseRef.current;
    prevPhaseRef.current = phase;
    if (previous === null || previous === phase) return;
    if (phase === 'describe') promptRef.current?.focus();
    else if (phase === 'running') statusRef.current?.focus();
    else firstCardRef.current?.focus();
  }, [phase]);

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
      // throwing, and a step that fails mid-run does the same:
      // `runPipelineFromPlan`'s `onPlanStatusChange` callback sets
      // `orchestratorStatus: 'failed'` without ever touching
      // `orchestratorError` -- that field is reserved for a genuine throw
      // (see the design-intent comment on `OrchestratorPanel`'s `StepItem`,
      // PF-1224). Checking `orchestratorError` alone left the dialog stuck on
      // the common case of a normal step failure: `error` here stayed null,
      // so neither "Try again" nor "Stop" rendered and only "Close" was
      // left, with no way back into the flow short of closing and reopening
      // the dialog. Read `status` instead, and fall back to a generic
      // message when the store has no more specific one.
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

  const handleRetry = useCallback(() => {
    setError(null);
    setPhase('describe');
  }, []);

  const handleCancelRun = useCallback(() => {
    cancelPipeline();
    onClose();
  }, [cancelPipeline, onClose]);

  if (!open) return null;

  const actions =
    phase === 'describe' ? (
      <>
        <Button variant="ghost" size="sm" onClick={() => setPhase('pick')}>
          Back
        </Button>
        <Button size="sm" onClick={handleSubmit} disabled={starting || runIsLive}>
          Build it
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
        {runIsLive && (
          <Button variant="ghost" size="sm" onClick={handleCancelRun}>
            Stop
          </Button>
        )}
        <Button size="sm" onClick={onClose}>
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
        <div className="space-y-3">
          <div
            ref={statusRef}
            tabIndex={-1}
            role="status"
            aria-live="polite"
            className="flex items-center gap-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sf-accent)]"
          >
            {(starting || status === 'decomposing' || status === 'planning' || status === 'executing') && (
              <Loader2 className="h-4 w-4 animate-spin text-[var(--sf-accent)]" aria-hidden="true" />
            )}
            <span>{STATUS_MESSAGES[status]}</span>
          </div>

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
