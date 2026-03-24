/**
 * Unit tests for useCelebrations hook.
 *
 * Verifies that celebrations are only triggered when the relevant slice
 * of store state changes (nodeCount, engineMode) — not on every store update.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useEditorStore } from '@/stores/editorStore';
import { resetMilestones } from '@/lib/celebrations/milestones';

// Must import after any mocks.
import { useCelebrations } from '../useCelebrations';

// Helper: update the store inside act() and wait for any resulting React state
// updates to flush. Zustand's subscribe fires synchronously but the React
// useState setter inside the callback may require a microtask flush.
async function setStoreAndFlush(patch: Parameters<typeof useEditorStore.setState>[0]) {
  act(() => {
    useEditorStore.setState(patch);
  });
  // Give React a tick to process the setState from the subscribe callback.
  await Promise.resolve();
}

beforeEach(() => {
  // Clear localStorage milestone tracking so every test starts clean.
  resetMilestones();
  // Reset store to a clean state.
  useEditorStore.setState({
    nodeCount: 0,
    engineMode: 'edit',
  });
});

describe('useCelebrations', () => {
  describe('initial state', () => {
    it('returns no active celebration on mount', () => {
      const { result } = renderHook(() => useCelebrations());
      expect(result.current.activeCelebration).toBeNull();
    });

    it('exposes dismissCelebration and triggerMilestone callbacks', () => {
      const { result } = renderHook(() => useCelebrations());
      expect(typeof result.current.dismissCelebration).toBe('function');
      expect(typeof result.current.triggerMilestone).toBe('function');
    });
  });

  describe('nodeCount milestones', () => {
    it('triggers FIRST_ENTITY celebration when nodeCount goes from 0 to 1', async () => {
      const { result } = renderHook(() => useCelebrations());

      await setStoreAndFlush({ nodeCount: 1 });

      await waitFor(() => {
        expect(result.current.activeCelebration).not.toBeNull();
      });
      expect(result.current.activeCelebration?.title).toBe('First entity created!');
    });

    it('does not trigger FIRST_ENTITY when nodeCount starts above 0', async () => {
      useEditorStore.setState({ nodeCount: 5 });
      const { result } = renderHook(() => useCelebrations());

      await setStoreAndFlush({ nodeCount: 6 });

      // No FIRST_ENTITY because we never crossed 0→1
      expect(result.current.activeCelebration).toBeNull();
    });

    it('triggers ENTITY_COUNT_50 celebration when nodeCount reaches 50', async () => {
      useEditorStore.setState({ nodeCount: 49 });
      const { result } = renderHook(() => useCelebrations());

      await setStoreAndFlush({ nodeCount: 50 });

      await waitFor(() => {
        expect(result.current.activeCelebration).not.toBeNull();
      });
      expect(result.current.activeCelebration?.title).toBe('50 entities!');
    });

    it('triggers ENTITY_COUNT_100 celebration when nodeCount reaches 100', async () => {
      useEditorStore.setState({ nodeCount: 99 });
      const { result } = renderHook(() => useCelebrations());

      await setStoreAndFlush({ nodeCount: 100 });

      await waitFor(() => {
        expect(result.current.activeCelebration).not.toBeNull();
      });
      expect(result.current.activeCelebration?.title).toBe('100 entities!');
    });

    it('does not re-trigger a milestone that has already been celebrated', async () => {
      const { result } = renderHook(() => useCelebrations());

      // First time — should celebrate.
      await setStoreAndFlush({ nodeCount: 1 });
      await waitFor(() => {
        expect(result.current.activeCelebration?.title).toBe('First entity created!');
      });

      // Dismiss.
      act(() => {
        result.current.dismissCelebration();
      });

      // Reset nodeCount back to 0 then up again — should NOT re-trigger.
      await setStoreAndFlush({ nodeCount: 0 });
      await setStoreAndFlush({ nodeCount: 1 });

      // activeCelebration should remain null (already celebrated).
      expect(result.current.activeCelebration).toBeNull();
    });
  });

  describe('engineMode milestone (FIRST_PLAY)', () => {
    it('triggers FIRST_PLAY celebration when engineMode switches to play', async () => {
      const { result } = renderHook(() => useCelebrations());

      await setStoreAndFlush({ engineMode: 'play' });

      await waitFor(() => {
        expect(result.current.activeCelebration).not.toBeNull();
      });
      expect(result.current.activeCelebration?.title).toBe('First playtest!');
    });

    it('does not trigger FIRST_PLAY when engineMode stays in edit mode', async () => {
      const { result } = renderHook(() => useCelebrations());

      // State was already 'edit' — setting it again should not fire.
      await setStoreAndFlush({ engineMode: 'edit' });

      expect(result.current.activeCelebration).toBeNull();
    });

    it('only triggers FIRST_PLAY once across multiple play sessions', async () => {
      const { result } = renderHook(() => useCelebrations());

      // First play.
      await setStoreAndFlush({ engineMode: 'play' });
      await waitFor(() => {
        expect(result.current.activeCelebration).not.toBeNull();
      });

      act(() => {
        result.current.dismissCelebration();
      });
      await setStoreAndFlush({ engineMode: 'edit' });

      // Second play — should NOT celebrate again.
      await setStoreAndFlush({ engineMode: 'play' });

      expect(result.current.activeCelebration).toBeNull();
    });
  });

  describe('celebration queue', () => {
    it('queues multiple milestones and shows them one at a time', async () => {
      const { result } = renderHook(() => useCelebrations());

      // Trigger two milestones.
      await setStoreAndFlush({ nodeCount: 1 }); // FIRST_ENTITY
      await setStoreAndFlush({ engineMode: 'play' }); // FIRST_PLAY

      await waitFor(() => {
        expect(result.current.activeCelebration).not.toBeNull();
      });

      // First celebration shown.
      const firstTitle = result.current.activeCelebration?.title;
      expect(firstTitle).toBeTruthy();

      // Dismiss — second should appear.
      act(() => {
        result.current.dismissCelebration();
      });

      await waitFor(() => {
        expect(result.current.activeCelebration).not.toBeNull();
      });
      expect(result.current.activeCelebration?.title).not.toBe(firstTitle);
    });

    it('dismissCelebration clears activeCelebration when queue is empty', async () => {
      const { result } = renderHook(() => useCelebrations());

      await setStoreAndFlush({ nodeCount: 1 });
      await waitFor(() => {
        expect(result.current.activeCelebration).not.toBeNull();
      });

      act(() => {
        result.current.dismissCelebration();
      });

      expect(result.current.activeCelebration).toBeNull();
    });
  });

  describe('triggerMilestone (manual)', () => {
    it('triggers a celebration when triggerMilestone is called', async () => {
      const { result } = renderHook(() => useCelebrations());

      act(() => {
        result.current.triggerMilestone('FIRST_SCENE');
      });

      await waitFor(() => {
        expect(result.current.activeCelebration).not.toBeNull();
      });
      expect(result.current.activeCelebration?.title).toBe('First scene saved!');
    });

    it('does not enqueue when milestone already celebrated', async () => {
      const { result } = renderHook(() => useCelebrations());

      // First call — celebrates.
      act(() => {
        result.current.triggerMilestone('FIRST_PUBLISH');
      });
      await waitFor(() => {
        expect(result.current.activeCelebration).not.toBeNull();
      });
      act(() => {
        result.current.dismissCelebration();
      });

      // Second call — already celebrated.
      act(() => {
        result.current.triggerMilestone('FIRST_PUBLISH');
      });

      expect(result.current.activeCelebration).toBeNull();
    });
  });

  describe('selector isolation (PF-872 regression)', () => {
    it('does not trigger celebrations when unrelated store fields change', async () => {
      const { result } = renderHook(() => useCelebrations());

      // Update a field that is unrelated to celebrations (selection state).
      await setStoreAndFlush({ selectedIds: new Set(['entity-abc']) });
      await setStoreAndFlush({ selectedIds: new Set() });

      expect(result.current.activeCelebration).toBeNull();
    });
  });
});
