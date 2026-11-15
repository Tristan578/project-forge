/**
 * The in-app record of what the bridge actually did (#9293).
 *
 * "MCP bridge attached" tells you a process is connected; it does not tell you
 * it just deleted something. The review's UX finding was that a remote agent
 * could mutate the live scene with nothing on screen distinguishing that from
 * ordinary editing, so every executed and every refused command is announced
 * here and surfaced by McpBridgeIndicator.
 *
 * Deliberately its own module: bridgeFrame.ts (the publisher) pulls the chat
 * executor and the 332 KB manifest and is reached only through a dynamic
 * import, while the indicator (the subscriber) must stay light. A shared
 * module keeps both on one store without dragging the heavy half forward.
 */
export type BridgeOutcome = 'ran' | 'failed' | 'refused';

export interface BridgeActivity {
  name: string;
  outcome: BridgeOutcome;
  at: number;
}

let last: BridgeActivity | null = null;
const listeners = new Set<() => void>();

export function announceBridgeActivity(name: string, outcome: BridgeOutcome): void {
  last = { name, outcome, at: Date.now() };
  for (const listener of listeners) listener();
}

export function subscribeBridgeActivity(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Stable identity between announcements — useSyncExternalStore requires it. */
export function getLastBridgeActivity(): BridgeActivity | null {
  return last;
}

export function noBridgeActivityOnServer(): null {
  return null;
}

/** Test seam only: the store outlives a single test otherwise. */
export function resetBridgeActivity(): void {
  last = null;
}
