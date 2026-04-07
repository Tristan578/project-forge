/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getStoredConversationIds,
  loadConversation,
  searchChatHistory,
  searchInConversation,
} from '../search';
import type { ChatMessage } from '@/stores/chatStore';

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg-1',
    role: 'user',
    content: 'Hello world',
    timestamp: Date.now(),
    ...overrides,
  } as ChatMessage;
}

describe('chat/search', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('getStoredConversationIds', () => {
    it('returns empty array when no conversations stored', () => {
      expect(getStoredConversationIds()).toEqual([]);
    });

    it('returns project IDs from localStorage keys', () => {
      localStorage.setItem('forge-chat-proj-1', '[]');
      localStorage.setItem('forge-chat-proj-2', '[]');
      localStorage.setItem('unrelated-key', 'value');

      const ids = getStoredConversationIds();
      expect(ids).toContain('proj-1');
      expect(ids).toContain('proj-2');
      expect(ids).not.toContain('unrelated-key');
      expect(ids).toHaveLength(2);
    });
  });

  describe('loadConversation', () => {
    it('returns empty array for non-existent project', () => {
      expect(loadConversation('nope')).toEqual([]);
    });

    it('parses stored messages', () => {
      const messages = [makeMessage({ id: 'msg-1', content: 'hi' })];
      localStorage.setItem('forge-chat-proj-1', JSON.stringify(messages));

      const loaded = loadConversation('proj-1');
      expect(loaded).toHaveLength(1);
      expect(loaded[0].content).toBe('hi');
    });

    it('returns empty array for corrupt data', () => {
      localStorage.setItem('forge-chat-proj-1', '{bad json');
      expect(loadConversation('proj-1')).toEqual([]);
    });
  });

  describe('searchChatHistory', () => {
    beforeEach(() => {
      const msgs1 = [
        makeMessage({ id: 'a1', content: 'Create a red cube', timestamp: 100 }),
        makeMessage({ id: 'a2', role: 'assistant', content: 'Done! I created a red cube for you.', timestamp: 200 }),
      ];
      const msgs2 = [
        makeMessage({ id: 'b1', content: 'Make a blue sphere', timestamp: 300 }),
      ];
      localStorage.setItem('forge-chat-proj-1', JSON.stringify(msgs1));
      localStorage.setItem('forge-chat-proj-2', JSON.stringify(msgs2));
    });

    it('returns empty for blank query', () => {
      expect(searchChatHistory('')).toEqual([]);
      expect(searchChatHistory('  ')).toEqual([]);
    });

    it('finds messages matching query (case-insensitive)', () => {
      const results = searchChatHistory('RED CUBE');
      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.content.includes('red cube'))).toBe(true);
    });

    it('sorts results by timestamp descending', () => {
      const results = searchChatHistory('a');
      if (results.length > 1) {
        for (let i = 1; i < results.length; i++) {
          expect(results[i - 1].timestamp).toBeGreaterThanOrEqual(results[i].timestamp);
        }
      }
    });

    it('respects maxResults limit', () => {
      const results = searchChatHistory('a', { maxResults: 1 });
      expect(results.length).toBeLessThanOrEqual(1);
    });

    it('filters by projectIds', () => {
      const results = searchChatHistory('cube', { projectIds: ['proj-2'] });
      expect(results).toHaveLength(0); // 'cube' is only in proj-1
    });

    it('filters by roles', () => {
      const results = searchChatHistory('cube', { roles: ['assistant'] });
      expect(results.length).toBeGreaterThan(0);
      expect(results.every(r => r.role === 'assistant')).toBe(true);
    });

    it('includes snippet with match context', () => {
      const results = searchChatHistory('red cube');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].snippet).toBeTruthy();
      expect(results[0].matchLength).toBe('red cube'.length);
    });
  });

  describe('searchInConversation', () => {
    const messages = [
      makeMessage({ id: 'c1', content: 'Add physics to the player', timestamp: 10 }),
      makeMessage({ id: 'c2', role: 'assistant', content: 'Physics added successfully', timestamp: 20 }),
      makeMessage({ id: 'c3', content: 'Now add gravity', timestamp: 30 }),
    ];

    it('returns empty for blank query', () => {
      expect(searchInConversation(messages, '')).toEqual([]);
    });

    it('finds matching messages', () => {
      const results = searchInConversation(messages, 'physics');
      expect(results).toHaveLength(2);
    });

    it('returns empty when no match', () => {
      const results = searchInConversation(messages, 'nonexistent');
      expect(results).toHaveLength(0);
    });

    it('handles messages with null content', () => {
      const msgs = [makeMessage({ id: 'd1', content: undefined as unknown as string })];
      const results = searchInConversation(msgs, 'test');
      expect(results).toHaveLength(0);
    });
  });
});
