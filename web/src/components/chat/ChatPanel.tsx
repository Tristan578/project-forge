'use client';

import { useEffect, useRef } from 'react';
import { MessageSquare, Trash2, Loader } from 'lucide-react';
import { useChatStore } from '@/stores/chatStore';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';

const SUGGESTED_PROMPTS = [
  'Build a simple platformer level',
  'Add realistic lighting to my scene',
  'Create a forest with trees and a path',
  'Write a script to make my player move',
  'Set up physics for my objects',
  'Add particle effects to this entity',
];

export function ChatPanel() {
  const messages = useChatStore((s) => s.messages);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const error = useChatStore((s) => s.error);
  const clearChat = useChatStore((s) => s.clearChat);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const loopIteration = useChatStore((s) => s.loopIteration);
  const sessionTokens = useChatStore((s) => s.sessionTokens);
  const scrollRef = useRef<HTMLDivElement>(null);

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
          {totalSessionTokens > 0 && (
            <span className="text-[9px] text-zinc-600" title="Session token usage">
              {totalSessionTokens.toLocaleString()} tokens
            </span>
          )}
        </div>
        {messages.length > 0 && (
          <button
            onClick={clearChat}
            className="text-zinc-600 hover:text-zinc-400"
            title="Clear chat"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
            <MessageSquare size={28} className="text-zinc-700" />
            <p className="text-xs text-zinc-500">
              Describe what you want to build.
            </p>
            <div className="flex flex-col gap-1.5 w-full max-w-[220px]">
              {SUGGESTED_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => sendMessage(prompt)}
                  className="rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-left text-[11px] text-zinc-400 hover:border-zinc-700 hover:text-zinc-300 transition-colors"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="py-2">
            {messages.map((msg) => (
              <ChatMessage key={msg.id} message={msg} />
            ))}
            {isStreaming && (
              <div className="px-3 py-1 flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-purple-400" />
                {loopIteration > 0 && (
                  <span className="flex items-center gap-1 text-[10px] text-zinc-500">
                    <Loader size={10} className="animate-spin" />
                    Step {loopIteration + 1}
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Error display */}
        {error && (
          <div className="mx-3 mb-2 rounded border border-red-900/50 bg-red-900/20 px-3 py-2 text-xs text-red-400">
            {error}
          </div>
        )}
      </div>

      {/* Input */}
      <ChatInput />
    </div>
  );
}
