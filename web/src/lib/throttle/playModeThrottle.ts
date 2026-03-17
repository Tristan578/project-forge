/**
 * Play-mode throttle utility for React store updates.
 *
 * During play mode the Bevy engine emits transform/physics/animation events at
 * 60fps. Each event triggers a Zustand setState call which re-renders all
 * subscribed React components. Users cannot perceive UI updates faster than
 * ~10fps, so we skip store updates when the update would arrive sooner than
 * `intervalMs` (100ms = 10fps) after the previous one.
 *
 * Edit-mode updates always pass through immediately — the inspector must reflect
 * changes from gizmo drags and command results in real time.
 *
 * Events that MUST NOT be throttled (collision events, script errors, scene
 * graph changes, mode transitions) should bypass this utility entirely and be
 * handled directly in their own event handler functions.
 */

/** Opaque token representing a throttle instance for a group of related events. */
export interface PlayModeThrottle {
  /**
   * Returns `true` when a store update should proceed, `false` when it should
   * be skipped because the window since the last allowed update has not elapsed.
   *
   * @param isPlayMode - Whether the engine is currently in play or paused mode.
   *   Callers should pass `engineMode === 'play' || engineMode === 'paused'`.
   */
  shouldUpdate(isPlayMode: boolean): boolean;

  /**
   * Resets the throttle so the next call to `shouldUpdate` is always allowed.
   * Call this on mode transitions (e.g. entering edit mode) to ensure the
   * inspector reflects the latest engine state immediately.
   */
  reset(): void;
}

/**
 * Creates a play-mode throttle that limits store updates to at most one per
 * `intervalMs` milliseconds while in play mode.
 *
 * @param intervalMs - Minimum milliseconds between allowed updates during play
 *   mode. Default 100ms corresponds to 10fps.
 */
export function createPlayModeThrottle(intervalMs: number = 100): PlayModeThrottle {
  // Use -Infinity so the first shouldUpdate() call always returns true,
  // regardless of when performance.now() starts (fake timers start at 0).
  let lastUpdateTime = -Infinity;

  return {
    shouldUpdate(isPlayMode: boolean): boolean {
      if (!isPlayMode) {
        // Edit mode: always allow updates immediately.
        return true;
      }

      const now = performance.now();
      if (now - lastUpdateTime >= intervalMs) {
        lastUpdateTime = now;
        return true;
      }
      return false;
    },

    reset(): void {
      lastUpdateTime = -Infinity;
    },
  };
}

/**
 * Convenience helper that creates a throttle and returns a wrapped version of
 * a handler function.  The wrapper calls the original handler only when
 * `shouldUpdate` returns `true`.
 *
 * @param handler - The event handler to wrap.
 * @param throttle - The throttle instance to use.
 * @param isPlayMode - Whether the engine is currently in play/paused mode.
 */
export function withPlayModeThrottle<TArgs extends unknown[], TReturn>(
  handler: (...args: TArgs) => TReturn,
  throttle: PlayModeThrottle,
  isPlayMode: boolean,
): (...args: TArgs) => TReturn | false {
  return (...args: TArgs): TReturn | false => {
    if (!throttle.shouldUpdate(isPlayMode)) {
      return false;
    }
    return handler(...args);
  };
}
