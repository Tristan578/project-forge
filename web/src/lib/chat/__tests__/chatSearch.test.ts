import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ChatMessage } from '@/stores/chatStore';
import {
  searchChatHistory,
  searchInConversation,
  getStoredConversationIds,
  loadConversation,
} from '@/lib/chat/search';

// Mock localStorage
const mockStorage: Record<string, string> = {};
const localStorageMock = {
  getItem: vi.fn((key: string) => mockStorage[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { mockStorage[key] = value; }),
  removeItem: vi.fn((key: string) => { delete mockStorage[key]; }),
  key: vi.fn((index: number) => Object.keys(mockStorage)[index] ?? null),
  get length() { return Object.keys(mockStorage).length; },
  clear: vi.fn(() => { for (const k of Object.keys(mockStorage)) delete mockStorage[k]; }),
};

function makeMessage(overrides: Partial<ChatMessage> & { id: string; content: string }): ChatMessage {
  return {
    role: 'user',
    timestamp: Date.now(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', localStorageMock);
  localStorageMock.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getStoredConversationIds', () => {
  it('returns empty array when no conversations stored', () => {
    expect(getStoredConversationIds()).toEqual([]);
  });

  it('returns project IDs from stored conversations', () => {
    mockStorage['forge-chat-proj1'] = '[]';
    mockStorage['forge-chat-proj2'] = '[]';
    mockStorage['other-key'] = '[]';
    const ids = getStoredConversationIds();
    expect(ids).toContain('proj1');
    expect(ids).toContain('proj2');
    expect(ids).not.toContain('other-key');
  });
});

describe('loadConversation', () => {
  it('returns empty array for missing conversation', () => {
    expect(loadConversation('nonexistent')).toEqual([]);
  });

  it('loads stored messages', () => {
    const msgs = [makeMessage({ id: 'msg1', content: 'Hello' })];
    mockStorage['forge-chat-proj1'] = JSON.stringify(msgs);
    const loaded = loadConversation('proj1');
    expect(loaded).toHaveLength(1);
    expect(loaded[0].content).toBe('Hello');
  });

  it('handles corrupt data gracefully', () => {
    mockStorage['forge-chat-proj1'] = '{invalid json';
    expect(loadConversation('proj1')).toEqual([]);
  });
});

describe('searchChatHistory', () => {
  beforeEach(() => {
    const proj1Messages = [
      makeMessage({ id: 'msg1', content: 'Create a red cube', role: 'user', timestamp: 1000 }),
      makeMessage({ id: 'msg2', content: 'I created a red cube for you', role: 'assistant', timestamp: 2000 }),
    ];
    const proj2Messages = [
      makeMessage({ id: 'msg3', content: 'Add physics to the sphere', role: 'user', timestamp: 3000 }),
      makeMessage({ id: 'msg4', content: 'Physics enabled on sphere', role: 'assistant', timestamp: 4000 }),
    ];
    mockStorage['forge-chat-proj1'] = JSON.stringify(proj1Messages);
    mockStorage['forge-chat-proj2'] = JSON.stringify(proj2Messages);
  });

  it('returns empty for empty query', () => {
    expect(searchChatHistory('')).toEqual([]);
    expect(searchChatHistory('  ')).toEqual([]);
  });

  it('finds matching messages across projects', () => {
    const results = searchChatHistory('cube');
    expect(results.length).toBe(2);
    expect(results.every((r) => r.content.toLowerCase().includes('cube'))).toBe(true);
  });

  it('is case insensitive', () => {
    const results = searchChatHistory('RED CUBE');
    expect(results.length).toBeGreaterThan(0);
  });

  it('returns results sorted by timestamp descending', () => {
    const results = searchChatHistory('cube');
    expect(results.length).toBe(2);
    expect(results[0].timestamp).toBeGreaterThan(results[1].timestamp);
  });

  it('respects maxResults option', () => {
    const results = searchChatHistory('cube', { maxResults: 1 });
    expect(results.length).toBe(1);
  });

  it('filters by project IDs', () => {
    const results = searchChatHistory('cube', { projectIds: ['proj1'] });
    expect(results.length).toBe(2);
    expect(results.every((r) => r.projectId === 'proj1')).toBe(true);
  });

  it('filters by role', () => {
    const results = searchChatHistory('cube', { roles: ['user'] });
    expect(results.length).toBe(1);
    expect(results[0].role).toBe('user');
  });

  it('returns snippets with context', () => {
    const results = searchChatHistory('red cube');
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.snippet).not.toBeNull();
      expect(r.matchLength).toBe(8); // 'red cube'.length
    }
  });

  it('handles no matches', () => {
    const results = searchChatHistory('nonexistent query xyz');
    expect(results.length).toBe(0);
  });
});

describe('searchInConversation', () => {
  const messages: ChatMessage[] = [
    makeMessage({ id: 'msg1', content: 'Hello world', role: 'user', timestamp: 1000 }),
    makeMessage({ id: 'msg2', content: 'World says hello back', role: 'assistant', timestamp: 2000 }),
    makeMessage({ id: 'msg3', content: 'No match here', role: 'user', timestamp: 3000 }),
  ];

  it('returns empty for empty query', () => {
    expect(searchInConversation(messages, '')).toEqual([]);
  });

  it('finds matching messages in conversation', () => {
    const results = searchInConversation(messages, 'hello');
    expect(results.length).toBe(2);
  });

  it('sets projectId to empty string', () => {
    const results = searchInConversation(messages, 'hello');
    for (const r of results) {
      expect(r.projectId).toBe('');
    }
  });

  it('generates snippets correctly', () => {
    const results = searchInConversation(messages, 'world');
    expect(results.length).toBe(2);
    for (const r of results) {
      expect(r.snippet.toLowerCase()).toContain('world');
    }
  });

  it('handles messages with empty content', () => {
    const msgsWithEmpty = [...messages, makeMessage({ id: 'msg4', content: '', timestamp: 4000 })];
    const results = searchInConversation(msgsWithEmpty, 'hello');
    expect(results.length).toBe(2); // empty content should be skipped
  });
});
