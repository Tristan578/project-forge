/**
 * Deep unit tests for chatStore — covering all actions, error paths,
 * streaming guards, persistence, tool call management, and entity picker.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useChatStore } from '../chatStore';
import type { ChatMessage, ToolCallStatus } from '../chatStore';

// Helper to build a message with tool calls
function makeAssistantMessage(
  overrides: Partial<ChatMessage> = {},
  toolCalls: Partial<ToolCallStatus>[] = [],
): ChatMessage {
  return {
    id: overrides.id ?? 'msg_test_1',
    role: 'assistant',
    content: overrides.content ?? 'Hello',
    timestamp: overrides.timestamp ?? Date.now(),
    toolCalls: toolCalls.map((tc, i) => ({
      id: tc.id ?? `tc_${i}`,
      name: tc.name ?? 'add_entity',
      input: tc.input ?? {},
      status: tc.status ?? 'success',
      undoable: tc.undoable ?? true,
      ...tc,
    })),
    ...overrides,
  };
}

function makeUserMessage(content = 'hi', overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: overrides.id ?? 'msg_user_1',
    role: 'user',
    content,
    timestamp: overrides.timestamp ?? Date.now(),
    ...overrides,
  };
}

describe('chatStore deep tests', () => {
  beforeEach(() => {
    useChatStore.setState({
      messages: [],
      isStreaming: false,
      activeModel: 'claude-sonnet-4-5-20250929',
      rightPanelTab: 'inspector',
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

  describe('stopStreaming', () => {
    it('aborts the controller and resets streaming state', () => {
      const controller = new AbortController();
      const abortSpy = vi.spyOn(controller, 'abort');

      useChatStore.setState({
        isStreaming: true,
        abortController: controller,
        loopIteration: 3,
      });

      useChatStore.getState().stopStreaming();

      expect(abortSpy).toHaveBeenCalled();
      const state = useChatStore.getState();
      expect(state.isStreaming).toBe(false);
      expect(state.abortController).toBeNull();
      expect(state.loopIteration).toBe(0);
    });

    it('does nothing when no abort controller exists', () => {
      useChatStore.setState({ isStreaming: false, abortController: null });

      // Should not throw
      useChatStore.getState().stopStreaming();

      expect(useChatStore.getState().isStreaming).toBe(false);
    });
  });

  describe('setModel', () => {
    it('sets model to claude-haiku', () => {
      useChatStore.getState().setModel('claude-haiku-4-5-20251001');
      expect(useChatStore.getState().activeModel).toBe('claude-haiku-4-5-20251001');
    });

    it('sets model to claude-sonnet', () => {
      useChatStore.getState().setModel('claude-sonnet-4-5-20250929');
      expect(useChatStore.getState().activeModel).toBe('claude-sonnet-4-5-20250929');
    });
  });

  describe('setRightPanelTab', () => {
    it('clears unread when switching to chat', () => {
      useChatStore.setState({ hasUnreadMessages: true });
      useChatStore.getState().setRightPanelTab('chat');

      expect(useChatStore.getState().hasUnreadMessages).toBe(false);
      expect(useChatStore.getState().rightPanelTab).toBe('chat');
    });

    it('does not clear unread when switching to inspector', () => {
      useChatStore.setState({ hasUnreadMessages: true });
      useChatStore.getState().setRightPanelTab('inspector');

      expect(useChatStore.getState().hasUnreadMessages).toBe(true);
      expect(useChatStore.getState().rightPanelTab).toBe('inspector');
    });

    it('switches to script tab', () => {
      useChatStore.getState().setRightPanelTab('script');
      expect(useChatStore.getState().rightPanelTab).toBe('script');
    });

    it('switches to ui tab', () => {
      useChatStore.getState().setRightPanelTab('ui');
      expect(useChatStore.getState().rightPanelTab).toBe('ui');
    });
  });

  describe('clearChat', () => {
    it('clears messages, error, and session tokens', () => {
      useChatStore.setState({
        messages: [makeUserMessage(), makeAssistantMessage()],
        error: 'some error',
        sessionTokens: { input: 100, output: 200 },
      });

      useChatStore.getState().clearChat();

      const state = useChatStore.getState();
      expect(state.messages).toHaveLength(0);
      expect(state.error).toBeNull();
      expect(state.sessionTokens).toEqual({ input: 0, output: 0 });
    });

    it('preserves other state like model and panel tab', () => {
      useChatStore.setState({
        activeModel: 'claude-haiku-4-5-20251001',
        rightPanelTab: 'chat',
        messages: [makeUserMessage()],
      });

      useChatStore.getState().clearChat();

      const state = useChatStore.getState();
      expect(state.activeModel).toBe('claude-haiku-4-5-20251001');
      expect(state.rightPanelTab).toBe('chat');
    });
  });

  describe('clearUnread', () => {
    it('sets hasUnreadMessages to false', () => {
      useChatStore.setState({ hasUnreadMessages: true });
      useChatStore.getState().clearUnread();
      expect(useChatStore.getState().hasUnreadMessages).toBe(false);
    });
  });

  describe('updateToolCall', () => {
    it('updates a specific tool call in a message', async () => {
      const msg = makeAssistantMessage({ id: 'msg1' }, [
        { id: 'tc1', name: 'add_entity', status: 'pending' },
        { id: 'tc2', name: 'set_material', status: 'pending' },
      ]);
      useChatStore.setState({ messages: [msg] });

      useChatStore.getState().updateToolCall('msg1', 'tc1', {
        status: 'success',
        result: { entityId: '123' },
      });

      await new Promise<void>((r) => queueMicrotask(r));

      const updated = useChatStore.getState().messages[0];
      expect(updated.toolCalls![0].status).toBe('success');
      expect(updated.toolCalls![0].result).toEqual({ entityId: '123' });
      // tc2 should be unchanged
      expect(updated.toolCalls![1].status).toBe('pending');
    });

    it('does nothing for non-existent message ID', async () => {
      const msg = makeAssistantMessage({ id: 'msg1' }, [{ id: 'tc1', status: 'pending' }]);
      useChatStore.setState({ messages: [msg] });

      useChatStore.getState().updateToolCall('nonexistent', 'tc1', { status: 'success' });

      await new Promise<void>((r) => queueMicrotask(r));

      // Original message unchanged
      expect(useChatStore.getState().messages[0].toolCalls![0].status).toBe('pending');
    });

    it('does nothing for non-existent tool call ID', async () => {
      const msg = makeAssistantMessage({ id: 'msg1' }, [{ id: 'tc1', status: 'pending' }]);
      useChatStore.setState({ messages: [msg] });

      useChatStore.getState().updateToolCall('msg1', 'nonexistent', { status: 'success' });

      await new Promise<void>((r) => queueMicrotask(r));

      expect(useChatStore.getState().messages[0].toolCalls![0].status).toBe('pending');
    });

    it('can update error status with error message', async () => {
      const msg = makeAssistantMessage({ id: 'msg1' }, [{ id: 'tc1', status: 'pending' }]);
      useChatStore.setState({ messages: [msg] });

      useChatStore.getState().updateToolCall('msg1', 'tc1', {
        status: 'error',
        error: 'Entity limit reached',
      });

      await new Promise<void>((r) => queueMicrotask(r));

      const tc = useChatStore.getState().messages[0].toolCalls![0];
      expect(tc.status).toBe('error');
      expect(tc.error).toBe('Entity limit reached');
    });
  });

  describe('rejectToolCalls', () => {
    it('marks all preview tool calls as rejected', () => {
      const msg = makeAssistantMessage({ id: 'msg1' }, [
        { id: 'tc1', status: 'preview' },
        { id: 'tc2', status: 'preview' },
        { id: 'tc3', status: 'success' },
      ]);
      useChatStore.setState({ messages: [msg] });

      useChatStore.getState().rejectToolCalls('msg1');

      const tcs = useChatStore.getState().messages[0].toolCalls!;
      expect(tcs[0].status).toBe('rejected');
      expect(tcs[1].status).toBe('rejected');
      expect(tcs[2].status).toBe('success'); // Already completed, not affected
    });

    it('does nothing for message without preview tool calls', () => {
      const msg = makeAssistantMessage({ id: 'msg1' }, [
        { id: 'tc1', status: 'success' },
      ]);
      useChatStore.setState({ messages: [msg] });

      useChatStore.getState().rejectToolCalls('msg1');

      expect(useChatStore.getState().messages[0].toolCalls![0].status).toBe('success');
    });

    it('does nothing for non-existent message', () => {
      useChatStore.setState({ messages: [] });
      // Should not throw
      expect(() => useChatStore.getState().rejectToolCalls('nonexistent')).not.toThrow();
    });
  });

  describe('setMessageFeedback', () => {
    it('sets positive feedback on a message', () => {
      const msg = makeAssistantMessage({ id: 'msg1' });
      useChatStore.setState({ messages: [msg] });

      useChatStore.getState().setMessageFeedback('msg1', 'positive');
      expect(useChatStore.getState().messages[0].feedback).toBe('positive');
    });

    it('sets negative feedback on a message', () => {
      const msg = makeAssistantMessage({ id: 'msg1' });
      useChatStore.setState({ messages: [msg] });

      useChatStore.getState().setMessageFeedback('msg1', 'negative');
      expect(useChatStore.getState().messages[0].feedback).toBe('negative');
    });

    it('clears feedback when set to null', () => {
      const msg = makeAssistantMessage({ id: 'msg1', feedback: 'positive' });
      useChatStore.setState({ messages: [msg] });

      useChatStore.getState().setMessageFeedback('msg1', null);
      expect(useChatStore.getState().messages[0].feedback).toBeNull();
    });

    it('only modifies the targeted message', () => {
      const msg1 = makeAssistantMessage({ id: 'msg1' });
      const msg2 = makeAssistantMessage({ id: 'msg2' });
      useChatStore.setState({ messages: [msg1, msg2] });

      useChatStore.getState().setMessageFeedback('msg1', 'positive');

      expect(useChatStore.getState().messages[0].feedback).toBe('positive');
      expect(useChatStore.getState().messages[1].feedback).toBeUndefined();
    });
  });

  describe('saveConversation / loadConversation', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('saves and loads conversation by project ID', async () => {
      const messages = [
        makeUserMessage('hello', { id: 'u1' }),
        makeAssistantMessage({ id: 'a1', content: 'Hi there!' }),
      ];
      useChatStore.setState({ messages });

      useChatStore.getState().saveConversation('proj-123');
      await vi.runAllTimersAsync();

      // Clear state
      useChatStore.setState({ messages: [], error: 'old error' });

      useChatStore.getState().loadConversation('proj-123');

      const loaded = useChatStore.getState();
      expect(loaded.messages).toHaveLength(2);
      expect(loaded.messages[0].content).toBe('hello');
      expect(loaded.messages[1].content).toBe('Hi there!');
      expect(loaded.error).toBeNull(); // Error cleared on load
    });

    it('truncates to MAX_STORED_MESSAGES on save', async () => {
      const messages: ChatMessage[] = [];
      for (let i = 0; i < 60; i++) {
        messages.push(makeUserMessage(`msg ${i}`, { id: `msg_${i}`, timestamp: i }));
      }
      useChatStore.setState({ messages });

      useChatStore.getState().saveConversation('proj-big');
      await vi.runAllTimersAsync();

      useChatStore.setState({ messages: [] });
      useChatStore.getState().loadConversation('proj-big');

      // Should be truncated to last 50
      expect(useChatStore.getState().messages).toHaveLength(50);
      expect(useChatStore.getState().messages[0].content).toBe('msg 10');
    });

    it('handles load of non-existent project gracefully', () => {
      useChatStore.setState({ messages: [makeUserMessage()] });

      useChatStore.getState().loadConversation('nonexistent-project');

      // Messages should remain unchanged
      expect(useChatStore.getState().messages).toHaveLength(1);
    });

    it('handles corrupt localStorage data gracefully', () => {
      localStorage.setItem('forge-chat-corrupt', '{{{invalid json');

      // Should not throw
      expect(() => useChatStore.getState().loadConversation('corrupt')).not.toThrow();
    });

    it('handles localStorage quota exceeded on save', async () => {
      // Fill localStorage near quota
      const mockSetItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('QuotaExceededError');
      });

      useChatStore.setState({ messages: [makeUserMessage()] });

      // Should not throw
      expect(() => useChatStore.getState().saveConversation('proj')).not.toThrow();
      await vi.runAllTimersAsync();

      mockSetItem.mockRestore();
    });

    it('saves to project-specific key', async () => {
      useChatStore.setState({ messages: [makeUserMessage('for A', { id: 'a' })] });
      useChatStore.getState().saveConversation('projA');
      await vi.runAllTimersAsync();

      useChatStore.setState({ messages: [makeUserMessage('for B', { id: 'b' })] });
      useChatStore.getState().saveConversation('projB');
      await vi.runAllTimersAsync();

      useChatStore.setState({ messages: [] });

      useChatStore.getState().loadConversation('projA');
      expect(useChatStore.getState().messages[0].content).toBe('for A');

      useChatStore.getState().loadConversation('projB');
      expect(useChatStore.getState().messages[0].content).toBe('for B');
    });
  });

  describe('entity picker actions', () => {
    it('shows and hides entity picker', () => {
      useChatStore.getState().setShowEntityPicker(true);
      expect(useChatStore.getState().showEntityPicker).toBe(true);

      useChatStore.getState().setShowEntityPicker(false);
      expect(useChatStore.getState().showEntityPicker).toBe(false);
    });

    it('sets entity picker filter', () => {
      useChatStore.getState().setEntityPickerFilter('cube');
      expect(useChatStore.getState().entityPickerFilter).toBe('cube');
    });

    it('clears entity picker filter', () => {
      useChatStore.getState().setEntityPickerFilter('cube');
      useChatStore.getState().setEntityPickerFilter('');
      expect(useChatStore.getState().entityPickerFilter).toBe('');
    });

    it('adds entity references', () => {
      useChatStore.getState().addEntityRef('Player', 'ent_001');
      useChatStore.getState().addEntityRef('Enemy', 'ent_002');

      const refs = useChatStore.getState().pendingEntityRefs;
      expect(refs).toEqual({ Player: 'ent_001', Enemy: 'ent_002' });
    });

    it('overwrites existing entity ref with same name', () => {
      useChatStore.getState().addEntityRef('Player', 'ent_001');
      useChatStore.getState().addEntityRef('Player', 'ent_999');

      expect(useChatStore.getState().pendingEntityRefs.Player).toBe('ent_999');
    });

    it('clears all entity references', () => {
      useChatStore.getState().addEntityRef('Player', 'ent_001');
      useChatStore.getState().addEntityRef('Enemy', 'ent_002');
      useChatStore.getState().clearEntityRefs();

      expect(useChatStore.getState().pendingEntityRefs).toEqual({});
    });
  });

  describe('thinking and approval mode', () => {
    it('toggles thinking enabled', () => {
      useChatStore.getState().setThinkingEnabled(true);
      expect(useChatStore.getState().thinkingEnabled).toBe(true);

      useChatStore.getState().setThinkingEnabled(false);
      expect(useChatStore.getState().thinkingEnabled).toBe(false);
    });

    it('toggles approval mode', () => {
      useChatStore.getState().setApprovalMode(true);
      expect(useChatStore.getState().approvalMode).toBe(true);

      useChatStore.getState().setApprovalMode(false);
      expect(useChatStore.getState().approvalMode).toBe(false);
    });
  });

  describe('sendMessage guard', () => {
    it('prevents sending when already streaming', async () => {
      useChatStore.setState({ isStreaming: true });

      await useChatStore.getState().sendMessage('should be ignored');

      // No new messages added
      expect(useChatStore.getState().messages).toHaveLength(0);
    });
  });

  describe('batchUndoMessage', () => {
    it('does nothing for message without tool calls', () => {
      const msg = makeAssistantMessage({ id: 'msg1', toolCalls: undefined });
      useChatStore.setState({ messages: [msg] });

      // Should not throw
      useChatStore.getState().batchUndoMessage('msg1');
    });

    it('does nothing for message with no undoable completed tools', () => {
      const msg = makeAssistantMessage({ id: 'msg1' }, [
        { id: 'tc1', status: 'error', undoable: true },
        { id: 'tc2', status: 'success', undoable: false },
      ]);
      useChatStore.setState({ messages: [msg] });

      useChatStore.getState().batchUndoMessage('msg1');

      // No changes expected (no undoable + success tool calls)
      const tcs = useChatStore.getState().messages[0].toolCalls!;
      expect(tcs[0].status).toBe('error');
      expect(tcs[1].status).toBe('success');
    });

    it('does nothing for non-existent message', () => {
      useChatStore.setState({ messages: [] });
      expect(() => useChatStore.getState().batchUndoMessage('nonexistent')).not.toThrow();
    });
  });

  describe('initial state integrity', () => {
    it('starts with correct defaults', () => {
      const state = useChatStore.getState();
      expect(state.messages).toEqual([]);
      expect(state.isStreaming).toBe(false);
      expect(state.activeModel).toBe('claude-sonnet-4-5-20250929');
      expect(state.rightPanelTab).toBe('inspector');
      expect(state.error).toBeNull();
      expect(state.abortController).toBeNull();
      expect(state.thinkingEnabled).toBe(false);
      expect(state.loopIteration).toBe(0);
      expect(state.sessionTokens).toEqual({ input: 0, output: 0 });
      expect(state.hasUnreadMessages).toBe(false);
      expect(state.approvalMode).toBe(false);
      expect(state.showEntityPicker).toBe(false);
      expect(state.entityPickerFilter).toBe('');
      expect(state.pendingEntityRefs).toEqual({});
    });
  });

  describe('complex multi-message scenarios', () => {
    it('handles interleaved user and assistant messages correctly', async () => {
      const messages: ChatMessage[] = [
        makeUserMessage('create a cube', { id: 'u1' }),
        makeAssistantMessage({ id: 'a1', content: 'Creating cube...' }, [
          { id: 'tc1', name: 'add_entity', status: 'success' },
        ]),
        makeUserMessage('make it red', { id: 'u2' }),
        makeAssistantMessage({ id: 'a2', content: 'Setting material...' }, [
          { id: 'tc2', name: 'set_material', status: 'success' },
        ]),
      ];
      useChatStore.setState({ messages });

      // Update tool call in second assistant message
      useChatStore.getState().updateToolCall('a2', 'tc2', {
        result: { color: '#ff0000' },
      });

      await new Promise<void>((r) => queueMicrotask(r));

      const updated = useChatStore.getState().messages;
      expect(updated[3].toolCalls![0].result).toEqual({ color: '#ff0000' });
      // First message tool call unaffected
      expect(updated[1].toolCalls![0].result).toBeUndefined();
    });

    it('handles feedback on multiple messages independently', () => {
      const messages = [
        makeAssistantMessage({ id: 'a1', content: 'Response 1' }),
        makeAssistantMessage({ id: 'a2', content: 'Response 2' }),
        makeAssistantMessage({ id: 'a3', content: 'Response 3' }),
      ];
      useChatStore.setState({ messages });

      useChatStore.getState().setMessageFeedback('a1', 'positive');
      useChatStore.getState().setMessageFeedback('a2', 'negative');
      // a3 left without feedback

      const updated = useChatStore.getState().messages;
      expect(updated[0].feedback).toBe('positive');
      expect(updated[1].feedback).toBe('negative');
      expect(updated[2].feedback).toBeUndefined();
    });
  });
});
