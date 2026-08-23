'use client';

/**
 * ApprovalGateDialog — the inline approval prompt for one pipeline gate.
 *
 * Lives in its own module so the quick-start dialog can render the same gate
 * without a second copy of the markup. A quick-start run auto-approves
 * `gate_plan` ONLY, so `gate_assets` / `gate_final` still stop the run: whoever
 * started it has to be able to answer them from where they are standing.
 *
 * Every colour here is a `--sf-*` token, not a Tailwind palette shade. The
 * previous zinc/amber/green markup was rendered inside the token-themed
 * `@spawnforge/ui` Dialog, so on the light theme `text-amber-200` on
 * `bg-amber-950/30` inverted into near-invisible text — a WCAG AA failure that
 * only appeared on 6 of the 7 themes.
 */

import { useEffect, useRef } from 'react';
import { Button } from '@spawnforge/ui';
import type { ApprovalGate } from '@/lib/game-creation/types';

const ROW = 'rounded-[var(--sf-radius-sm)] bg-[var(--sf-bg-elevated)] px-2 py-1 text-xs text-[var(--sf-text-secondary)]';

export function ApprovalGateDialog({
  gate,
  onApprove,
  onCancel,
  autoFocus = false,
}: {
  gate: ApprovalGate;
  onApprove: () => void;
  onCancel: () => void;
  /**
   * Focus Approve on mount. Set by the quick-start dialog, where the gate
   * replaces the content the user was last focused on — without this, focus
   * falls to `document.body` inside an `aria-modal` region and keyboard users
   * have nothing to tab from. The panel leaves it off: the gate appears
   * beside other content there and stealing focus would be a hijack.
   */
  autoFocus?: boolean;
}) {
  const { displayData } = gate;
  const approveRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (autoFocus) approveRef.current?.focus();
    // gate.id so a second gate in the same run re-focuses.
  }, [autoFocus, gate.id]);

  return (
    <div className="rounded-[var(--sf-radius-md)] border border-[var(--sf-warning)] bg-[var(--sf-bg-surface)] p-4">
      <h3 className="mb-1 text-sm font-semibold text-[var(--sf-warning)]">{gate.label}</h3>
      <p className="mb-3 text-xs text-[var(--sf-text-secondary)]">{gate.description}</p>

      {/* Scene summaries */}
      {displayData.sceneSummaries && displayData.sceneSummaries.length > 0 && (
        <div className="mb-3 space-y-1">
          <h4 className="text-xs font-medium text-[var(--sf-text)]">Scenes</h4>
          {displayData.sceneSummaries.map((scene) => (
            <div key={scene.name} className={ROW}>
              <span className="text-[var(--sf-text)]">{scene.name}</span>
              <span className="ml-2">({scene.entityCount} entities)</span>
            </div>
          ))}
        </div>
      )}

      {/* Asset list */}
      {displayData.assetList && displayData.assetList.length > 0 && (
        <div className="mb-3 space-y-1">
          <h4 className="text-xs font-medium text-[var(--sf-text)]">Assets to generate</h4>
          {displayData.assetList.map((asset, i) => (
            <div key={i} className={`flex items-center justify-between ${ROW}`}>
              <span>{asset.description}</span>
              <span className="font-mono">{asset.estimatedTokenCost} tokens</span>
            </div>
          ))}
        </div>
      )}

      {/* Completion summary */}
      {displayData.completionSummary && (
        <div className={`mb-3 ${ROW}`}>
          <span>{displayData.completionSummary.totalEntities} entities, </span>
          <span>{displayData.completionSummary.totalScenes} scenes, </span>
          <span>{displayData.completionSummary.totalScripts} scripts</span>
          {displayData.completionSummary.warnings.length > 0 && (
            <div className="mt-1 text-[var(--sf-warning)]">
              {displayData.completionSummary.warnings.map((w, i) => (
                <div key={i}>{w}</div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex gap-2">
        <Button ref={approveRef} type="button" size="sm" onClick={onApprove} className="flex-1">
          Approve
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} className="flex-1">
          Cancel
        </Button>
      </div>
    </div>
  );
}
