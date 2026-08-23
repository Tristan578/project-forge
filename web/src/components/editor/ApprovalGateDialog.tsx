'use client';

/**
 * ApprovalGateDialog — the inline approval prompt for one pipeline gate.
 *
 * Lives in its own module so the quick-start dialog can render the same gate
 * without a second copy of the markup. A quick-start run auto-approves
 * `gate_plan` ONLY, so `gate_assets` / `gate_final` still stop the run: whoever
 * started it has to be able to answer them from where they are standing.
 */

import type { ApprovalGate } from '@/lib/game-creation/types';

export function ApprovalGateDialog({
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
