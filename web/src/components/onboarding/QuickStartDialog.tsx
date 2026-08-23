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

import { useCallback, useEffect, useState } from 'react';
import { Compass, Crosshair, Gamepad2, Loader2, Puzzle, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button, Dialog, Label, Textarea } from '@spawnforge/ui';
import { useEditorStore } from '@/stores/editorStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type { OrchestratorStatus } from '@/stores/slices/orchestratorSlice';
import {
  QUICK_START_GAME_TYPES,
  buildQuickStartPrompt,
  findQuickStartGameType,
  type QuickStartGameType,
} from '@/lib/game-creation/quickStart';
import { ApprovalGateDialog } from '@/components/editor/ApprovalGateDialog';

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

  const status = useEditorStore((s) => s.orchestratorStatus);
  const pendingGate = useEditorStore((s) => s.pendingGate);
  const resolveGate = useEditorStore((s) => s.resolveGate);
  const cancelPipeline = useEditorStore((s) => s.cancelPipeline);

  // Reopening starts a fresh run; leaving the previous prompt and error on
  // screen would read as state belonging to whatever is happening now.
  useEffect(() => {
    if (!open) return;
    setPhase('pick');
    setSelectedId(null);
    setPrompt('');
    setError(null);
    setStarting(false);
  }, [open]);

  const selected = findQuickStartGameType(selectedId);

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
      await editor.startQuickStart(buildQuickStartPrompt(card, prompt), editor.projectType);

      // `startDecomposition` records its failures on the store rather than
      // throwing, so without this read a failed run would show as a silent stall.
      const failure = useEditorStore.getState().orchestratorError;
      if (failure) {
        setError(failure);
        toast.error(failure);
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
        <Button size="sm" onClick={handleSubmit} disabled={starting}>
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
        <Button variant="ghost" size="sm" onClick={handleCancelRun}>
          Stop
        </Button>
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
          {QUICK_START_GAME_TYPES.map((card) => {
            const Icon = GAME_TYPE_ICONS[card.id];
            return (
              <button
                key={card.id}
                type="button"
                onClick={() => handlePick(card.id)}
                className="flex items-start gap-3 rounded-[var(--sf-radius-md)] border border-[var(--sf-border)] bg-[var(--sf-bg-app)] p-3 text-left transition-colors hover:border-[var(--sf-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sf-accent)]"
              >
                <Icon
                  className="mt-0.5 h-5 w-5 shrink-0"
                  style={{ color: card.accentColor }}
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
            id="quick-start-prompt"
            rows={4}
            value={prompt}
            placeholder={selected.placeholder}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </div>
      )}

      {phase === 'running' && (
        <div className="space-y-3">
          <div role="status" aria-live="polite" className="flex items-center gap-2 text-sm">
            {(starting || status === 'decomposing' || status === 'planning' || status === 'executing') && (
              <Loader2 className="h-4 w-4 animate-spin text-[var(--sf-accent)]" aria-hidden="true" />
            )}
            <span>{STATUS_MESSAGES[status]}</span>
          </div>

          {pendingGate && (
            <ApprovalGateDialog
              gate={pendingGate}
              onApprove={() => resolveGate('approved')}
              onCancel={() => resolveGate('rejected')}
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
