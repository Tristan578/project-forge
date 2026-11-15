/**
 * Addressable controlled replays for the E2E hook (#10007).
 *
 * `window.__FORGE_REPLAY_CONTROL` starts replays from `page.evaluate` and
 * hands the spec an id to control and inspect them with. The map behind it
 * used to keep every session for the life of the page (handle, progress,
 * closures). The registry drops SETTLED sessions — but only when the next one
 * is registered, not the instant they settle: the live spec reads `state(id)`
 * after `result(id)` has resolved (it asserts the engine's own evaluated input
 * is released once the run is cancelled), so the most recently finished
 * session must stay addressable until a newer one replaces it. Growth is
 * bounded to one settled entry plus whatever is still running.
 */

import type { ReplayHandle } from './replayRunner';

export interface RegisteredReplay {
  playerEntityId: string;
  handle: ReplayHandle;
}

export interface ReplaySessionRegistry {
  /**
   * Register a started session and return its id. Every session that has
   * already settled is dropped first.
   * @param entry The session's handle and the entity it observes.
   * @returns The id the hook addresses the session by.
   */
  register(entry: RegisteredReplay): string;
  /**
   * @param id An id `register` returned.
   * @returns The session.
   * @throws Error when the id is unknown or has been dropped.
   */
  get(id: string): RegisteredReplay;
  /** @returns How many sessions are currently held. */
  size(): number;
}

/**
 * @returns A fresh registry, one per editor page.
 */
export function createReplaySessionRegistry(): ReplaySessionRegistry {
  const sessions = new Map<string, RegisteredReplay>();
  const settled = new Set<string>();
  let next = 0;
  return {
    register(entry) {
      for (const id of settled) sessions.delete(id);
      settled.clear();
      const id = `replay-${next}`;
      next += 1;
      sessions.set(id, entry);
      // `result` never rejects; a settled session is dropped on the next register.
      void entry.handle.result.then(() => {
        if (sessions.get(id) === entry) settled.add(id);
      });
      return id;
    },
    get(id) {
      const entry = sessions.get(id);
      if (!entry) throw new Error(`Unknown replay session: ${id}`);
      return entry;
    },
    size() {
      return sessions.size;
    },
  };
}
