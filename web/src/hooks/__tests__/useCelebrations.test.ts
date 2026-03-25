/**
 * Unit tests for useCelebrations hook.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEditorStore } from '@/stores/editorStore';

// Mock checkMilestone
const mockCheckMilestone = vi.fn();
vi.mock('@/lib/celebrations/milestones', () => ({
  checkMilestone: (id: string) => mockCheckMilestone(id),
}));

// Must import AFTER mocking
import { useCelebrations } from '../useCelebrations';

describe('useCelebrations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckMilestone.mockReturnValue(null);
    // Reset store state
    useEditorStore.setState({
      nodeCount: 0,
      engineMode: 'edit',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initial state', () => {
    it('starts with no active celebration', () => {
      const { result } = renderHook(() => useCelebrations());
      expect(result.current.activeCelebration).toBeNull();
    });
  });

  describe('dismissCelebration', () => {
    it('removes the current celebration from the queue', () => {
      mockCheckMilestone.mockReturnValue({ title: 'Test', message: 'Hello' });

      const { result } = renderHook(() => useCelebrations());

      act(() => {
        result.current.triggerMilestone('FIRST_ENTITY');
      });

      expect(result.current.activeCelebration).not.toBeNull();

      act(() => {
        result.current.dismissCelebration();
      });

      expect(result.current.activeCelebration).toBeNull();
    });

    it('advances to the next celebration in the queue', () => {
      mockCheckMilestone
        .mockReturnValueOnce({ title: 'First', message: 'Msg 1' })
        .mockReturnValueOnce({ title: 'Second', message: 'Msg 2' });

      const { result } = renderHook(() => useCelebrations());

      act(() => {
        result.current.triggerMilestone('FIRST_ENTITY');
        result.current.triggerMilestone('ENTITY_COUNT_50');
      });

      expect(result.current.activeCelebration?.title).toBe('First');

      act(() => {
        result.current.dismissCelebration();
      });

      expect(result.current.activeCelebration?.title).toBe('Second');
    });
  });

  describe('triggerMilestone', () => {
    it('enqueues a celebration when checkMilestone returns data', () => {
      mockCheckMilestone.mockReturnValue({ title: 'Milestone!', message: 'You did it.' });

      const { result } = renderHook(() => useCelebrations());

      act(() => {
        result.current.triggerMilestone('FIRST_ENTITY');
      });

      expect(result.current.activeCelebration).toEqual(
        expect.objectContaining({ title: 'Milestone!', message: 'You did it.' }),
      );
    });

    it('does not enqueue when checkMilestone returns null', () => {
      mockCheckMilestone.mockReturnValue(null);

      const { result } = renderHook(() => useCelebrations());

      act(() => {
        result.current.triggerMilestone('FIRST_ENTITY');
      });

      expect(result.current.activeCelebration).toBeNull();
    });
  });

  describe('store subscription — FIRST_ENTITY (PF-872 regression)', () => {
    it('fires FIRST_ENTITY milestone when nodeCount goes from 0 to 1', () => {
      mockCheckMilestone.mockImplementation((id: string) => {
        if (id === 'FIRST_ENTITY') return { title: 'First entity!', message: 'Welcome.' };
        return null;
      });

      const { result } = renderHook(() => useCelebrations());

      // Simulate engine emitting nodeCount = 1
      act(() => {
        useEditorStore.setState({ nodeCount: 1 });
      });

      expect(result.current.activeCelebration?.title).toBe('First entity!');
    });

    it('does NOT fire FIRST_ENTITY when nodeCount increases but was already > 0', () => {
      mockCheckMilestone.mockImplementation((id: string) => {
        if (id === 'FIRST_ENTITY') return { title: 'First entity!', message: 'Welcome.' };
        return null;
      });

      // Start with nodeCount already > 0
      useEditorStore.setState({ nodeCount: 5 });

      const { result } = renderHook(() => useCelebrations());

      act(() => {
        useEditorStore.setState({ nodeCount: 6 });
      });

      expect(result.current.activeCelebration).toBeNull();
    });

    it('fires ENTITY_COUNT_50 when crossing the 50-entity threshold', () => {
      mockCheckMilestone.mockImplementation((id: string) => {
        if (id === 'ENTITY_COUNT_50') return { title: '50 entities!', message: 'Nice scene.' };
        return null;
      });

      useEditorStore.setState({ nodeCount: 49 });
      const { result } = renderHook(() => useCelebrations());

      act(() => {
        useEditorStore.setState({ nodeCount: 50 });
      });

      expect(result.current.activeCelebration?.title).toBe('50 entities!');
    });

    it('fires ENTITY_COUNT_100 when crossing the 100-entity threshold', () => {
      mockCheckMilestone.mockImplementation((id: string) => {
        if (id === 'ENTITY_COUNT_100') return { title: '100 entities!', message: 'Impressive.' };
        return null;
      });

      useEditorStore.setState({ nodeCount: 99 });
      const { result } = renderHook(() => useCelebrations());

      act(() => {
        useEditorStore.setState({ nodeCount: 100 });
      });

      expect(result.current.activeCelebration?.title).toBe('100 entities!');
    });
  });

  describe('store subscription — FIRST_PLAY (PF-872 regression)', () => {
    it('fires FIRST_PLAY milestone when engineMode changes to play', () => {
      mockCheckMilestone.mockImplementation((id: string) => {
        if (id === 'FIRST_PLAY') return { title: 'First play!', message: 'Go go go.' };
        return null;
      });

      useEditorStore.setState({ engineMode: 'edit' });
      const { result } = renderHook(() => useCelebrations());

      act(() => {
        useEditorStore.setState({ engineMode: 'play' });
      });

      expect(result.current.activeCelebration?.title).toBe('First play!');
    });

    it('does not fire FIRST_PLAY a second time', () => {
      let callCount = 0;
      mockCheckMilestone.mockImplementation((id: string) => {
        if (id === 'FIRST_PLAY') {
          callCount++;
          return { title: 'First play!', message: 'Go.' };
        }
        return null;
      });

      useEditorStore.setState({ engineMode: 'edit' });
      const { result } = renderHook(() => useCelebrations());

      act(() => {
        useEditorStore.setState({ engineMode: 'play' });
      });
      act(() => {
        result.current.dismissCelebration();
        useEditorStore.setState({ engineMode: 'edit' });
        useEditorStore.setState({ engineMode: 'play' });
      });

      // checkMilestone('FIRST_PLAY') is called on every mode transition, but
      // playFired guards the actual enqueue (once per hook mount).
      // The mock returns a value each call, but the second transition is gated.
      expect(callCount).toBe(1);
    });
  });

  describe('no spurious re-renders from bare store reads (PF-872 regression)', () => {
    it('returns stable function references across renders', () => {
      const { result, rerender } = renderHook(() => useCelebrations());

      const firstDismiss = result.current.dismissCelebration;
      const firstTrigger = result.current.triggerMilestone;

      rerender();

      expect(result.current.dismissCelebration).toBe(firstDismiss);
      expect(result.current.triggerMilestone).toBe(firstTrigger);
    });
  });
});
