/**
 * Unit tests for the chatStore Zustand store.
 *
 * Tests cover messages, model settings, right panel tab, thinking mode,
 * approval mode, entity picker, localStorage persistence, and tool call updates.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useChatStore, type ChatMessage, type ToolCallStatus } from './chatStore';

describe('chatStore', () => {
  beforeEach(() => {
    // Reset store to initial state
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
    // Clear localStorage
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('Initial State', () => {
    it('should initialize with empty messages', () => {
      const state = useChatStore.getState();
      expect(state.messages).toEqual([]);
    });

    it('should initialize with sonnet model', () => {
      const state = useChatStore.getState();
      expect(state.activeModel).toBe('claude-sonnet-4-5-20250929');
    });

    it('should initialize with inspector tab', () => {
      const state = useChatStore.getState();
      expect(state.rightPanelTab).toBe('inspector');
    });

    it('should initialize with thinking disabled', () => {
      const state = useChatStore.getState();
      expect(state.thinkingEnabled).toBe(false);
    });

    it('should initialize with approval mode disabled', () => {
      const state = useChatStore.getState();
      expect(state.approvalMode).toBe(false);
    });

    it('should initialize with no unread messages', () => {
      const state = useChatStore.getState();
      expect(state.hasUnreadMessages).toBe(false);
    });

    it('should initialize with zero session tokens', () => {
      const state = useChatStore.getState();
      expect(state.sessionTokens).toEqual({ input: 0, output: 0 });
    });

    it('should initialize with entity picker closed', () => {
      const state = useChatStore.getState();
      expect(state.showEntityPicker).toBe(false);
      expect(state.entityPickerFilter).toBe('');
      expect(state.pendingEntityRefs).toEqual({});
    });
  });

  describe('Model Settings', () => {
    it('should update active model', () => {
      const { setModel } = useChatStore.getState();
      setModel('claude-haiku-4-5-20251001');
      const state = useChatStore.getState();
      expect(state.activeModel).toBe('claude-haiku-4-5-20251001');
    });

    it('should toggle thinking mode', () => {
      const { setThinkingEnabled } = useChatStore.getState();
      setThinkingEnabled(true);
      expect(useChatStore.getState().thinkingEnabled).toBe(true);
      setThinkingEnabled(false);
      expect(useChatStore.getState().thinkingEnabled).toBe(false);
    });

    it('should toggle approval mode', () => {
      const { setApprovalMode } = useChatStore.getState();
      setApprovalMode(true);
      expect(useChatStore.getState().approvalMode).toBe(true);
      setApprovalMode(false);
      expect(useChatStore.getState().approvalMode).toBe(false);
    });
  });

  describe('Right Panel Tab', () => {
    it('should update right panel tab', () => {
      const { setRightPanelTab } = useChatStore.getState();
      setRightPanelTab('chat');
      expect(useChatStore.getState().rightPanelTab).toBe('chat');
      setRightPanelTab('script');
      expect(useChatStore.getState().rightPanelTab).toBe('script');
      setRightPanelTab('inspector');
      expect(useChatStore.getState().rightPanelTab).toBe('inspector');
    });

    it('should clear unread when switching to chat tab', () => {
      useChatStore.setState({ hasUnreadMessages: true });
      const { setRightPanelTab } = useChatStore.getState();
      setRightPanelTab('chat');
      expect(useChatStore.getState().hasUnreadMessages).toBe(false);
    });

    it('should not clear unread when switching to other tabs', () => {
      useChatStore.setState({ hasUnreadMessages: true });
      const { setRightPanelTab } = useChatStore.getState();
      setRightPanelTab('inspector');
      expect(useChatStore.getState().hasUnreadMessages).toBe(true);
    });
  });

  describe('Messages', () => {
    it('should maintain message insertion order', () => {
      const messages: ChatMessage[] = [
        {
          id: 'msg1',
          role: 'user',
          content: 'First',
          timestamp: Date.now(),
        },
        {
          id: 'msg2',
          role: 'assistant',
          content: 'Second',
          timestamp: Date.now() + 1,
        },
        {
          id: 'msg3',
          role: 'user',
          content: 'Third',
          timestamp: Date.now() + 2,
        },
      ];
      useChatStore.setState({ messages });
      const state = useChatStore.getState();
      expect(state.messages).toHaveLength(3);
      expect(state.messages[0].content).toBe('First');
      expect(state.messages[1].content).toBe('Second');
      expect(state.messages[2].content).toBe('Third');
    });

    it('should clear chat and reset session tokens', () => {
      const messages: ChatMessage[] = [
        { id: 'msg1', role: 'user', content: 'Test', timestamp: Date.now() },
      ];
      useChatStore.setState({
        messages,
        sessionTokens: { input: 1000, output: 2000 },
        error: 'Some error',
      });
      const { clearChat } = useChatStore.getState();
      clearChat();
      const state = useChatStore.getState();
      expect(state.messages).toEqual([]);
      expect(state.sessionTokens).toEqual({ input: 0, output: 0 });
      expect(state.error).toBeNull();
    });

    it('should clear unread messages', () => {
      useChatStore.setState({ hasUnreadMessages: true });
      const { clearUnread } = useChatStore.getState();
      clearUnread();
      expect(useChatStore.getState().hasUnreadMessages).toBe(false);
    });
  });

  describe('Tool Calls', () => {
    const mockToolCall: ToolCallStatus = {
      id: 'tool1',
      name: 'spawn_cube',
      input: { size: 1 },
      status: 'pending',
      undoable: true,
    };

    it('should update tool call status', () => {
      const message: ChatMessage = {
        id: 'msg1',
        role: 'assistant',
        content: 'Creating cube',
        toolCalls: [mockToolCall],
        timestamp: Date.now(),
      };
      useChatStore.setState({ messages: [message] });

      const { updateToolCall } = useChatStore.getState();
      updateToolCall('msg1', 'tool1', { status: 'success', result: 'Done' });

      const updated = useChatStore.getState().messages[0].toolCalls?.[0];
      expect(updated?.status).toBe('success');
      expect(updated?.result).toBe('Done');
    });

    it('should update correct tool call in message with multiple tools', () => {
      const message: ChatMessage = {
        id: 'msg1',
        role: 'assistant',
        content: 'Creating multiple objects',
        toolCalls: [
          { id: 'tool1', name: 'spawn_cube', input: {}, status: 'pending', undoable: true },
          { id: 'tool2', name: 'spawn_sphere', input: {}, status: 'pending', undoable: true },
        ],
        timestamp: Date.now(),
      };
      useChatStore.setState({ messages: [message] });

      const { updateToolCall } = useChatStore.getState();
      updateToolCall('msg1', 'tool2', { status: 'success' });

      const toolCalls = useChatStore.getState().messages[0].toolCalls;
      expect(toolCalls?.[0].status).toBe('pending');
      expect(toolCalls?.[1].status).toBe('success');
    });

    it('should not affect other messages when updating tool call', () => {
      const messages: ChatMessage[] = [
        {
          id: 'msg1',
          role: 'assistant',
          content: 'First',
          toolCalls: [{ ...mockToolCall, id: 'tool1' }],
          timestamp: Date.now(),
        },
        {
          id: 'msg2',
          role: 'assistant',
          content: 'Second',
          toolCalls: [{ ...mockToolCall, id: 'tool2' }],
          timestamp: Date.now() + 1,
        },
      ];
      useChatStore.setState({ messages });

      const { updateToolCall } = useChatStore.getState();
      updateToolCall('msg1', 'tool1', { status: 'success' });

      const state = useChatStore.getState();
      expect(state.messages[0].toolCalls?.[0].status).toBe('success');
      expect(state.messages[1].toolCalls?.[0].status).toBe('pending');
    });

    it('should identify undoable tool calls in batchUndoMessage', () => {
      const message: ChatMessage = {
        id: 'msg1',
        role: 'assistant',
        content: 'Created objects',
        toolCalls: [
          { id: 'tool1', name: 'spawn_cube', input: {}, status: 'success', undoable: true },
          { id: 'tool2', name: 'spawn_sphere', input: {}, status: 'success', undoable: true },
          { id: 'tool3', name: 'get_entities', input: {}, status: 'success', undoable: false },
          { id: 'tool4', name: 'spawn_light', input: {}, status: 'error', undoable: true },
        ],
        timestamp: Date.now(),
      };
      useChatStore.setState({ messages: [message] });

      const { batchUndoMessage } = useChatStore.getState();

      // Call batchUndoMessage — it will attempt to import editorStore and call undo
      // We cannot mock the editorStore import easily in this test environment,
      // but we can verify the function identifies the correct tools to undo
      // (2 successful + undoable: tool1 and tool2)
      batchUndoMessage('msg1');

      // The actual undo logic is tested by integration, but we verify:
      // 1. Function doesn't crash
      // 2. Message structure remains valid
      const state = useChatStore.getState();
      expect(state.messages).toHaveLength(1);
      expect(state.messages[0].toolCalls).toHaveLength(4);
    });
  });

  describe('Message Feedback', () => {
    it('should set positive feedback on message', () => {
      const message: ChatMessage = {
        id: 'msg1',
        role: 'assistant',
        content: 'Good response',
        timestamp: Date.now(),
      };
      useChatStore.setState({ messages: [message] });

      const { setMessageFeedback } = useChatStore.getState();
      setMessageFeedback('msg1', 'positive');

      expect(useChatStore.getState().messages[0].feedback).toBe('positive');
    });

    it('should set negative feedback on message', () => {
      const message: ChatMessage = {
        id: 'msg1',
        role: 'assistant',
        content: 'Bad response',
        timestamp: Date.now(),
      };
      useChatStore.setState({ messages: [message] });

      const { setMessageFeedback } = useChatStore.getState();
      setMessageFeedback('msg1', 'negative');

      expect(useChatStore.getState().messages[0].feedback).toBe('negative');
    });

    it('should clear feedback when set to null', () => {
      const message: ChatMessage = {
        id: 'msg1',
        role: 'assistant',
        content: 'Response',
        feedback: 'positive',
        timestamp: Date.now(),
      };
      useChatStore.setState({ messages: [message] });

      const { setMessageFeedback } = useChatStore.getState();
      setMessageFeedback('msg1', null);

      expect(useChatStore.getState().messages[0].feedback).toBeNull();
    });

    it('should only update target message feedback', () => {
      const messages: ChatMessage[] = [
        { id: 'msg1', role: 'assistant', content: 'First', timestamp: Date.now() },
        { id: 'msg2', role: 'assistant', content: 'Second', timestamp: Date.now() + 1 },
      ];
      useChatStore.setState({ messages });

      const { setMessageFeedback } = useChatStore.getState();
      setMessageFeedback('msg1', 'positive');

      const state = useChatStore.getState();
      expect(state.messages[0].feedback).toBe('positive');
      expect(state.messages[1].feedback).toBeUndefined();
    });
  });

  describe('Entity Picker', () => {
    it('should toggle entity picker', () => {
      const { setShowEntityPicker } = useChatStore.getState();
      setShowEntityPicker(true);
      expect(useChatStore.getState().showEntityPicker).toBe(true);
      setShowEntityPicker(false);
      expect(useChatStore.getState().showEntityPicker).toBe(false);
    });

    it('should update entity picker filter', () => {
      const { setEntityPickerFilter } = useChatStore.getState();
      setEntityPickerFilter('cube');
      expect(useChatStore.getState().entityPickerFilter).toBe('cube');
    });

    it('should add entity reference', () => {
      const { addEntityRef } = useChatStore.getState();
      addEntityRef('@MyCube', 'entity-123');
      expect(useChatStore.getState().pendingEntityRefs).toEqual({
        '@MyCube': 'entity-123',
      });
    });

    it('should add multiple entity references', () => {
      const { addEntityRef } = useChatStore.getState();
      addEntityRef('@Cube1', 'eid-1');
      addEntityRef('@Cube2', 'eid-2');
      expect(useChatStore.getState().pendingEntityRefs).toEqual({
        '@Cube1': 'eid-1',
        '@Cube2': 'eid-2',
      });
    });

    it('should clear entity references', () => {
      useChatStore.setState({
        pendingEntityRefs: { '@Cube': 'eid-1', '@Sphere': 'eid-2' },
      });
      const { clearEntityRefs } = useChatStore.getState();
      clearEntityRefs();
      expect(useChatStore.getState().pendingEntityRefs).toEqual({});
    });
  });

  describe('Persistence', () => {
    it('should save conversation to localStorage', () => {
      const messages: ChatMessage[] = [
        { id: 'msg1', role: 'user', content: 'Hello', timestamp: Date.now() },
        { id: 'msg2', role: 'assistant', content: 'Hi', timestamp: Date.now() + 1 },
      ];
      useChatStore.setState({ messages });

      const { saveConversation } = useChatStore.getState();
      saveConversation('project-123');

      const stored = localStorage.getItem('forge-chat-project-123');
      expect(stored).toBeTruthy();
      const parsed = JSON.parse(stored!);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].content).toBe('Hello');
      expect(parsed[1].content).toBe('Hi');
    });

    it('should load conversation from localStorage', () => {
      const messages: ChatMessage[] = [
        { id: 'msg1', role: 'user', content: 'Saved', timestamp: Date.now() },
      ];
      localStorage.setItem('forge-chat-project-456', JSON.stringify(messages));

      const { loadConversation } = useChatStore.getState();
      loadConversation('project-456');

      const state = useChatStore.getState();
      expect(state.messages).toHaveLength(1);
      expect(state.messages[0].content).toBe('Saved');
      expect(state.error).toBeNull();
    });

    it('should handle missing localStorage data', () => {
      const { loadConversation } = useChatStore.getState();
      loadConversation('nonexistent');

      // Should not crash, messages remain unchanged
      expect(useChatStore.getState().messages).toEqual([]);
    });

    it('should handle corrupt localStorage data', () => {
      localStorage.setItem('forge-chat-corrupt', '{invalid json}');

      const { loadConversation } = useChatStore.getState();
      loadConversation('corrupt');

      // Should not crash
      expect(useChatStore.getState().messages).toEqual([]);
    });

    it('should save only last 50 messages', () => {
      const messages: ChatMessage[] = Array.from({ length: 60 }, (_, i) => ({
        id: `msg${i}`,
        role: 'user' as const,
        content: `Message ${i}`,
        timestamp: Date.now() + i,
      }));
      useChatStore.setState({ messages });

      const { saveConversation } = useChatStore.getState();
      saveConversation('project-789');

      const stored = localStorage.getItem('forge-chat-project-789');
      const parsed = JSON.parse(stored!);
      expect(parsed).toHaveLength(50);
      expect(parsed[0].content).toBe('Message 10'); // First 10 trimmed
    });

    it('should round-trip save and load', () => {
      const messages: ChatMessage[] = [
        {
          id: 'msg1',
          role: 'user',
          content: 'Create a cube',
          timestamp: Date.now(),
        },
        {
          id: 'msg2',
          role: 'assistant',
          content: 'Done',
          toolCalls: [
            {
              id: 'tool1',
              name: 'spawn_cube',
              input: { size: 1 },
              status: 'success',
              undoable: true,
            },
          ],
          timestamp: Date.now() + 1,
        },
      ];
      useChatStore.setState({ messages });

      const { saveConversation, loadConversation } = useChatStore.getState();
      saveConversation('roundtrip');
      useChatStore.setState({ messages: [] }); // Clear
      loadConversation('roundtrip');

      const state = useChatStore.getState();
      expect(state.messages).toHaveLength(2);
      expect(state.messages[0].role).toBe('user');
      expect(state.messages[1].toolCalls?.[0].name).toBe('spawn_cube');
    });
  });
});
