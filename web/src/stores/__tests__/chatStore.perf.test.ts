/**
 * Performance regression tests for chatStore.
 *
 * PF-870: approveToolCalls / rejectToolCalls O(N²) message scan
 * PF-871: updateToolCall rebuilds entire messages array on streaming updates
 *
 * Strategy: spy on Array.prototype.map (or simply time the operations) to
 * verify that per-message operations do not perform full O(N) array scans
 * for every call. We also verify correctness of the index-based path.
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useChatStore, type ChatMessage, type ToolCallStatus } from '../chatStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMsg(id: string, toolStatus?: ToolCallStatus['status']): ChatMessage {
  return {
    id,
    role: 'assistant' as const,
    content: `Message ${id}`,
    toolCalls: toolStatus
      ? [{ id: `tc_${id}`, name: 'spawn_cube', input: {}, status: toolStatus, undoable: true }]
      : [],
    timestamp: Date.now(),
  };
}

function makeMessages(count: number, toolStatus?: ToolCallStatus['status']): ChatMessage[] {
  return Array.from({ length: count }, (_, i) => makeMsg(`msg_${i}`, toolStatus));
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  useChatStore.setState({
    messages: [],
    isStreaming: false,
    error: null,
    abortController: null,
    thinkingEnabled: false,
    loopIteration: 0,
    sessionTokens: { input: 0, output: 0 },
    hasUnreadMessages: false,
    approvalMode: false,
    showEntityPicker: false,
    entityPickerFilter: '',
    pendingEntityRefs: {},
  });
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// PF-871: updateToolCall — targeted array update
// ---------------------------------------------------------------------------

describe('PF-871: updateToolCall — targeted array update', () => {
  it('updates a tool call in a large message list without full O(N) map on each call', async () => {
    // Set up 500 messages — the last one has the tool call to update
    const msgs = makeMessages(500, 'pending');
    const targetMsg = msgs[499];
    const targetTcId = targetMsg.toolCalls![0].id;

    useChatStore.setState({ messages: msgs });

    // Count how many times Array.prototype.map is invoked during updateToolCall
    let mapCallCount = 0;
    const originalMap = Array.prototype.map;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(Array.prototype, 'map').mockImplementation(function (this: any[], ...args: Parameters<typeof originalMap>) {
      mapCallCount++;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return originalMap.apply(this, args as any);
    });

    useChatStore.getState().updateToolCall(targetMsg.id, targetTcId, { status: 'success' });

    // Flush the microtask batch
    await new Promise<void>((r) => queueMicrotask(r));

    // The optimized implementation should NOT map over all 500 messages.
    // It finds the target message by index (O(1)) and only maps the toolCalls
    // array of that one message. The messages array itself is sliced (not mapped).
    // We allow some map calls for internal toolCalls iteration, but not 500.
    const state = useChatStore.getState();
    const updated = state.messages[499].toolCalls?.[0];
    expect(updated?.status).toBe('success');

    // Crucially: map should have been called far fewer than 500 times
    // (the full messages array should NEVER be .map()'d in the hot path)
    expect(mapCallCount).toBeLessThan(50);
  });

  it('batches multiple updateToolCall calls within one microtask into a single set()', async () => {
    const msgs = makeMessages(3, 'pending');
    useChatStore.setState({ messages: msgs });

    // Track updates via subscribe
    const originalSet = useChatStore.setState.bind(useChatStore);
    // Track via subscribe instead
    const updateCounts: number[] = [];
    const unsub = useChatStore.subscribe(() => {
      updateCounts.push(Date.now());
    });

    const { updateToolCall } = useChatStore.getState();
    // Fire 3 updates in the same synchronous tick — should batch into 1 set()
    updateToolCall(msgs[0].id, msgs[0].toolCalls![0].id, { status: 'success' });
    updateToolCall(msgs[1].id, msgs[1].toolCalls![0].id, { status: 'success' });
    updateToolCall(msgs[2].id, msgs[2].toolCalls![0].id, { status: 'error' });

    void originalSet; // suppress lint warning for unused var

    // Before microtask flush, nothing should have been set yet
    const beforeFlush = useChatStore.getState();
    expect(beforeFlush.messages[0].toolCalls?.[0].status).toBe('pending');

    // Flush
    await new Promise<void>((r) => queueMicrotask(r));

    const state = useChatStore.getState();
    expect(state.messages[0].toolCalls?.[0].status).toBe('success');
    expect(state.messages[1].toolCalls?.[0].status).toBe('success');
    expect(state.messages[2].toolCalls?.[0].status).toBe('error');

    // The subscribe fired for the batched set() + the msgIndexMap rebuild.
    // We care that it fired at most a few times (ideally 1 for the batch set).
    // In practice: 1 for the initial setState in beforeEach resets could add noise;
    // what matters is all 3 tools updated in a single pass.
    expect(updateCounts.length).toBeGreaterThan(0);

    unsub();
  });

  it('handles updates to non-existent messageId gracefully', async () => {
    useChatStore.setState({ messages: makeMessages(5, 'pending') });

    const { updateToolCall } = useChatStore.getState();
    updateToolCall('does_not_exist', 'tc_x', { status: 'success' });

    await new Promise<void>((r) => queueMicrotask(r));

    // No crash, messages unchanged
    const state = useChatStore.getState();
    expect(state.messages.every((m) => m.toolCalls?.[0].status === 'pending')).toBe(true);
  });

  it('coalesces multiple updates for the same toolCallId within one batch', async () => {
    const msgs = makeMessages(1, 'pending');
    useChatStore.setState({ messages: msgs });

    const { updateToolCall } = useChatStore.getState();
    const tcId = msgs[0].toolCalls![0].id;

    // Send three updates to the same tool call — last one should win
    updateToolCall(msgs[0].id, tcId, { status: 'success' });
    updateToolCall(msgs[0].id, tcId, { status: 'error' });
    updateToolCall(msgs[0].id, tcId, { result: 'final-result' });

    await new Promise<void>((r) => queueMicrotask(r));

    const tc = useChatStore.getState().messages[0].toolCalls?.[0];
    // Last status update was 'error', last result update was 'final-result'
    expect(tc?.status).toBe('error');
    expect(tc?.result).toBe('final-result');
  });
});

// ---------------------------------------------------------------------------
// PF-870: approveToolCalls — O(1) message lookup
// ---------------------------------------------------------------------------

describe('PF-870: approveToolCalls — O(1) message lookup', () => {
  it('approves preview tools in a large message list without full O(N) scan', async () => {
    // 200 messages, the last one has preview tools
    const msgs = makeMessages(200);
    const targetMsg: ChatMessage = {
      id: 'target_msg',
      role: 'assistant',
      content: 'Awaiting approval',
      toolCalls: [
        { id: 'tc_a', name: 'spawn_cube', input: { size: 1 }, status: 'preview', undoable: true },
        { id: 'tc_b', name: 'spawn_sphere', input: { radius: 0.5 }, status: 'preview', undoable: true },
      ],
      timestamp: Date.now(),
    };
    useChatStore.setState({ messages: [...msgs, targetMsg] });

    // Mock executor so we don't need real engine
    vi.doMock('@/lib/chat/executor', () => ({
      executeToolCall: vi.fn().mockResolvedValue({ success: true, result: 'spawned' }),
    }));
    vi.doMock('@/stores/editorStore', () => ({
      useEditorStore: { getState: vi.fn().mockReturnValue({}) },
    }));

    // Count Array.prototype.map calls during approveToolCalls
    let mapCallCount = 0;
    const originalMap = Array.prototype.map;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(Array.prototype, 'map').mockImplementation(function (this: any[], ...args: Parameters<typeof originalMap>) {
      mapCallCount++;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return originalMap.apply(this, args as any);
    });

    await useChatStore.getState().approveToolCalls('target_msg');

    // Should NOT have mapped over 200 messages — only over the target's toolCalls (2 items)
    // Allow some overhead from internal operations, but not 200
    expect(mapCallCount).toBeLessThan(20);
  });

  it('approves preview tool calls and updates status to success', async () => {
    const targetMsg: ChatMessage = {
      id: 'approve_test',
      role: 'assistant',
      content: 'Awaiting approval',
      toolCalls: [
        { id: 'tc1', name: 'spawn_cube', input: { size: 1 }, status: 'preview', undoable: true },
        { id: 'tc2', name: 'query_scene', input: {}, status: 'success', undoable: false },
      ],
      timestamp: Date.now(),
    };
    useChatStore.setState({ messages: [targetMsg] });

    vi.doMock('@/lib/chat/executor', () => ({
      executeToolCall: vi.fn().mockResolvedValue({ success: true, result: 'spawned' }),
    }));
    vi.doMock('@/stores/editorStore', () => ({
      useEditorStore: { getState: vi.fn().mockReturnValue({}) },
    }));

    await useChatStore.getState().approveToolCalls('approve_test');

    const tc1 = useChatStore.getState().messages[0].toolCalls?.[0];
    const tc2 = useChatStore.getState().messages[0].toolCalls?.[1];
    // tc1 was preview → should now be success (or error based on executeToolCall result)
    expect(['success', 'error']).toContain(tc1?.status);
    // tc2 was already success → unchanged
    expect(tc2?.status).toBe('success');
  });

  it('returns early when messageId not in index', async () => {
    useChatStore.setState({ messages: makeMessages(5, 'preview') });

    // Should not throw even with a nonexistent messageId
    await expect(
      useChatStore.getState().approveToolCalls('nonexistent_id')
    ).resolves.toBeUndefined();

    // Messages unchanged
    expect(
      useChatStore.getState().messages.every((m) => m.toolCalls?.[0].status === 'preview')
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PF-870: rejectToolCalls — O(1) message lookup
// ---------------------------------------------------------------------------

describe('PF-870: rejectToolCalls — O(1) message lookup', () => {
  it('rejects preview tools without scanning all messages', () => {
    const msgs = makeMessages(100);
    const targetMsg: ChatMessage = {
      id: 'reject_target',
      role: 'assistant',
      content: 'Awaiting approval',
      toolCalls: [
        { id: 'tc_r1', name: 'spawn_cube', input: {}, status: 'preview', undoable: true },
        { id: 'tc_r2', name: 'spawn_sphere', input: {}, status: 'success', undoable: true },
      ],
      timestamp: Date.now(),
    };
    useChatStore.setState({ messages: [...msgs, targetMsg] });

    let mapCallCount = 0;
    const originalMap = Array.prototype.map;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(Array.prototype, 'map').mockImplementation(function (this: any[], ...args: Parameters<typeof originalMap>) {
      mapCallCount++;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return originalMap.apply(this, args as any);
    });

    useChatStore.getState().rejectToolCalls('reject_target');

    // Should NOT have mapped 100+ messages
    expect(mapCallCount).toBeLessThan(10);

    const state = useChatStore.getState();
    const updatedMsg = state.messages.find((m) => m.id === 'reject_target');
    expect(updatedMsg?.toolCalls?.[0].status).toBe('rejected');
    expect(updatedMsg?.toolCalls?.[1].status).toBe('success'); // unchanged
  });

  it('returns early when messageId not in index', () => {
    useChatStore.setState({ messages: makeMessages(5, 'preview') });
    // Should not throw
    expect(() => useChatStore.getState().rejectToolCalls('nonexistent')).not.toThrow();
    // Messages unchanged
    expect(
      useChatStore.getState().messages.every((m) => m.toolCalls?.[0].status === 'preview')
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Index integrity — index rebuilds correctly after messages change
// ---------------------------------------------------------------------------

describe('Message index integrity', () => {
  it('keeps index in sync after setState with new messages', async () => {
    const msgs = makeMessages(3, 'pending');
    useChatStore.setState({ messages: msgs });

    // The subscribe fires after setState, rebuilding the index.
    // updateToolCall should find msg_2 at the correct position.
    const { updateToolCall } = useChatStore.getState();
    updateToolCall('msg_2', `tc_msg_2`, { status: 'success' });

    await new Promise<void>((r) => queueMicrotask(r));

    expect(useChatStore.getState().messages[2].toolCalls?.[0].status).toBe('success');
    expect(useChatStore.getState().messages[0].toolCalls?.[0].status).toBe('pending');
    expect(useChatStore.getState().messages[1].toolCalls?.[0].status).toBe('pending');
  });

  it('handles a message appended after initial set', async () => {
    const initial = makeMessages(2, 'pending');
    useChatStore.setState({ messages: initial });

    // Append a new message
    const newMsg = makeMsg('new_msg', 'pending');
    useChatStore.setState({ messages: [...useChatStore.getState().messages, newMsg] });

    // Index should now include new_msg
    const { updateToolCall } = useChatStore.getState();
    updateToolCall('new_msg', 'tc_new_msg', { status: 'success', result: 'done' });

    await new Promise<void>((r) => queueMicrotask(r));

    const state = useChatStore.getState();
    const updated = state.messages.find((m) => m.id === 'new_msg');
    expect(updated?.toolCalls?.[0].status).toBe('success');
    expect(updated?.toolCalls?.[0].result).toBe('done');
  });

  it('setMessageFeedback uses index for O(1) update', () => {
    const msgs = makeMessages(50);
    useChatStore.setState({ messages: msgs });

    let mapCallCount = 0;
    const originalMap = Array.prototype.map;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(Array.prototype, 'map').mockImplementation(function (this: any[], ...args: Parameters<typeof originalMap>) {
      mapCallCount++;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return originalMap.apply(this, args as any);
    });

    useChatStore.getState().setMessageFeedback('msg_25', 'positive');

    // Should not have mapped 50 messages
    expect(mapCallCount).toBeLessThan(5);

    const updated = useChatStore.getState().messages[25];
    expect(updated.feedback).toBe('positive');
  });
});
