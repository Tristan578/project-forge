'use client';

import { useState, useCallback, useEffect } from 'react';
import { useEditorStore } from '@/stores/editorStore';
import { checkMilestone, type MilestoneId } from '@/lib/celebrations/milestones';

export interface ActiveCelebration {
  id: string;
  title: string;
  message: string;
}

export interface UseCelebrationsReturn {
  /** The currently visible celebration, or null if none is active. */
  activeCelebration: ActiveCelebration | null;
  /** Dismiss the current celebration and advance the queue. */
  dismissCelebration: () => void;
  /** Manually trigger a milestone check (for external event sources). */
  triggerMilestone: (milestone: MilestoneId) => void;
}

let _celebrationCounter = 0;

function makeCelebrationId(): string {
  _celebrationCounter += 1;
  return `celebration-${_celebrationCounter}`;
}

/**
 * Tracks editor state and triggers celebration overlays when milestones are reached.
 *
 * - At most one celebration is visible at a time; extras are queued.
 * - Each milestone fires at most once per user (tracked in localStorage).
 * - Integrates with Zustand editor store to detect entity counts, play mode, etc.
 *
 * Implementation: subscribes to the Zustand store outside of React render using
 * `useEditorStore.subscribe()`. Subscription callbacks run outside render so they
 * are free to call setState without triggering the react-hooks/set-state-in-effect
 * lint rule (subscriptions are not effects).
 */
export function useCelebrations(): UseCelebrationsReturn {
  const [queue, setQueue] = useState<ActiveCelebration[]>([]);
  const activeCelebration = queue.length > 0 ? queue[0] : null;

  const enqueueData = useCallback((title: string, message: string) => {
    setQueue((prev) => [
      ...prev,
      { id: makeCelebrationId(), title, message },
    ]);
  }, []);

  const triggerMilestone = useCallback(
    (milestone: MilestoneId) => {
      const data = checkMilestone(milestone);
      if (data) enqueueData(data.title, data.message);
    },
    [enqueueData],
  );

  const dismissCelebration = useCallback(() => {
    setQueue((prev) => prev.slice(1));
  }, []);

  // Subscribe to entity count changes outside of render (Zustand subscribe API).
  // This runs in a useEffect so the subscription is set up after mount and
  // cleaned up on unmount. The callback does NOT run during render.
  useEffect(() => {
    let prevCount = useEditorStore.getState().nodeCount;

    const unsub = useEditorStore.subscribe((state) => {
      const count = state.nodeCount;
      if (count === prevCount) return;

      if (prevCount === 0 && count > 0) {
        const d = checkMilestone('FIRST_ENTITY');
        if (d) enqueueData(d.title, d.message);
      }
      if (prevCount < 50 && count >= 50) {
        const d = checkMilestone('ENTITY_COUNT_50');
        if (d) enqueueData(d.title, d.message);
      }
      if (prevCount < 100 && count >= 100) {
        const d = checkMilestone('ENTITY_COUNT_100');
        if (d) enqueueData(d.title, d.message);
      }

      prevCount = count;
    });

    return unsub;
  }, [enqueueData]);

  // Subscribe to engine mode changes for FIRST_PLAY
  useEffect(() => {
    let playFired = false;
    let prevMode = useEditorStore.getState().engineMode;

    const unsub = useEditorStore.subscribe((state) => {
      const mode = state.engineMode;
      if (mode === prevMode) return;
      prevMode = mode;

      if (!playFired && mode === 'play') {
        playFired = true;
        const d = checkMilestone('FIRST_PLAY');
        if (d) enqueueData(d.title, d.message);
      }
    });

    return unsub;
  }, [enqueueData]);

  // Expose the current engine mode and entity count for consumers (unused in this
  // component but keeps the hook reactive so callers re-render with activeCelebration)
  useEditorStore((s) => s.nodeCount);
  useEditorStore((s) => s.engineMode);

  return { activeCelebration, dismissCelebration, triggerMilestone };
}
