/**
 * Regression tests for stale-closure bugs in chatStore's agentic loop.
 *
 * #7516 — approvalMode stale closure: the agentic while-loop captured
 *         `approvalMode` from the outer scope and never re-read it, so
 *         toggling approval mode mid-loop had no effect.
 *
 * #7515 — stale scene context: sceneContext was built once before the loop
 *         and never refreshed, so scene changes during multi-turn AI sessions
 *         were invisible to subsequent turns.
 *
 * The fix reads both values from the store on every loop iteration via
 * `get().approvalMode` and `buildSceneContext(useEditorStore.getState())`.
 *
 * These tests verify the store infrastructure that makes live reads possible:
 * - `setApprovalMode` persists immediately to store state (so `get()` returns
 *   the current value without a closure snapshot)
 * - Store state is synchronously readable between turns
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useChatStore } from '../chatStore';

describe('chatStore stale-closure regressions', () => {
  beforeEach(() => {
    useChatStore.setState({
      approvalMode: false,
      isStreaming: false,
      messages: [],
      error: null,
      abortController: null,
    });
  });

  // ---------------------------------------------------------------------------
  // #7516 — approvalMode stale closure
  // ---------------------------------------------------------------------------
  describe('approvalMode live readability (regression for #7516)', () => {
    it('reflects the latest value immediately after setApprovalMode', () => {
      const { setApprovalMode } = useChatStore.getState();

      // Simulates mid-loop read: `get().approvalMode` should always return current
      expect(useChatStore.getState().approvalMode).toBe(false);
      setApprovalMode(true);
      expect(useChatStore.getState().approvalMode).toBe(true);
      setApprovalMode(false);
      expect(useChatStore.getState().approvalMode).toBe(false);
    });

    it('approvalMode can be changed while isStreaming is true', () => {
      // The fix requires that mid-loop setApprovalMode changes take effect.
      // This test verifies the store doesn't block the update when streaming.
      useChatStore.setState({ isStreaming: true });

      const { setApprovalMode } = useChatStore.getState();
      setApprovalMode(true);

      // Must reflect the new value even during a streaming session
      expect(useChatStore.getState().approvalMode).toBe(true);
    });

    it('each call to get().approvalMode returns the current value, not a stale snapshot', () => {
      // The key invariant: reading via get() never returns a stale value
      useChatStore.setState({ approvalMode: false });
      const getApprovalMode = () => useChatStore.getState().approvalMode;

      expect(getApprovalMode()).toBe(false);
      useChatStore.setState({ approvalMode: true });
      // If the store had a stale-closure bug, getApprovalMode() would still
      // return false here. With the fix it returns true immediately.
      expect(getApprovalMode()).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // #7515 — stale scene context
  // ---------------------------------------------------------------------------
  describe('scene context freshness per turn (regression for #7515)', () => {
    it('store state is synchronously readable between turns', () => {
      // The fix reads editorStore.getState() on every turn.
      // This test verifies that Zustand's getState() always returns current data,
      // ensuring the per-turn read pattern works correctly.
      useChatStore.setState({ loopIteration: 0 });
      expect(useChatStore.getState().loopIteration).toBe(0);

      useChatStore.setState({ loopIteration: 1 });
      expect(useChatStore.getState().loopIteration).toBe(1);

      useChatStore.setState({ loopIteration: 2 });
      expect(useChatStore.getState().loopIteration).toBe(2);
    });

    it('setApprovalMode and loopIteration updates are independent of each other', () => {
      // Both values are read fresh on each iteration of the agentic loop
      useChatStore.setState({ approvalMode: false, loopIteration: 0 });

      useChatStore.setState({ loopIteration: 1 });
      expect(useChatStore.getState().approvalMode).toBe(false);
      expect(useChatStore.getState().loopIteration).toBe(1);

      useChatStore.getState().setApprovalMode(true);
      expect(useChatStore.getState().approvalMode).toBe(true);
      expect(useChatStore.getState().loopIteration).toBe(1);
    });
  });
});
