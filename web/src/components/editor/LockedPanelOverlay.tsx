'use client';

import { Lock } from 'lucide-react';
import { TIER_LABELS, getRequiredTier } from '@/lib/ai/tierAccess';
import type { Tier } from '@/stores/userStore';

interface LockedPanelOverlayProps {
  /** The panel ID from panelRegistry — used to look up the required tier. */
  panelId: string;
  /** Explicit required tier override (falls back to PANEL_TIER_REQUIREMENTS lookup). */
  requiredTier?: Tier;
}

/**
 * Full-area overlay rendered in place of a locked AI panel.
 * Shows the minimum tier required and a CTA button to the upgrade page.
 */
export function LockedPanelOverlay({ panelId, requiredTier }: LockedPanelOverlayProps) {
  const required = requiredTier ?? getRequiredTier(panelId);
  const tierLabel = required ? TIER_LABELS[required] : 'a higher plan';

  return (
    <div
      className="flex h-full w-full flex-col items-center justify-center gap-4 bg-zinc-900 p-6 text-center"
      role="region"
      aria-label="Panel locked — upgrade required"
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-800">
        <Lock className="h-5 w-5 text-zinc-400" aria-hidden="true" />
      </div>

      <div className="space-y-1">
        <p className="text-sm font-semibold text-zinc-200">
          {tierLabel} plan required
        </p>
        <p className="text-xs text-zinc-500">
          Upgrade to unlock this AI feature and accelerate your game development.
        </p>
      </div>

      <a
        href="/settings/billing"
        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-zinc-900"
      >
        Upgrade to {tierLabel}
      </a>
    </div>
  );
}
