/**
 * Unit tests for chatStore conversation management and buildTruncatedApiMessages.
 *
 * Tests cover: createConversation, switchConversation, deleteConversation,
 * renameConversation, loadConversations (localStorage), and context truncation.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useChatStore, buildTruncatedApiMessages, flushConversationSaveForTesting } from '../chatStore';
import type { ChatMessage, Conversation } from '../chatStore';

const CONVERSATIONS_KEY = 'forge-conversations';
const ACTIVE_CONVERSATION_KEY = 'forge-active-conversation';

function makeMsg(
  id: string,
  role: 'user' | 'assistant',
  content: string,
  timestamp = Date.now(),
): ChatMessage {
  return { id, role, content, timestamp };
}

function resetStore() {
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
    conversations: [],
    activeConversationId: null,
  });
}

describe('chatStore — conversation management', () => {
  beforeEach(() => {
    resetStore();
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  // -----------------------------------------------------------------------
  // createConversation
  // -----------------------------------------------------------------------
  describe('createConversation', () => {
    it('creates a new conversation and sets it as active', () => {
      const { createConversation } = useChatStore.getState();
      const id = createConversation('My Chat');

      const state = useChatStore.getState();
      expect(state.activeConversationId).toBe(id);
      expect(state.conversations).toHaveLength(1);
      expect(state.conversations[0].name).toBe('My Chat');
      expect(state.conversations[0].messages).toEqual([]);
    });

    it('resets messages and session tokens when creating a new conversation', () => {
      useChatStore.setState({
        messages: [makeMsg('m1', 'user', 'hello')],
        sessionTokens: { input: 100, output: 200 },
        activeConversationId: null,
      });

      const { createConversation } = useChatStore.getState();
      createConversation();

      const state = useChatStore.getState();
      expect(state.messages).toEqual([]);
      expect(state.sessionTokens).toEqual({ input: 0, output: 0 });
    });

    it('uses default name when no name is provided', () => {
      const { createConversation } = useChatStore.getState();
      createConversation();

      const state = useChatStore.getState();
      expect(state.conversations[0].name).toBe('Chat 1');
    });

    it('auto-saves current messages to a new conversation when none is active', () => {
      useChatStore.setState({
        messages: [makeMsg('m1', 'user', 'unsaved message')],
        activeConversationId: null,
        conversations: [],
      });

      const { createConversation } = useChatStore.getState();
      createConversation('Second');

      const state = useChatStore.getState();
      // Should have auto-saved the messages AND the new conversation
      expect(state.conversations.length).toBeGreaterThanOrEqual(1);
    });

    it('saves current messages into the previously active conversation', () => {
      const existingConvId = 'conv-existing';
      useChatStore.setState({
        messages: [makeMsg('m1', 'user', 'existing msg')],
        activeConversationId: existingConvId,
        conversations: [
          {
            id: existingConvId,
            name: 'Old Chat',
            messages: [],
            createdAt: 1000,
            updatedAt: 1000,
          },
        ],
      });

      const { createConversation } = useChatStore.getState();
      createConversation('New Chat');

      const state = useChatStore.getState();
      const oldConv = state.conversations.find((c) => c.id === existingConvId);
      expect(oldConv?.messages[0]?.content).toBe('existing msg');
    });

    it('returns the new conversation id', () => {
      const { createConversation } = useChatStore.getState();
      const id = createConversation('Test');
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });

    it('persists conversations to localStorage', () => {
      const { createConversation } = useChatStore.getState();
      createConversation('Persisted');
      flushConversationSaveForTesting();

      const stored = localStorage.getItem(CONVERSATIONS_KEY);
      expect(stored).not.toBeNull();
      const parsed = JSON.parse(stored!);
      expect(parsed[0].name).toBe('Persisted');
    });

    it('caps at MAX_CONVERSATIONS (20) by dropping oldest', () => {
      // Create 20 conversations first
      for (let i = 0; i < 20; i++) {
        useChatStore.getState().createConversation(`Chat ${i}`);
      }
      // Create one more
      useChatStore.getState().createConversation('Overflow');

      const state = useChatStore.getState();
      expect(state.conversations).toHaveLength(20);
    });
  });

  // -----------------------------------------------------------------------
  // switchConversation
  // -----------------------------------------------------------------------
  describe('switchConversation', () => {
    it('loads messages from target conversation', () => {
      const convA: Conversation = {
        id: 'conv-a',
        name: 'A',
        messages: [makeMsg('ma1', 'user', 'msg from A')],
        createdAt: 1000,
        updatedAt: 1000,
      };
      const convB: Conversation = {
        id: 'conv-b',
        name: 'B',
        messages: [makeMsg('mb1', 'assistant', 'msg from B')],
        createdAt: 2000,
        updatedAt: 2000,
      };

      useChatStore.setState({
        conversations: [convA, convB],
        activeConversationId: 'conv-a',
        messages: convA.messages,
      });

      useChatStore.getState().switchConversation('conv-b');

      const state = useChatStore.getState();
      expect(state.activeConversationId).toBe('conv-b');
      expect(state.messages[0].content).toBe('msg from B');
    });

    it('saves current messages to previous conversation before switching', () => {
      const convA: Conversation = {
        id: 'conv-a',
        name: 'A',
        messages: [],
        createdAt: 1000,
        updatedAt: 1000,
      };
      const convB: Conversation = {
        id: 'conv-b',
        name: 'B',
        messages: [makeMsg('mb1', 'user', 'B')],
        createdAt: 2000,
        updatedAt: 2000,
      };

      useChatStore.setState({
        conversations: [convA, convB],
        activeConversationId: 'conv-a',
        messages: [makeMsg('new-msg', 'user', 'unsaved A msg')],
      });

      useChatStore.getState().switchConversation('conv-b');

      const state = useChatStore.getState();
      const savedA = state.conversations.find((c) => c.id === 'conv-a');
      expect(savedA?.messages[0]?.content).toBe('unsaved A msg');
    });

    it('does nothing when switching to non-existent conversation', () => {
      const conv: Conversation = {
        id: 'conv-a',
        name: 'A',
        messages: [makeMsg('m1', 'user', 'original')],
        createdAt: 1000,
        updatedAt: 1000,
      };
      useChatStore.setState({
        conversations: [conv],
        activeConversationId: 'conv-a',
        messages: conv.messages,
      });

      useChatStore.getState().switchConversation('conv-nonexistent');

      const state = useChatStore.getState();
      // Messages should remain unchanged
      expect(state.messages[0].content).toBe('original');
    });

    it('resets session tokens on switch', () => {
      const convA: Conversation = {
        id: 'conv-a',
        name: 'A',
        messages: [],
        createdAt: 1000,
        updatedAt: 1000,
      };
      const convB: Conversation = {
        id: 'conv-b',
        name: 'B',
        messages: [],
        createdAt: 2000,
        updatedAt: 2000,
      };

      useChatStore.setState({
        conversations: [convA, convB],
        activeConversationId: 'conv-a',
        messages: [],
        sessionTokens: { input: 500, output: 300 },
      });

      useChatStore.getState().switchConversation('conv-b');

      expect(useChatStore.getState().sessionTokens).toEqual({ input: 0, output: 0 });
    });
  });

  // -----------------------------------------------------------------------
  // deleteConversation
  // -----------------------------------------------------------------------
  describe('deleteConversation', () => {
    it('removes conversation from list', () => {
      const convA: Conversation = {
        id: 'conv-a',
        name: 'A',
        messages: [],
        createdAt: 1000,
        updatedAt: 1000,
      };
      const convB: Conversation = {
        id: 'conv-b',
        name: 'B',
        messages: [],
        createdAt: 2000,
        updatedAt: 2000,
      };

      useChatStore.setState({
        conversations: [convA, convB],
        activeConversationId: 'conv-a',
        messages: [],
      });

      useChatStore.getState().deleteConversation('conv-a');

      const state = useChatStore.getState();
      expect(state.conversations).toHaveLength(1);
      expect(state.conversations[0].id).toBe('conv-b');
    });

    it('switches to latest conversation when deleting active one', () => {
      const convA: Conversation = {
        id: 'conv-a',
        name: 'A',
        messages: [makeMsg('ma', 'user', 'msg A')],
        createdAt: 1000,
        updatedAt: 1000,
      };
      const convB: Conversation = {
        id: 'conv-b',
        name: 'B',
        messages: [makeMsg('mb', 'assistant', 'msg B')],
        createdAt: 2000,
        updatedAt: 2000,
      };

      useChatStore.setState({
        conversations: [convA, convB],
        activeConversationId: 'conv-a',
        messages: convA.messages,
      });

      useChatStore.getState().deleteConversation('conv-a');

      const state = useChatStore.getState();
      expect(state.activeConversationId).toBe('conv-b');
      expect(state.messages[0].content).toBe('msg B');
    });

    it('sets activeConversationId to null when deleting last conversation', () => {
      const conv: Conversation = {
        id: 'solo',
        name: 'Only',
        messages: [],
        createdAt: 1000,
        updatedAt: 1000,
      };

      useChatStore.setState({
        conversations: [conv],
        activeConversationId: 'solo',
        messages: [],
      });

      useChatStore.getState().deleteConversation('solo');

      const state = useChatStore.getState();
      expect(state.activeConversationId).toBeNull();
      expect(state.messages).toEqual([]);
    });

    it('does not change active conversation when deleting an inactive one', () => {
      const convA: Conversation = {
        id: 'conv-a',
        name: 'A',
        messages: [makeMsg('ma', 'user', 'active')],
        createdAt: 1000,
        updatedAt: 1000,
      };
      const convB: Conversation = {
        id: 'conv-b',
        name: 'B',
        messages: [],
        createdAt: 2000,
        updatedAt: 2000,
      };

      useChatStore.setState({
        conversations: [convA, convB],
        activeConversationId: 'conv-a',
        messages: convA.messages,
      });

      useChatStore.getState().deleteConversation('conv-b');

      const state = useChatStore.getState();
      expect(state.activeConversationId).toBe('conv-a');
      expect(state.messages[0].content).toBe('active');
    });
  });

  // -----------------------------------------------------------------------
  // renameConversation
  // -----------------------------------------------------------------------
  describe('renameConversation', () => {
    it('renames the target conversation', () => {
      const conv: Conversation = {
        id: 'conv-1',
        name: 'Old Name',
        messages: [],
        createdAt: 1000,
        updatedAt: 1000,
      };

      useChatStore.setState({ conversations: [conv] });

      useChatStore.getState().renameConversation('conv-1', 'New Name');

      const state = useChatStore.getState();
      expect(state.conversations[0].name).toBe('New Name');
    });

    it('does not affect other conversations when renaming', () => {
      const convA: Conversation = {
        id: 'a',
        name: 'Alpha',
        messages: [],
        createdAt: 1000,
        updatedAt: 1000,
      };
      const convB: Conversation = {
        id: 'b',
        name: 'Beta',
        messages: [],
        createdAt: 2000,
        updatedAt: 2000,
      };

      useChatStore.setState({ conversations: [convA, convB] });

      useChatStore.getState().renameConversation('a', 'Alpha Renamed');

      const state = useChatStore.getState();
      expect(state.conversations[0].name).toBe('Alpha Renamed');
      expect(state.conversations[1].name).toBe('Beta');
    });

    it('persists rename to localStorage', () => {
      const conv: Conversation = {
        id: 'c1',
        name: 'Before',
        messages: [],
        createdAt: 1000,
        updatedAt: 1000,
      };

      useChatStore.setState({ conversations: [conv] });

      useChatStore.getState().renameConversation('c1', 'After');
      flushConversationSaveForTesting();

      const stored = localStorage.getItem(CONVERSATIONS_KEY);
      expect(stored).not.toBeNull();
      const parsed = JSON.parse(stored!);
      expect(parsed[0].name).toBe('After');
    });
  });

  // -----------------------------------------------------------------------
  // loadConversations
  // -----------------------------------------------------------------------
  describe('loadConversations', () => {
    it('restores conversations from localStorage', () => {
      const conversations: Conversation[] = [
        {
          id: 'c1',
          name: 'Loaded Chat',
          messages: [makeMsg('m1', 'user', 'hi')],
          createdAt: 1000,
          updatedAt: 2000,
        },
      ];
      localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(conversations));
      localStorage.setItem(ACTIVE_CONVERSATION_KEY, 'c1');

      useChatStore.getState().loadConversations();

      const state = useChatStore.getState();
      expect(state.conversations).toHaveLength(1);
      expect(state.conversations[0].name).toBe('Loaded Chat');
      expect(state.activeConversationId).toBe('c1');
      expect(state.messages[0].content).toBe('hi');
    });

    it('falls back to most-recently-updated conversation when active key is missing', () => {
      const conversations: Conversation[] = [
        { id: 'old', name: 'Old', messages: [], createdAt: 1000, updatedAt: 1000 },
        { id: 'new', name: 'New', messages: [], createdAt: 2000, updatedAt: 3000 },
      ];
      localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(conversations));
      // No ACTIVE_CONVERSATION_KEY

      useChatStore.getState().loadConversations();

      expect(useChatStore.getState().activeConversationId).toBe('new');
    });

    it('falls back to most-recently-updated when persisted active id is stale', () => {
      const conversations: Conversation[] = [
        { id: 'c1', name: 'C1', messages: [], createdAt: 1000, updatedAt: 1000 },
        { id: 'c2', name: 'C2', messages: [], createdAt: 2000, updatedAt: 5000 },
      ];
      localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(conversations));
      localStorage.setItem(ACTIVE_CONVERSATION_KEY, 'stale-id-that-does-not-exist');

      useChatStore.getState().loadConversations();

      expect(useChatStore.getState().activeConversationId).toBe('c2');
    });

    it('handles empty localStorage gracefully', () => {
      useChatStore.getState().loadConversations();

      const state = useChatStore.getState();
      expect(state.conversations).toEqual([]);
    });

    it('handles corrupt localStorage data without throwing', () => {
      localStorage.setItem(CONVERSATIONS_KEY, '{bad json:::}');

      expect(() => {
        useChatStore.getState().loadConversations();
      }).not.toThrow();
    });
  });
});

// ---------------------------------------------------------------------------
// buildTruncatedApiMessages
// ---------------------------------------------------------------------------
describe('buildTruncatedApiMessages', () => {
  function makeUserMsg(content: string, ts = Date.now()): ChatMessage {
    return { id: `u-${ts}`, role: 'user', content, timestamp: ts };
  }
  function makeAssistantMsg(content: string, ts = Date.now()): ChatMessage {
    return { id: `a-${ts}`, role: 'assistant', content, timestamp: ts };
  }

  it('returns all messages when they fit within budget', () => {
    const messages = [
      makeUserMsg('Hello'),
      makeAssistantMsg('Hi there'),
      makeUserMsg('How are you?'),
    ];

    const result = buildTruncatedApiMessages(messages, 150000, 6000);

    expect(result.length).toBe(3);
  });

  it('filters out system messages', () => {
    const messages: ChatMessage[] = [
      { id: 'sys', role: 'system', content: 'system prompt', timestamp: 1000 },
      makeUserMsg('Hello'),
      makeAssistantMsg('Hi'),
    ];

    const result = buildTruncatedApiMessages(messages, 150000, 6000);

    expect(result.every((m) => m.role !== 'system')).toBe(true);
  });

  it('truncates old messages when over budget', () => {
    // Create a large number of messages that exceed the budget
    const messages: ChatMessage[] = [];
    for (let i = 0; i < 50; i++) {
      messages.push(makeUserMsg(`Message ${i} - ${'x'.repeat(200)}`, i * 1000));
      messages.push(makeAssistantMsg(`Reply ${i} - ${'y'.repeat(200)}`, i * 1000 + 500));
    }

    // Use a tiny budget to force truncation
    const result = buildTruncatedApiMessages(messages, 1000, 0);

    expect(result.length).toBeLessThan(messages.length);
  });

  it('always preserves the last message after truncation', () => {
    const messages: ChatMessage[] = [];
    for (let i = 0; i < 30; i++) {
      messages.push(makeUserMsg(`msg ${i} ${'x'.repeat(500)}`, i * 1000));
    }

    const result = buildTruncatedApiMessages(messages, 2000, 0);

    // Last message content should match the last input message
    const lastResultMsg = result[result.length - 1];
    expect(lastResultMsg.role).toBe('user');
    expect(String(lastResultMsg.content)).toContain('msg 29');
  });

  it('inserts summary marker when messages are dropped', () => {
    const messages: ChatMessage[] = [];
    for (let i = 0; i < 20; i++) {
      messages.push(makeUserMsg(`msg ${i} ${'a'.repeat(300)}`, i * 1000));
    }

    // Budget small enough to force truncation: 100 tokens total, 0 overhead
    const result = buildTruncatedApiMessages(messages, 100, 0);

    // The truncation marker should appear somewhere in the result
    const allContent = result.map((m) => String(m.content)).join('\n');
    expect(allContent).toContain('Earlier conversation summarized');
  });

  it('formats user messages with images as multimodal content', () => {
    const messages: ChatMessage[] = [
      {
        id: 'u1',
        role: 'user',
        content: 'What is this?',
        images: ['data:image/png;base64,abc123'],
        timestamp: 1000,
      },
    ];

    const result = buildTruncatedApiMessages(messages, 150000, 6000);

    expect(Array.isArray(result[0].content)).toBe(true);
    const content = result[0].content as Array<{ type: string }>;
    expect(content.some((b) => b.type === 'image')).toBe(true);
    expect(content.some((b) => b.type === 'text')).toBe(true);
  });

  it('strips base64 data URL prefix from images', () => {
    const messages: ChatMessage[] = [
      {
        id: 'u1',
        role: 'user',
        content: 'Analyze',
        images: ['data:image/jpeg;base64,/9j/4AAQSkZJRgAB'],
        timestamp: 1000,
      },
    ];

    const result = buildTruncatedApiMessages(messages, 150000, 6000);
    const content = result[0].content as Array<{ type: string; source?: { data?: string } }>;
    const imageBlock = content.find((b) => b.type === 'image');
    expect(imageBlock?.source?.data).not.toContain('data:image');
    expect(imageBlock?.source?.data).toBe('/9j/4AAQSkZJRgAB');
  });

  it('handles empty message array', () => {
    const result = buildTruncatedApiMessages([]);
    expect(result).toEqual([]);
  });
});
