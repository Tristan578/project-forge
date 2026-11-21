'use client';

import { useCallback, useEffect, useRef, useMemo } from 'react';
import { MessageSquare, Trash2, Wrench, Sparkles, RotateCcw } from 'lucide-react';
import { useChatStore } from '@/stores/chatStore';
import { useUserStore } from '@/stores/userStore';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { SuggestionChips } from './SuggestionChips';
import { ConversationList } from './ConversationList';

// Static prompts are replaced by dynamic SuggestionChips

/** Streaming status indicator with descriptive text based on current activity */
function StreamingIndicator({ messages, loopIteration }: { messages: { role: string; toolCalls?: { name: string; status: string }[] }[]; loopIteration: number }) {
  // Find the active tool being executed
  const statusText = useMemo(() => {
    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
    if (!lastAssistant?.toolCalls?.length) {
      if (loopIteration > 0) return `Step ${loopIteration + 1}: Analyzing results...`;
      return 'Thinking...';
    }

    const pendingTools = lastAssistant.toolCalls.filter((tc) => tc.status === 'pending');
    if (pendingTools.length > 0) {
      const toolName = pendingTools[pendingTools.length - 1].name;
      const friendlyName = toolName.replace(/_/g, ' ');
      if (loopIteration > 0) {
        return `Step ${loopIteration + 1}: Executing ${friendlyName}...`;
      }
      return `Executing ${friendlyName}...`;
    }

    if (loopIteration > 0) return `Step ${loopIteration + 1}: Planning next action...`;
    return 'Generating response...';
  }, [messages, loopIteration]);

  return (
    <div className="px-3 py-2 flex items-center gap-2">
      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-purple-400" />
      <span className="flex items-center gap-1.5 text-[11px] text-zinc-400">
        {loopIteration > 0 ? (
          <Wrench size={11} className="text-purple-500 animate-spin" />
        ) : (
          <Sparkles size={11} className="text-purple-500" />
        )}
        {statusText}
      </span>
      {loopIteration > 0 && (
        <span className="text-[9px] text-zinc-400">
          (agentic loop)
        </span>
      )}
    </div>
  );
}

export function ChatPanel() {
  const messages = useChatStore((s) => s.messages);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const error = useChatStore((s) => s.error);
  const clearChat = useChatStore((s) => s.clearChat);
  const loopIteration = useChatStore((s) => s.loopIteration);
  const sessionTokens = useChatStore((s) => s.sessionTokens);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const canUseAI = useUserStore((s) => s.canUseAI());
  const scrollRef = useRef<HTMLDivElement>(null);

  const handleRetry = useCallback(() => {
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
    if (lastUserMsg) {
      void sendMessage(lastUserMsg.content, lastUserMsg.images, lastUserMsg.entityRefs);
    }
  }, [messages, sendMessage]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const totalSessionTokens = sessionTokens.input + sessionTokens.output;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
        <div className="flex items-center gap-1.5">
          <MessageSquare size={14} className="text-purple-400" />
          <span className="text-xs font-medium text-zinc-300">AI Assistant</span>
          <ConversationList />
          {totalSessionTokens > 0 && (
            <span className="text-[9px] text-zinc-400" title="Session token usage">
              {totalSessionTokens.toLocaleString()} tokens
            </span>
          )}
        </div>
        {messages.length > 0 && (
          <button
            onClick={clearChat}
            className="text-zinc-400 hover:text-zinc-400"
            title="Clear chat"
            aria-label="Clear chat"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>

      {/* Messages */}
      <div ref={scrollRef} aria-live="polite" aria-label="Chat messages" className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
            {canUseAI ? (
              <>
                <MessageSquare size={28} className="text-zinc-700" />
                <p className="text-xs text-zinc-400">
                  Describe what you want to build.
                </p>
                <SuggestionChips className="max-w-[280px] justify-center" />
              </>
            ) : (
              <>
                <Sparkles size={28} className="text-zinc-700" />
                <p className="text-xs text-zinc-400">
                  AI features require a paid plan.
                </p>
                <a
                  href="/pricing"
                  className="text-xs font-medium text-purple-400 hover:text-purple-300"
                >
                  View plans
                </a>
              </>
            )}
          </div>
        ) : (
          <div className="py-2">
            {messages.map((msg) => (
              <ChatMessage key={msg.id} message={msg} />
            ))}
            {isStreaming && (
              <StreamingIndicator messages={messages} loopIteration={loopIteration} />
            )}
            {!isStreaming && messages.length > 0 && (
              <div className="px-3 py-2">
                <SuggestionChips />
              </div>
            )}
          </div>
        )}

        {/* Error display */}
        {error && (
          <div role="alert" className="mx-3 mb-2 flex items-center justify-between rounded border border-red-900/50 bg-red-900/20 px-3 py-2 text-xs text-red-400">
            <span>{error}</span>
            <button
              onClick={handleRetry}
              className="ml-2 flex shrink-0 items-center gap-1 rounded px-2 py-1 text-red-300 hover:bg-red-900/30"
              aria-label="Retry last message"
            >
              <RotateCcw size={12} />
              Retry
            </button>
          </div>
        )}
      </div>

      {/* Input */}
      <ChatInput />
    </div>
  );
}
