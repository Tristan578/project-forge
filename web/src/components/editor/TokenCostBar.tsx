'use client';

/**
 * TokenCostBar — the estimated token cost of a game-creation plan, with its
 * per-category breakdown and a balance warning.
 *
 * Shared by the orchestrator panel and the quick-start dialog's plan review
 * (#6831): a first-time user confirms the cost in the dialog before any build
 * step spends tokens, and must see the same numbers the panel shows.
 *
 * It stays in the app rather than `@spawnforge/ui` because it renders the
 * orchestrator's own `TokenEstimate` type; the design library takes no
 * dependency on app domain types.
 */

import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import type { TokenEstimate } from '@/lib/game-creation/types';
import { SETTINGS_BILLING_HREF } from '@/lib/navigation/settingsRoutes';

export function TokenCostBar({ estimate }: { estimate: TokenEstimate }) {
  return (
    <div className="rounded-[var(--sf-radius-md)] border border-[var(--sf-border)] bg-[var(--sf-bg-elevated)] p-3">
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="font-medium text-[var(--sf-text)]">Estimated token cost</span>
        <span className="font-mono text-[var(--sf-text)]">{estimate.totalEstimated}</span>
      </div>
      {/* The build reserves the estimate's upper bound, not the estimate, and
          refunds what it does not use when it ends. A "confirm the cost" screen
          has to show the number that actually leaves the balance (#6831). */}
      {estimate.totalVarianceHigh > 0 && (
        <p className="mb-2 text-xs text-[var(--sf-text-secondary)]">
          Up to <span className="font-mono">{estimate.totalVarianceHigh}</span> tokens are held while
          it builds; whatever it doesn&apos;t use is returned.
        </p>
      )}
      <div className="space-y-1">
        {estimate.breakdown.map((item) => (
          <div key={item.category} className="flex items-center justify-between text-xs text-[var(--sf-text)]">
            <span>{item.category}</span>
            <span className="font-mono">{item.estimatedTokens}</span>
          </div>
        ))}
      </div>
      {/* `sufficientBalance` compares against the balance this tab last
          fetched, so it can be stale in either direction. The server checks
          for real when the build starts and refuses before spending anything,
          so say that, and say where to get more (#6831 review). */}
      {!estimate.sufficientBalance && (
        <div className="mt-2 flex items-start gap-1.5 rounded-[var(--sf-radius-sm)] bg-[var(--sf-destructive)]/10 px-2 py-1 text-xs text-[var(--sf-text)]">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
          <span>
            This may cost more than your token balance. If it does, the build stops before
            anything is spent.{' '}
            <Link href={SETTINGS_BILLING_HREF} className="underline underline-offset-2">
              Buy tokens
            </Link>
          </span>
        </div>
      )}
      {estimate.warningMessage && estimate.sufficientBalance && (
        <div className="mt-2 flex items-start gap-1.5 rounded-[var(--sf-radius-sm)] bg-[var(--sf-warning)]/10 px-2 py-1 text-xs text-[var(--sf-text)]">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
          <span>{estimate.warningMessage}</span>
        </div>
      )}
    </div>
  );
}
