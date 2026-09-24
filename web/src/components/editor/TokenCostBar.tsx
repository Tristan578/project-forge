'use client';

/**
 * TokenCostBar — the estimated token cost of a game-creation plan, with its
 * per-category breakdown and a balance warning.
 *
 * Shared by the orchestrator panel and the quick-start dialog's plan review
 * (#6831): a first-time user confirms the cost in the dialog before any build
 * step spends tokens, and must see the same numbers the panel shows.
 */

import { AlertTriangle } from 'lucide-react';
import type { TokenEstimate } from '@/lib/game-creation/types';

export function TokenCostBar({ estimate }: { estimate: TokenEstimate }) {
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
          <AlertTriangle className="h-3 w-3" aria-hidden="true" />
          Insufficient token balance
        </div>
      )}
      {estimate.warningMessage && estimate.sufficientBalance && (
        <div className="mt-2 flex items-center gap-1.5 rounded bg-[var(--sf-warning)]/10 px-2 py-1 text-xs text-[var(--sf-text)]">
          <AlertTriangle className="h-3 w-3" aria-hidden="true" />
          {estimate.warningMessage}
        </div>
      )}
    </div>
  );
}
