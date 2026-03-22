/**
 * useAiChat — thin wrapper around the AI SDK v5 `useChat` hook.
 *
 * This is the Phase 3 transport layer. It connects the AI SDK's built-in
 * streaming protocol to /api/chat via DefaultChatTransport (which speaks the
 * UI message stream format that the rewritten route emits).
 *
 * The hook is intentionally minimal. SpawnForge's chatStore remains the single
 * source of truth for tool call state, approval mode, conversation persistence,
 * and entity refs. This hook handles only the streaming transport.
 *
 * Usage in components:
 *   const { messages, sendMessage, status, stop } = useAiChat();
 */

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';

/**
 * Returns AI SDK useChat helpers connected to /api/chat via the standard
 * UI message stream transport. The default api path is '/api/chat'.
 */
export function useAiChat() {
  return useChat({
    transport: new DefaultChatTransport({ api: '/api/chat' }),
  });
}

export type { UseChatHelpers } from '@ai-sdk/react';
