'use client';

import { Lock } from 'lucide-react';
import { canAccessPanel, getRequiredTier, tierLabel } from '@/lib/ai/tierAccess';
import { useUserStore } from '@/stores/userStore';

interface LockedPanelOverlayProps {
  panelId: string;
  children: React.ReactNode;
}

/**
 * Wraps a panel's content with a locked overlay when the current user's tier
 * does not have access to that panel.
 *
 * When access is allowed the children are rendered as-is (zero overhead).
 * When locked, a semi-transparent overlay is shown with an upgrade CTA.
 */
export function LockedPanelOverlay({ panelId, children }: LockedPanelOverlayProps) {
  const tier = useUserStore((s) => s.tier);
  const hasAccess = canAccessPanel(panelId, tier);

  if (hasAccess) {
    return <>{children}</>;
  }

  const requiredTier = getRequiredTier(panelId);

  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* Blurred background — render children but hide them from interaction */}
      <div
        className="pointer-events-none h-full w-full select-none opacity-20 blur-sm"
        aria-hidden="true"
      >
        {children}
      </div>

      {/* Locked overlay */}
      <div
        className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-zinc-900/80 p-6 text-center"
        role="region"
        aria-label="Panel locked"
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-800 ring-1 ring-zinc-700">
          <Lock className="h-5 w-5 text-zinc-400" aria-hidden="true" />
        </div>

        <div className="space-y-1">
          <p className="text-sm font-semibold text-zinc-200">
            {requiredTier ? `Requires ${tierLabel(requiredTier)} tier` : 'Panel locked'}
          </p>
          <p className="text-xs text-zinc-500">
            Upgrade your plan to unlock this AI feature.
          </p>
        </div>

        <a
          href="/settings/billing"
          className="mt-1 rounded-md bg-blue-600 px-4 py-2 text-xs font-medium text-white transition-colors duration-150 hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-zinc-900"
        >
          Upgrade plan
        </a>
      </div>
    </div>
  );
}
