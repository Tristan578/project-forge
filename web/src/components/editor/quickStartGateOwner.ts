'use client';

/**
 * Which surface owns the inline approval gate.
 *
 * `OrchestratorPanel` and `QuickStartDialog` both render `ApprovalGateDialog`
 * for the same `pendingGate`. The quick-start dialog deliberately opens the
 * orchestrator panel before starting a run, so both are mounted at once and the
 * user saw the same gate twice — two Approve buttons wired to one `resolveGate`,
 * where the second click lands on a gate that has already been answered.
 *
 * The dialog is modal and covers the panel, so while it is open it is the only
 * one the user can actually reach: it claims ownership on mount and the panel
 * stands down. This is a module-level store rather than a slice because it is
 * pure view arbitration with no place in the pipeline's state, and rather than
 * React context because the panel is mounted by the Dockview panel registry,
 * not inside the dialog's tree.
 *
 * NOT under `lib/game-creation/` on purpose: that subtree is reachable from
 * `app/api/game/decompose/route.ts`, and `useSyncExternalStore` in a server
 * graph fails `next build` outright.
 */

import { useSyncExternalStore } from 'react';

let claims = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/**
 * Claim the gate for the quick-start dialog. Returns the release function —
 * call it on unmount. Counted rather than boolean so two overlapping
 * claimants can't clobber each other: a boolean set by whichever caller
 * releases first would flip straight to "unclaimed" while the other
 * claimant is still holding the gate, un-muting the panel out from under it.
 */
export function claimQuickStartGate(): () => void {
  claims += 1;
  emit();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    claims -= 1;
    emit();
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): boolean {
  return claims > 0;
}

/** Server snapshot: nothing has claimed the gate during SSR. */
function getServerSnapshot(): boolean {
  return false;
}

/** True while the quick-start dialog owns the gate; the panel must not render it. */
export function useQuickStartOwnsGate(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Test-only reset so a leaked claim cannot bleed between cases. */
export function _resetQuickStartGateOwner(): void {
  claims = 0;
  emit();
}
