/**
 * Chat History Search — search across conversations stored in localStorage.
 */

import type { ChatMessage } from '@/stores/chatStore';

const PERSISTENCE_KEY = 'forge-chat-';

export interface ChatSearchResult {
  projectId: string;
  messageId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  /** The matched snippet with surrounding context */
  snippet: string;
  timestamp: number;
  /** Index of the match start within the snippet */
  matchStart: number;
  /** Length of the match within the snippet */
  matchLength: number;
}

/**
 * Get all project IDs that have stored chat conversations.
 */
export function getStoredConversationIds(): string[] {
  if (typeof localStorage === 'undefined') return [];
  const ids: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(PERSISTENCE_KEY)) {
      ids.push(key.slice(PERSISTENCE_KEY.length));
    }
  }
  return ids;
}

/**
 * Load a conversation from localStorage.
 */
export function loadConversation(projectId: string): ChatMessage[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const stored = localStorage.getItem(PERSISTENCE_KEY + projectId);
    if (stored) {
      return JSON.parse(stored) as ChatMessage[];
    }
  } catch {
    // Corrupt data
  }
  return [];
}

/**
 * Search across all stored conversations for messages matching the query.
 * Returns results sorted by relevance (timestamp descending).
 */
export function searchChatHistory(
  query: string,
  options?: {
    /** Limit the number of results */
    maxResults?: number;
    /** Only search specific project IDs */
    projectIds?: string[];
    /** Only search specific roles */
    roles?: Array<'user' | 'assistant' | 'system'>;
  },
): ChatSearchResult[] {
  if (!query.trim()) return [];

  const lowerQuery = query.toLowerCase();
  const maxResults = options?.maxResults ?? 50;
  const targetProjectIds = options?.projectIds ?? getStoredConversationIds();
  const roles = options?.roles ?? ['user', 'assistant'];
  const results: ChatSearchResult[] = [];

  for (const projectId of targetProjectIds) {
    const messages = loadConversation(projectId);

    for (const msg of messages) {
      if (!roles.includes(msg.role)) continue;
      if (!msg.content) continue;

      const lowerContent = msg.content.toLowerCase();
      const matchIndex = lowerContent.indexOf(lowerQuery);
      if (matchIndex === -1) continue;

      const snippet = extractSnippet(msg.content, matchIndex, query.length, 80);

      results.push({
        projectId,
        messageId: msg.id,
        role: msg.role,
        content: msg.content,
        snippet: snippet.text,
        timestamp: msg.timestamp,
        matchStart: snippet.matchStart,
        matchLength: query.length,
      });
    }
  }

  // Sort by timestamp descending (most recent first)
  results.sort((a, b) => b.timestamp - a.timestamp);

  return results.slice(0, maxResults);
}

/**
 * Search within a single conversation's messages (for in-conversation search).
 */
export function searchInConversation(
  messages: ChatMessage[],
  query: string,
): ChatSearchResult[] {
  if (!query.trim()) return [];

  const lowerQuery = query.toLowerCase();
  const results: ChatSearchResult[] = [];

  for (const msg of messages) {
    if (!msg.content) continue;

    const lowerContent = msg.content.toLowerCase();
    const matchIndex = lowerContent.indexOf(lowerQuery);
    if (matchIndex === -1) continue;

    const snippet = extractSnippet(msg.content, matchIndex, query.length, 80);

    results.push({
      projectId: '',
      messageId: msg.id,
      role: msg.role,
      content: msg.content,
      snippet: snippet.text,
      timestamp: msg.timestamp,
      matchStart: snippet.matchStart,
      matchLength: query.length,
    });
  }

  return results;
}

/**
 * Extract a snippet around a match position with context.
 */
function extractSnippet(
  text: string,
  matchIndex: number,
  matchLength: number,
  contextChars: number,
): { text: string; matchStart: number } {
  const start = Math.max(0, matchIndex - contextChars);
  const end = Math.min(text.length, matchIndex + matchLength + contextChars);

  let snippet = text.slice(start, end);
  let adjustedMatchStart = matchIndex - start;

  if (start > 0) {
    snippet = '...' + snippet;
    adjustedMatchStart += 3;
  }
  if (end < text.length) {
    snippet = snippet + '...';
  }

  return { text: snippet, matchStart: adjustedMatchStart };
}
