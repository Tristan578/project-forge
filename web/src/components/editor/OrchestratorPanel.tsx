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
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Play,
  Square,
  Sparkles,
  AlertTriangle,
} from 'lucide-react';
import { useEditorStore } from '@/stores/editorStore';
import type { OrchestratorStatus } from '@/stores/slices/orchestratorSlice';
import type { PlanStep, ApprovalGate, TokenEstimate } from '@/lib/game-creation/types';

// ---------------------------------------------------------------------------
// Executor name -> user-friendly label
// ---------------------------------------------------------------------------

const STEP_LABELS: Record<string, string> = {
  plan_present: 'Presenting plan',
  scene_create: 'Creating scene',
  physics_profile: 'Setting up physics',
  character_setup: 'Building characters',
  entity_setup: 'Setting up entities',
  asset_generate: 'Generating assets',
  custom_script_generate: 'Writing scripts',
  verify_all_scenes: 'Verifying scenes',
  auto_polish: 'Polishing game',
};

function getStepLabel(executor: string): string {
  return STEP_LABELS[executor] ?? executor;
}

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
    idle: 'bg-zinc-700 text-zinc-300',
    decomposing: 'bg-blue-900/50 text-blue-300',
    planning: 'bg-blue-900/50 text-blue-300',
    awaiting_approval: 'bg-amber-900/50 text-amber-300',
    executing: 'bg-blue-900/50 text-blue-300',
    completed: 'bg-green-900/50 text-green-300',
    failed: 'bg-red-900/50 text-red-300',
    cancelled: 'bg-zinc-700 text-zinc-400',
  };

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${colorClasses[status]}`}>
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

function StepStatusIcon({ status }: { status: PlanStep['status'] }) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="h-4 w-4 text-green-400" />;
    case 'running':
      return <Loader2 className="h-4 w-4 animate-spin text-blue-400" />;
    case 'failed':
      return <XCircle className="h-4 w-4 text-red-400" />;
    case 'skipped':
      return <Clock className="h-4 w-4 text-zinc-500" />;
    case 'pending':
    default:
      return <Clock className="h-4 w-4 text-zinc-600" />;
  }
}

function StepItem({
  step,
  status,
}: {
  step: PlanStep;
  status: PlanStep['status'];
}) {
  return (
    <div className="flex items-center gap-2 py-1.5 px-2 rounded text-sm">
      <StepStatusIcon status={status} />
      <span className={status === 'pending' || status === 'skipped' ? 'text-zinc-500' : 'text-zinc-200'}>
        {getStepLabel(step.executor)}
      </span>
      {step.optional && (
        <span className="ml-auto text-[10px] text-zinc-500 uppercase">optional</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TokenCostBar
// ---------------------------------------------------------------------------

function TokenCostBar({ estimate }: { estimate: TokenEstimate }) {
  return (
    <div className="rounded-md border border-zinc-700 bg-zinc-800/50 p-3">
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="font-medium text-zinc-300">Estimated token cost</span>
        <span className="font-mono text-zinc-200">{estimate.totalEstimated}</span>
      </div>
      <div className="space-y-1">
        {estimate.breakdown.map((item) => (
          <div key={item.category} className="flex items-center justify-between text-[11px] text-zinc-400">
            <span>{item.category}</span>
            <span className="font-mono">{item.estimatedTokens}</span>
          </div>
        ))}
      </div>
      {!estimate.sufficientBalance && (
        <div className="mt-2 flex items-center gap-1.5 rounded bg-red-950/50 px-2 py-1 text-xs text-red-300">
          <AlertTriangle className="h-3 w-3" />
          Insufficient token balance
        </div>
      )}
      {estimate.warningMessage && estimate.sufficientBalance && (
        <div className="mt-2 flex items-center gap-1.5 rounded bg-amber-950/50 px-2 py-1 text-xs text-amber-300">
          <AlertTriangle className="h-3 w-3" />
          {estimate.warningMessage}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ApprovalGateDialog
// ---------------------------------------------------------------------------

function ApprovalGateDialog({
  gate,
  onApprove,
  onCancel,
}: {
  gate: ApprovalGate;
  onApprove: () => void;
  onCancel: () => void;
}) {
  const { displayData } = gate;

  return (
    <div className="rounded-md border border-amber-800/50 bg-amber-950/30 p-4">
      <h4 className="mb-1 text-sm font-semibold text-amber-200">{gate.label}</h4>
      <p className="mb-3 text-xs text-zinc-400">{gate.description}</p>

      {/* Scene summaries */}
      {displayData.sceneSummaries && displayData.sceneSummaries.length > 0 && (
        <div className="mb-3 space-y-1">
          <h5 className="text-xs font-medium text-zinc-300">Scenes</h5>
          {displayData.sceneSummaries.map((scene) => (
            <div key={scene.name} className="rounded bg-zinc-800/50 px-2 py-1 text-xs text-zinc-400">
              <span className="text-zinc-200">{scene.name}</span>
              <span className="ml-2">({scene.entityCount} entities)</span>
            </div>
          ))}
        </div>
      )}

      {/* Asset list */}
      {displayData.assetList && displayData.assetList.length > 0 && (
        <div className="mb-3 space-y-1">
          <h5 className="text-xs font-medium text-zinc-300">Assets to generate</h5>
          {displayData.assetList.map((asset, i) => (
            <div key={i} className="flex items-center justify-between rounded bg-zinc-800/50 px-2 py-1 text-xs text-zinc-400">
              <span>{asset.description}</span>
              <span className="font-mono">{asset.estimatedTokenCost} tokens</span>
            </div>
          ))}
        </div>
      )}

      {/* Completion summary */}
      {displayData.completionSummary && (
        <div className="mb-3 rounded bg-zinc-800/50 px-2 py-1.5 text-xs text-zinc-400">
          <span>{displayData.completionSummary.totalEntities} entities, </span>
          <span>{displayData.completionSummary.totalScenes} scenes, </span>
          <span>{displayData.completionSummary.totalScripts} scripts</span>
          {displayData.completionSummary.warnings.length > 0 && (
            <div className="mt-1 text-amber-300">
              {displayData.completionSummary.warnings.map((w, i) => (
                <div key={i}>{w}</div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={onApprove}
          className="flex-1 rounded bg-green-700 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-green-600"
        >
          Approve
        </button>
        <button
          onClick={onCancel}
          className="flex-1 rounded bg-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-600"
        >
          Cancel
        </button>
      </div>
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
  const resolveGate = useEditorStore((s) => s.resolveGate);
  const cancelPipeline = useEditorStore((s) => s.cancelPipeline);
  const runPipelineFromPlan = useEditorStore((s) => s.runPipelineFromPlan);
  const resetOrchestrator = useEditorStore((s) => s.resetOrchestrator);

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
      <div className="flex h-full items-center justify-center p-4 text-center text-sm text-zinc-500">
        <div>
          <Sparkles className="mx-auto mb-2 h-8 w-8 text-zinc-600" />
          <p>No game creation in progress</p>
          <p className="mt-1 text-xs">Use chat or QuickStart to create a game</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-blue-400" />
          <span className="text-sm font-medium text-zinc-200">
            {plan?.gdd.title ?? 'Game Creation'}
          </span>
        </div>
        <StatusBadge status={status} />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Error display */}
        {error && (
          <div className="rounded-md border border-red-800 bg-red-950/50 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* Token estimate */}
        {tokenEstimate && <TokenCostBar estimate={tokenEstimate} />}

        {/* Approval gate */}
        {pendingGate && (
          <ApprovalGateDialog
            gate={pendingGate}
            onApprove={handleApprove}
            onCancel={handleReject}
          />
        )}

        {/* Step list */}
        {plan && (
          <div className="space-y-0.5">
            <h4 className="mb-1 text-xs font-medium uppercase tracking-wider text-zinc-500">
              Steps
            </h4>
            {plan.steps.map((step) => (
              <StepItem
                key={step.id}
                step={step}
                status={stepStatuses[step.id] ?? step.status}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer actions */}
      <div className="border-t border-zinc-800 px-3 py-2">
        {status === 'awaiting_approval' && !pendingGate && (
          <button
            onClick={handleStartPipeline}
            className="flex w-full items-center justify-center gap-2 rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500"
          >
            <Play className="h-3.5 w-3.5" />
            Start Building
          </button>
        )}

        {(status === 'executing' || status === 'decomposing' || status === 'planning') && (
          <button
            onClick={handleCancel}
            className="flex w-full items-center justify-center gap-2 rounded bg-zinc-700 px-3 py-2 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-600"
          >
            <Square className="h-3.5 w-3.5" />
            Cancel
          </button>
        )}

        {(status === 'completed' || status === 'failed' || status === 'cancelled') && (
          <button
            onClick={handleReset}
            className="flex w-full items-center justify-center gap-2 rounded bg-zinc-700 px-3 py-2 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-600"
          >
            Start Over
          </button>
        )}
      </div>
    </div>
  );
}
