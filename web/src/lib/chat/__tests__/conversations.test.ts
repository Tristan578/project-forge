import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useChatStore, type ChatMessage } from '@/stores/chatStore';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
  };
})();

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

// Mock the dynamic imports that sendMessage uses
vi.mock('@/stores/editorStore', () => ({
  useEditorStore: { getState: () => ({}) },
}));

vi.mock('@/lib/chat/context', () => ({
  buildSceneContext: () => '',
}));

vi.mock('@/lib/chat/executor', () => ({
  executeToolCall: vi.fn(),
}));

function makeMessage(role: 'user' | 'assistant', content: string): ChatMessage {
  return {
    id: `msg_${Date.now()}_${Math.random()}`,
    role,
    content,
    timestamp: Date.now(),
  };
}

describe('Conversation Management', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
    useChatStore.setState({
      messages: [],
      conversations: [],
      activeConversationId: null,
      error: null,
      sessionTokens: { input: 0, output: 0 },
    });
  });

  describe('createConversation', () => {
    it('creates a new conversation with a name', () => {
      const id = useChatStore.getState().createConversation('Test Chat');
      const state = useChatStore.getState();
      expect(state.conversations.length).toBe(1);
      expect(state.conversations[0].name).toBe('Test Chat');
      expect(state.activeConversationId).toBe(id);
      expect(state.messages).toEqual([]);
    });

    it('auto-names conversation when no name provided', () => {
      useChatStore.getState().createConversation();
      const state = useChatStore.getState();
      expect(state.conversations[0].name).toBe('Chat 1');
    });

    it('saves existing messages to previous conversation', () => {
      const msgs = [makeMessage('user', 'Hello'), makeMessage('assistant', 'Hi')];
      useChatStore.setState({ messages: msgs });

      useChatStore.getState().createConversation('Second Chat');
      const state = useChatStore.getState();
      // Should have 2 conversations: auto-saved and the new one
      expect(state.conversations.length).toBe(2);
      // The auto-saved one should have the old messages
      const autoConv = state.conversations.find((c) => c.id !== state.activeConversationId);
      expect(autoConv?.messages.length).toBe(2);
    });

    it('persists conversations to localStorage', () => {
      useChatStore.getState().createConversation('Persisted');
      expect(localStorageMock.setItem).toHaveBeenCalled();
    });

    it('limits to MAX_CONVERSATIONS', () => {
      for (let i = 0; i < 25; i++) {
        useChatStore.getState().createConversation(`Chat ${i}`);
      }
      const state = useChatStore.getState();
      expect(state.conversations.length).toBeLessThanOrEqual(20);
    });
  });

  describe('switchConversation', () => {
    it('switches to an existing conversation and loads its messages', () => {
      const id1 = useChatStore.getState().createConversation('Chat 1');
      const msgs = [makeMessage('user', 'In chat 1')];
      useChatStore.setState({ messages: msgs });

      useChatStore.getState().createConversation('Chat 2');
      useChatStore.setState({ messages: [makeMessage('user', 'In chat 2')] });

      // Switch back to Chat 1
      useChatStore.getState().switchConversation(id1);
      const state = useChatStore.getState();
      expect(state.activeConversationId).toBe(id1);
      // Should have the saved messages from chat 1
      expect(state.messages.length).toBe(1);
      expect(state.messages[0].content).toBe('In chat 1');
    });

    it('saves current conversation before switching', () => {
      useChatStore.getState().createConversation('Chat 1');
      useChatStore.setState({ messages: [makeMessage('user', 'Saved')] });

      const id2 = useChatStore.getState().createConversation('Chat 2');
      // Chat 1 messages should be saved in conversations
      const state = useChatStore.getState();
      const chat1 = state.conversations.find((c) => c.id !== id2 && c.name === 'Chat 1');
      expect(chat1?.messages.length).toBe(1);
    });

    it('ignores switch to non-existent conversation', () => {
      useChatStore.getState().createConversation('Chat 1');
      const prevState = useChatStore.getState();
      useChatStore.getState().switchConversation('nonexistent');
      const state = useChatStore.getState();
      expect(state.activeConversationId).toBe(prevState.activeConversationId);
    });
  });

  describe('deleteConversation', () => {
    it('deletes a conversation', () => {
      const id1 = useChatStore.getState().createConversation('Chat 1');
      useChatStore.getState().createConversation('Chat 2');
      useChatStore.getState().deleteConversation(id1);
      const state = useChatStore.getState();
      expect(state.conversations.find((c) => c.id === id1)).toBeUndefined();
    });

    it('switches to latest conversation when active is deleted', () => {
      useChatStore.getState().createConversation('Chat 1');
      const id2 = useChatStore.getState().createConversation('Chat 2');
      useChatStore.getState().deleteConversation(id2);
      const state = useChatStore.getState();
      expect(state.activeConversationId).not.toBe(id2);
    });

    it('clears messages when last conversation is deleted', () => {
      const id = useChatStore.getState().createConversation('Only');
      useChatStore.getState().deleteConversation(id);
      const state = useChatStore.getState();
      expect(state.conversations.length).toBe(0);
      expect(state.messages).toEqual([]);
    });
  });

  describe('renameConversation', () => {
    it('renames a conversation', () => {
      const id = useChatStore.getState().createConversation('Old Name');
      useChatStore.getState().renameConversation(id, 'New Name');
      const state = useChatStore.getState();
      expect(state.conversations.find((c) => c.id === id)?.name).toBe('New Name');
    });

    it('persists rename to localStorage', () => {
      const id = useChatStore.getState().createConversation('Before');
      localStorageMock.setItem.mockClear();
      useChatStore.getState().renameConversation(id, 'After');
      expect(localStorageMock.setItem).toHaveBeenCalled();
    });
  });

  describe('loadConversations', () => {
    it('loads conversations from localStorage', () => {
      const stored = [
        { id: 'conv_1', name: 'Loaded', messages: [], createdAt: 1, updatedAt: 1 },
      ];
      localStorageMock.getItem.mockReturnValueOnce(JSON.stringify(stored));
      useChatStore.getState().loadConversations();
      const state = useChatStore.getState();
      expect(state.conversations.length).toBe(1);
      expect(state.conversations[0].name).toBe('Loaded');
    });

    it('handles corrupt localStorage data gracefully', () => {
      localStorageMock.getItem.mockReturnValueOnce('invalid json');
      useChatStore.getState().loadConversations();
      // Should not throw, conversations remain empty
      expect(useChatStore.getState().conversations).toEqual([]);
    });
  });
});
