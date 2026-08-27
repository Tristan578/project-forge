'use client';

/**
 * OrchestratorPanel — displays game creation pipeline progress.
 *
 * Reads from orchestratorSlice to show:
 * - Current pipeline status
 * - Step list with status indicators
 * - Token cost estimate
 * - Approval gate dialogs
 * - Cancel button
 *
 * Spec: specs/2026-04-12-e1-pipeline-integration.md (Deliverable 4)
 */

import { useCallback } from 'react';
import { cn } from '@spawnforge/ui';
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  SkipForward,
  Play,
  Square,
  Sparkles,
  AlertTriangle,
} from 'lucide-react';
import { useEditorStore } from '@/stores/editorStore';
import type { OrchestratorStatus } from '@/stores/slices/orchestratorSlice';
import type { PlanStep, TokenEstimate, ExecutorName } from '@/lib/game-creation/types';
import { ApprovalGateDialog } from './ApprovalGateDialog';
import { useQuickStartOwnsGate } from './quickStartGateOwner';
import { useResponsiveLayout } from '@/hooks/useResponsiveLayout';

// ---------------------------------------------------------------------------
// Executor name -> user-friendly label
// ---------------------------------------------------------------------------

/**
 * `Record<ExecutorName, …>`, not `Record<string, …>`: the map was missing
 * `camera_setup` and that step rendered its raw executor name to the user, which
 * a permissive index signature can never catch. Keyed by the union, an added
 * executor fails `tsc` here until it has a label.
 */
const STEP_LABELS: Record<ExecutorName, string> = {
  plan_present: 'Presenting plan',
  scene_create: 'Creating scene',
  physics_enable: 'Making things solid',
  physics_profile: 'Setting up physics',
  camera_setup: 'Positioning camera',
  character_setup: 'Building characters',
  game_component: 'Adding game rules',
  entity_setup: 'Setting up entities',
  world_build: 'Building the world',
  asset_generate: 'Generating assets',
  custom_script_generate: 'Writing scripts',
  verify_all_scenes: 'Verifying scenes',
  auto_polish: 'Polishing game',
};

function getStepLabel(executor: string): string {
  return Object.hasOwn(STEP_LABELS, executor)
    ? STEP_LABELS[executor as ExecutorName]
    : executor;
}

/**
 * The one red this panel uses to say "this failed".
 *
 * There are two failure surfaces here — the plan-level banner and the per-step
 * alert under a failed step — and they were drawn in two different reds
 * (`red-800/950-50/300` against `red-900-60/950-40/200`), close enough to read
 * as a rendering bug rather than a distinction. Geometry stays at each call
 * site, since the banner is a block of body text and the step alert is a small
 * annotation; only the colour is shared, because the colour is the meaning.
 *
 * Built off `--sf-destructive` (`packages/ui/src/tokens/colors.ts`) rather than
 * a raw `red-*` Tailwind shade, so a theme swap recolours the failure surface
 * along with everything else instead of leaving one hardcoded red behind. This
 * panel supports all seven `ThemeName`s, and as of PF-1229 it holds no
 * hardcoded colour at all — the `zinc-*`/`amber-*`/`blue-*` literals that used
 * to sit alongside these tokens were dark-palette assumptions that a theme
 * switch could not reach.
 *
 * The border and background legitimately use `--sf-destructive` — a border
 * only needs WCAG 1.4.11's 3:1 non-text floor (pinned by the `NONTEXT_PAIRS`
 * test in `packages/ui/src/tokens/__tests__/themes.test.ts`), and the
 * background is decorative, painted at 10% alpha. The BODY TEXT is different:
 * it needs WCAG AA's 4.5:1 text floor, and `--sf-destructive` itself only
 * clears 3:1 — pairing it with its own 10%-alpha tint failed AA in several
 * themes (as low as ~2.9:1 in rust). There is no `--sf-destructive-foreground`
 * token in the design system, so this uses `--sf-text` instead — the ordinary
 * text-color token, already proven >= 4.5:1 against solid `--sf-bg-surface`,
 * and re-pinned here against the actual blended 10%-alpha destructive tint by
 * the `<theme> theme: --sf-destructive/10 tint keeps OrchestratorPanel body
 * text at WCAG AA` case in the same `themes.test.ts` file. That pin runs over
 * every semantic token this panel tints at 10% (destructive, warning, accent,
 * success) x every theme, so adding a fifth tinted surface means adding its
 * token to `SEMANTIC_TINT_TOKENS` there.
 *
 * That pin is only honest because BOTH of this component's return branches
 * paint an opaque `bg-[var(--sf-bg-surface)]` themselves. A `/10` Tailwind
 * modifier composites over whatever is actually painted behind it, and this
 * panel is mounted by `WorkspaceProvider`'s `withSuspense` wrapper inside a
 * hardcoded `bg-zinc-900` host that every other (dark-only) lazy panel
 * depends on. Without a background of our own, the tint would blend over
 * #18181b in all seven themes while the test graded it against
 * `--sf-bg-surface` — and in the `light` theme `--sf-text` IS #18181b, i.e.
 * ~1.06:1, unreadable. Painting the surface here is what makes the rendered
 * contrast match the pinned contrast; do not remove it (PF-1229 finding #1).
 *
 * The border is painted at FULL opacity, not the `/40` it used to carry, and
 * that is a contrast requirement rather than a style preference. A Tailwind
 * `/N` modifier paints a COMPOSITED colour, so pinning the raw token pins a
 * colour nobody sees. Measured across all seven themes, `--sf-destructive/40`
 * against `--sf-bg-surface` lands between 1.44 (rust) and 1.94 (ice) -- far
 * under the 3:1 WCAG 1.4.11 floor for a non-text boundary. At full opacity the
 * same edge is 3.14 (rust) to 5.44 (ice), and the painted colour IS the token,
 * so `NONTEXT_PAIRS` in `themes.test.ts` grades what is actually rendered.
 *
 * The graded adjacency is the OUTER edge, against `--sf-bg-surface`. The inner
 * edge -- border against its own `/10` tint -- is unsatisfiable by any alpha in
 * this palette (rust destructive tops out at 2.95 at full opacity), and it does
 * not need to be: the callout's state is carried by its `AlertTriangle` icon
 * and its `--sf-text` copy, so the border is decoration, not the sole state
 * indicator that 1.4.11 governs.
 */
const ERROR_SURFACE_CLASSES = cn(
  'border border-[var(--sf-destructive)]',
  'bg-[var(--sf-destructive)]/10',
  'text-[var(--sf-text)]',
);

/**
 * The warning counterpart, built the same way and for the same reason.
 *
 * Every amber surface in this panel used to be a dark-theme literal
 * (`border-amber-800 bg-amber-950/40 text-amber-200` and friends), so it
 * neither followed a theme switch nor stayed legible once the panel root
 * started painting `--sf-bg-surface`. Sharing ONE constant with the two
 * inline `bg-[var(--sf-warning)]/10 text-[var(--sf-text)]` rows below is what
 * makes the reviewer's requirement hold: the warning tile and the error tile
 * that sit side by side now respond to a theme switch identically, because
 * they are the same construction over two different semantic tokens.
 *
 * The border is full-opacity for the same measured reason as the error
 * surface above: `--sf-warning/40` against `--sf-bg-surface` runs 1.60 (light)
 * to 2.74 (ember), and full opacity runs 3.63 (light) to 10.06 (ember).
 *
 * `--sf-warning` is pinned >= 3:1 against the surfaces as a non-text colour by
 * `NONTEXT_PAIRS`, and `--sf-text` is re-pinned >= 4.5:1 against the blended
 * 10%-alpha warning tint by `TINT_CASES` -- both in `themes.test.ts`.
 */
const WARNING_SURFACE_CLASSES = cn(
  'border border-[var(--sf-warning)]',
  'bg-[var(--sf-warning)]/10',
  'text-[var(--sf-text)]',
);

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<OrchestratorStatus, string> = {
  idle: 'Ready',
  decomposing: 'Analyzing prompt...',
  planning: 'Building plan...',
  awaiting_approval: 'Waiting for approval',
  executing: 'Building game...',
  completed: 'Game complete!',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

function StatusBadge({ status }: { status: OrchestratorStatus }) {
  const colorClasses: Record<OrchestratorStatus, string> = {
    idle: 'bg-[var(--sf-bg-elevated)] text-[var(--sf-text)]',
    decomposing: 'bg-[var(--sf-accent)]/10 text-[var(--sf-text)]',
    planning: 'bg-[var(--sf-accent)]/10 text-[var(--sf-text)]',
    awaiting_approval: 'bg-[var(--sf-warning)]/10 text-[var(--sf-text)]',
    executing: 'bg-[var(--sf-accent)]/10 text-[var(--sf-text)]',
    completed: 'bg-[var(--sf-success)]/10 text-[var(--sf-text)]',
    failed: 'bg-[var(--sf-destructive)]/10 text-[var(--sf-text)]',
    cancelled: 'bg-[var(--sf-bg-elevated)] text-[var(--sf-text)]',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
        colorClasses[status],
      )}
    >
      {(status === 'decomposing' || status === 'planning' || status === 'executing') && (
        <Loader2 className="h-3 w-3 animate-spin" />
      )}
      {status === 'completed' && <CheckCircle2 className="h-3 w-3" />}
      {status === 'failed' && <XCircle className="h-3 w-3" />}
      {STATUS_LABELS[status]}
    </span>
  );
}

// ---------------------------------------------------------------------------
// StepItem
// ---------------------------------------------------------------------------

/**
 * The ONLY thing that distinguishes one step's state from another's, so it owes
 * two things it did not used to carry.
 *
 * An accessible name (WCAG 1.1.1): the row next to it renders
 * `getStepLabel(step.executor)` and nothing else, so to a screen reader every
 * step read identically whether it had completed, failed or never started.
 * `role="img"` + `aria-label` is what puts the state into the accessibility
 * tree; `getByRole('img', { name: ... })` is what pins it.
 *
 * A non-colour difference between `pending` and `skipped` (WCAG 1.4.1): both
 * used the same `Clock` glyph at the same size, and their row labels share one
 * colour, so hue was the entire signal. `skipped` gets `SkipForward`.
 *
 * The two muted foregrounds are gone as well. As a non-text graphic an icon
 * needs 3:1 (WCAG 1.4.11), and against `--sf-bg-surface` `--sf-text-disabled`
 * measured 1.48 (light) to 2.89 (leaf) -- failing all seven -- while
 * `--sf-text-muted` measured 2.56 in light and sat under 3.2 in three more.
 * `--sf-text-secondary` clears it everywhere: 5.32 (mech) to 9.90 (leaf) on
 * `--sf-bg-surface`, 4.04 (ice) to 7.78 (leaf) on `--sf-bg-elevated`. The three
 * semantic foregrounds already cleared 3:1 unaided (success 3.30 light,
 * destructive 3.14 rust, accent 4.26 rust) and are unchanged.
 */
function StepStatusIcon({ status }: { status: PlanStep['status'] }) {
  switch (status) {
    case 'completed':
      return (
        <CheckCircle2
          role="img"
          aria-label="Completed"
          className="h-4 w-4 text-[var(--sf-success)]"
        />
      );
    case 'running':
      return (
        <Loader2
          role="img"
          aria-label="Running"
          className="h-4 w-4 animate-spin text-[var(--sf-accent)]"
        />
      );
    case 'failed':
      return (
        <XCircle
          role="img"
          aria-label="Failed"
          className="h-4 w-4 text-[var(--sf-destructive)]"
        />
      );
    case 'skipped':
      return (
        <SkipForward
          role="img"
          aria-label="Skipped"
          className="h-4 w-4 text-[var(--sf-text-secondary)]"
        />
      );
    case 'pending':
    default:
      return (
        <Clock
          role="img"
          aria-label="Pending"
          className="h-4 w-4 text-[var(--sf-text-secondary)]"
        />
      );
  }
}

function StepItem({
  step,
  status,
  pipelineStatus,
}: {
  step: PlanStep;
  status: PlanStep['status'];
  pipelineStatus: OrchestratorStatus;
}) {
  // Every executor composes a `userFacingErrorMessage` naming the next action a
  // user can take, and `runPipeline` records it on the step it failed. Until
  // PF-1224 nothing rendered it — a failed step was a red icon and a label, and
  // the remediation copy reached no one. `orchestratorError` above is a
  // different thing: it is only set when `runPipeline` itself throws.
  //
  // The internal `error.message` is deliberately NOT rendered; it carries
  // engine/command detail written for a developer.
  //
  // Presence of `step.error` is NOT the condition, because `runPipeline` writes
  // one on a step whose retries a CANCEL cut short (`cancelledMidRetry`) — the
  // step reads 'skipped', the plan reads 'cancelled', and rendering the message
  // there tells a user who deliberately pressed Stop that something went wrong
  // and to go fix it by hand. The three cases that DO deserve the alert are a
  // real failure ('failed'), an optional step that exhausted its retries, and a
  // required step skipped by `DEPENDENCY_FAILED` — the last two both read
  // 'skipped', which is why the plan status is what separates them from a
  // cancel rather than the step status alone.
  const isCancelled = pipelineStatus === 'cancelled';
  const failureMessage = !isCancelled && (status === 'failed' || status === 'skipped')
    ? step.error?.userFacingMessage
    : undefined;

  return (
    <div className="py-1.5 px-2 rounded text-sm">
      <div className="flex items-center gap-2">
        <StepStatusIcon status={status} />
        <span className={status === 'pending' || status === 'skipped'
            ? 'text-[var(--sf-text-secondary)]'
            : 'text-[var(--sf-text)]'}>
          {getStepLabel(step.executor)}
        </span>
        {step.optional && (
          <span className="ml-auto text-[10px] uppercase text-[var(--sf-text-secondary)]">optional</span>
        )}
      </div>
      {failureMessage && (
        <div
          role="alert"
          className={cn('mt-1 ml-6 rounded px-2 py-1 text-xs leading-snug', ERROR_SURFACE_CLASSES)}
        >
          {failureMessage}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TokenCostBar
// ---------------------------------------------------------------------------

function TokenCostBar({ estimate }: { estimate: TokenEstimate }) {
  return (
    <div className="rounded-md border border-[var(--sf-border)] bg-[var(--sf-bg-elevated)] p-3">
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="font-medium text-[var(--sf-text)]">Estimated token cost</span>
        <span className="font-mono text-[var(--sf-text)]">{estimate.totalEstimated}</span>
      </div>
      <div className="space-y-1">
        {estimate.breakdown.map((item) => (
          <div key={item.category} className="flex items-center justify-between text-[11px] text-[var(--sf-text)]">
            <span>{item.category}</span>
            <span className="font-mono">{item.estimatedTokens}</span>
          </div>
        ))}
      </div>
      {!estimate.sufficientBalance && (
        <div className="mt-2 flex items-center gap-1.5 rounded bg-[var(--sf-destructive)]/10 px-2 py-1 text-xs text-[var(--sf-text)]">
          <AlertTriangle className="h-3 w-3" />
          Insufficient token balance
        </div>
      )}
      {estimate.warningMessage && estimate.sufficientBalance && (
        <div className="mt-2 flex items-center gap-1.5 rounded bg-[var(--sf-warning)]/10 px-2 py-1 text-xs text-[var(--sf-text)]">
          <AlertTriangle className="h-3 w-3" />
          {estimate.warningMessage}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// OrchestratorPanel
// ---------------------------------------------------------------------------

export function OrchestratorPanel() {
  const status = useEditorStore((s) => s.orchestratorStatus);
  const plan = useEditorStore((s) => s.currentPlan);
  const stepStatuses = useEditorStore((s) => s.stepStatuses);
  const pendingGate = useEditorStore((s) => s.pendingGate);
  const tokenEstimate = useEditorStore((s) => s.tokenEstimate);
  const error = useEditorStore((s) => s.orchestratorError);
  const warnings = useEditorStore((s) => s.orchestratorWarnings);
  const resolveGate = useEditorStore((s) => s.resolveGate);
  const cancelPipeline = useEditorStore((s) => s.cancelPipeline);
  const runPipelineFromPlan = useEditorStore((s) => s.runPipelineFromPlan);
  const resetOrchestrator = useEditorStore((s) => s.resetOrchestrator);

  // The quick-start dialog is modal and covers this panel, so while it is open
  // it owns the gate; rendering a second copy here gave the same gate two
  // Approve buttons, the second landing on an already-answered gate.
  const quickStartOwnsGate = useQuickStartOwnsGate();
  const { mode } = useResponsiveLayout();

  const handleApprove = useCallback(() => {
    resolveGate('approved');
  }, [resolveGate]);

  const handleReject = useCallback(() => {
    resolveGate('rejected');
  }, [resolveGate]);

  const handleStartPipeline = useCallback(() => {
    void runPipelineFromPlan();
  }, [runPipelineFromPlan]);

  const handleCancel = useCallback(() => {
    cancelPipeline();
  }, [cancelPipeline]);

  const handleReset = useCallback(() => {
    resetOrchestrator();
  }, [resetOrchestrator]);

  // Idle state — nothing to show
  if (status === 'idle' && !plan) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--sf-bg-surface)] p-4 text-center text-sm text-[var(--sf-text-secondary)]">
        <div>
          <Sparkles aria-hidden="true" className="mx-auto mb-2 h-8 w-8 text-[var(--sf-text-secondary)]" />
          <p>No game creation in progress</p>
          {/* PF-1215: name the control that actually exists. "QuickStart" was
              not a label on anything in the editor — and on compact widths that
              control is the icon-only toolbar button, whose only "Make me a
              game" is its accessible name, so quoting the label there would
              point at text nobody can see. */}
          <p className="mt-1 text-xs">
            {mode === 'compact'
              ? 'Tap the sparkle button in the toolbar, or describe a game in AI chat'
              : 'Click \u201CMake me a game\u201D in the toolbar, or describe one in AI chat'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--sf-bg-surface)]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--sf-border)] px-3 py-2">
        <div className="flex items-center gap-2">
          <Sparkles aria-hidden="true" className="h-4 w-4 text-[var(--sf-accent)]" />
          <span className="text-sm font-medium text-[var(--sf-text)]">
            {plan?.gdd.title ?? 'Game Creation'}
          </span>
        </div>
        <StatusBadge status={status} />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Error display */}
        {error && (
          <div className={cn('rounded-md px-3 py-2 text-sm', ERROR_SURFACE_CLASSES)}>
            {error}
          </div>
        )}

        {/* Partially-applied steps. Amber, not red, and never replaces a step's
            success tick — the pipeline did keep going. But a camera that will
            never move has to be readable somewhere, or the tick is a lie. */}
        {warnings.length > 0 && (
          <div
            role="status"
            aria-live="polite"
            aria-label="Game creation warnings"
            className={cn('rounded-md px-3 py-2 text-sm', WARNING_SURFACE_CLASSES)}
          >
            <div className="mb-1 flex items-center gap-1.5 font-medium">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                {warnings.length === 1
                  ? '1 thing needs your attention'
                  : `${warnings.length} things need your attention`}
              </span>
            </div>
            <ul className="space-y-1">
              {warnings.map((warning, i) => (
                <li key={`${warning.stepId ?? 'plan'}-${i}`} className="text-xs leading-snug">
                  {/* A note about the plan itself (an empty `steps` slot) names
                      no step, so it gets no label rather than a fabricated one. */}
                  {warning.executor && (
                    <>
                      <span className="font-medium text-[var(--sf-text)]">{getStepLabel(warning.executor)}:</span>{' '}
                    </>
                  )}
                  {warning.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Token estimate */}
        {tokenEstimate && <TokenCostBar estimate={tokenEstimate} />}

        {/* Approval gate */}
        {pendingGate && !quickStartOwnsGate && (
          <ApprovalGateDialog
            gate={pendingGate}
            onApprove={handleApprove}
            onCancel={handleReject}
          />
        )}

        {/* Step list */}
        {plan && (
          <div className="space-y-0.5">
            <h4 className="mb-1 text-xs font-medium uppercase tracking-wider text-[var(--sf-text-secondary)]">
              Steps
            </h4>
            {/* `.map` skips a hole but NOT a `null`, and `plan` is
                caller-supplied via the public `setPlan` — so the slot is
                filtered by an explicit predicate rather than trusted. The gap
                itself is not silent: `runPipeline` records it on
                `plan.warnings`, which the warning list above renders. */}
            {plan.steps.filter((step): step is PlanStep => Boolean(step)).map((step) => (
              <StepItem
                key={step.id}
                step={step}
                status={stepStatuses[step.id] ?? step.status}
                pipelineStatus={status}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer actions */}
      <div className="border-t border-[var(--sf-border)] px-3 py-2">
        {status === 'awaiting_approval' && !pendingGate && (
          <button
            onClick={handleStartPipeline}
            className="flex w-full items-center justify-center gap-2 rounded bg-[var(--sf-accent-hover)] px-3 py-2 text-sm font-medium text-[var(--sf-on-accent)] transition-colors hover:bg-[var(--sf-accent-active)]"
          >
            <Play className="h-3.5 w-3.5" />
            Start Building
          </button>
        )}

        {(status === 'executing' || status === 'decomposing' || status === 'planning') && (
          <button
            onClick={handleCancel}
            className="flex w-full items-center justify-center gap-2 rounded bg-[var(--sf-bg-elevated)] px-3 py-2 text-sm font-medium text-[var(--sf-text)] transition-colors hover:bg-[var(--sf-bg-overlay)]"
          >
            <Square className="h-3.5 w-3.5" />
            Cancel
          </button>
        )}

        {(status === 'completed' || status === 'failed' || status === 'cancelled') && (
          <button
            onClick={handleReset}
            className="flex w-full items-center justify-center gap-2 rounded bg-[var(--sf-bg-elevated)] px-3 py-2 text-sm font-medium text-[var(--sf-text)] transition-colors hover:bg-[var(--sf-bg-overlay)]"
          >
            Start Over
          </button>
        )}
      </div>
    </div>
  );
}
