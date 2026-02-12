'use client';

import { useEffect, useRef } from 'react';
import { MessageSquare, Trash2 } from 'lucide-react';
import { useChatStore } from '@/stores/chatStore';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';

export function ChatPanel() {
  const messages = useChatStore((s) => s.messages);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const error = useChatStore((s) => s.error);
  const clearChat = useChatStore((s) => s.clearChat);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
        <div className="flex items-center gap-1.5">
          <MessageSquare size={14} className="text-purple-400" />
          <span className="text-xs font-medium text-zinc-300">AI Assistant</span>
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
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
            <MessageSquare size={28} className="text-zinc-700" />
            <p className="text-xs text-zinc-600">
              Describe what you want to build.
            </p>
            <p className="text-[10px] text-zinc-700">
              &quot;Add a red cube&quot; &middot; &quot;Make it look spooky&quot; &middot; &quot;Create a platformer level&quot;
            </p>
          </div>
        ) : (
          <div className="py-2">
            {messages.map((msg) => (
              <ChatMessage key={msg.id} message={msg} />
            ))}
            {isStreaming && (
              <div className="px-3 py-1">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-purple-400" />
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
