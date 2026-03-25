/**
 * Unit tests for useCelebrations hook.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEditorStore } from '@/stores/editorStore';
import { resetMilestones, checkMilestone } from '@/lib/celebrations/milestones';

vi.mock('@/lib/celebrations/milestones', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/celebrations/milestones')>();
  return {
    ...actual,
    checkMilestone: vi.fn(actual.checkMilestone),
  };
});

const mockedCheckMilestone = vi.mocked(checkMilestone);

// Must import after mocks.
import { useCelebrations } from '../useCelebrations';

beforeEach(() => {
  vi.clearAllMocks();
  resetMilestones();
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

  describe('nodeCount milestone checks (PF-872 — subscribe selector isolation)', () => {
    it('calls checkMilestone(FIRST_ENTITY) when nodeCount crosses 0→1', () => {
      renderHook(() => useCelebrations());

      // Trigger the store update — subscribe fires synchronously.
      useEditorStore.setState({ nodeCount: 1 });

      expect(mockedCheckMilestone).toHaveBeenCalledWith('FIRST_ENTITY');
    });

    it('does NOT call checkMilestone when nodeCount is unchanged', () => {
      const { unmount } = renderHook(() => useCelebrations());

      // Change from 0 to 5 — subscribe fires.
      useEditorStore.setState({ nodeCount: 5 });
      const callsAfterChange = mockedCheckMilestone.mock.calls.length;

      // Setting same value again — subscribe fires but early-exits: no new calls.
      useEditorStore.setState({ nodeCount: 5 });

      expect(mockedCheckMilestone.mock.calls.length).toBe(callsAfterChange);
      unmount();
    });

    it('does NOT call any milestone when only an unrelated field changes (PF-872)', () => {
      renderHook(() => useCelebrations());

      // Unrelated field change — subscribe fires but nodeCount/engineMode unchanged.
      useEditorStore.setState({ selectedIds: new Set(['abc']) });
      useEditorStore.setState({ selectedIds: new Set() });

      expect(mockedCheckMilestone).not.toHaveBeenCalled();
    });

    it('calls checkMilestone(ENTITY_COUNT_50) when nodeCount crosses 49→50', () => {
      useEditorStore.setState({ nodeCount: 49 });
      renderHook(() => useCelebrations());

      useEditorStore.setState({ nodeCount: 50 });

      expect(mockedCheckMilestone).toHaveBeenCalledWith('ENTITY_COUNT_50');
    });

    it('calls checkMilestone(ENTITY_COUNT_100) when nodeCount crosses 99→100', () => {
      useEditorStore.setState({ nodeCount: 99 });
      renderHook(() => useCelebrations());

      useEditorStore.setState({ nodeCount: 100 });

      expect(mockedCheckMilestone).toHaveBeenCalledWith('ENTITY_COUNT_100');
    });

    it('does NOT call FIRST_ENTITY when nodeCount starts above 0 and increases', () => {
      // Set nodeCount before mounting the hook so prevCount initializes to 5.
      useEditorStore.setState({ nodeCount: 5 });
      const { unmount } = renderHook(() => useCelebrations());
      // Clear any calls that may have fired from the setup state changes
      // (e.g. from subscribers of other hook instances in the same environment).
      vi.clearAllMocks();

      // Going from 5→6 should never trigger FIRST_ENTITY (which requires 0→>0).
      useEditorStore.setState({ nodeCount: 6 });

      expect(mockedCheckMilestone).not.toHaveBeenCalledWith('FIRST_ENTITY');
      unmount();
    });
  });

  describe('engineMode milestone checks', () => {
    it('calls checkMilestone(FIRST_PLAY) when engineMode switches to play', () => {
      renderHook(() => useCelebrations());

      useEditorStore.setState({ engineMode: 'play' });

      expect(mockedCheckMilestone).toHaveBeenCalledWith('FIRST_PLAY');
    });

    it('does NOT call FIRST_PLAY when engineMode is unchanged (edit→edit)', () => {
      renderHook(() => useCelebrations());

      useEditorStore.setState({ engineMode: 'edit' });

      expect(mockedCheckMilestone).not.toHaveBeenCalled();
    });

    it('does NOT call FIRST_PLAY a second time after returning to edit then play', () => {
      renderHook(() => useCelebrations());

      // First play — checkMilestone called, marks milestone as celebrated.
      useEditorStore.setState({ engineMode: 'play' });
      vi.clearAllMocks(); // Reset call count for second play check.

      useEditorStore.setState({ engineMode: 'edit' });

      // Second play — checkMilestone will be called but return null (already celebrated).
      // The playFired guard prevents even calling checkMilestone again in the same mount.
      useEditorStore.setState({ engineMode: 'play' });

      // The hook has a playFired guard — it should NOT call checkMilestone again.
      expect(mockedCheckMilestone).not.toHaveBeenCalledWith('FIRST_PLAY');
    });
  });

  describe('celebration queue (via triggerMilestone — directly testable)', () => {
    it('shows first celebration when triggerMilestone is called', () => {
      const { result } = renderHook(() => useCelebrations());

      act(() => {
        result.current.triggerMilestone('FIRST_SCENE');
      });

      expect(result.current.activeCelebration).not.toBeNull();
      expect(result.current.activeCelebration?.title).toBe('First scene saved!');
    });

    it('queues multiple milestones and shows them one at a time', () => {
      const { result } = renderHook(() => useCelebrations());

      act(() => {
        result.current.triggerMilestone('FIRST_SCENE');
        result.current.triggerMilestone('FIRST_AI_GENERATION');
      });

      // First shown.
      expect(result.current.activeCelebration?.title).toBe('First scene saved!');

      // Dismiss — second appears.
      act(() => {
        result.current.dismissCelebration();
      });

      expect(result.current.activeCelebration?.title).toBe('First AI generation!');
    });

    it('dismissCelebration clears activeCelebration when queue is empty', () => {
      const { result } = renderHook(() => useCelebrations());

      act(() => {
        result.current.triggerMilestone('FIRST_SCENE');
      });
      expect(result.current.activeCelebration).not.toBeNull();

      act(() => {
        result.current.dismissCelebration();
      });

      expect(result.current.activeCelebration).toBeNull();
    });

    it('does not enqueue when milestone already celebrated', () => {
      const { result } = renderHook(() => useCelebrations());

      act(() => {
        result.current.triggerMilestone('FIRST_PUBLISH');
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
});
