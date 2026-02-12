'use client';

import type { ChatMessage as ChatMessageType } from '@/stores/chatStore';
import { ToolCallCard } from './ToolCallCard';

interface ChatMessageProps {
  message: ChatMessageType;
}

export function ChatMessage({ message }: ChatMessageProps) {
  if (message.role === 'system') {
    return (
      <div className="px-3 py-1.5 text-center text-xs text-zinc-600">
        {message.content}
      </div>
    );
  }

  const isUser = message.role === 'user';

  return (
    <div className={`px-3 py-2 ${isUser ? 'flex flex-col items-end' : ''}`}>
      {/* Role label */}
      <div className={`mb-1 text-[10px] font-medium uppercase tracking-wider ${isUser ? 'text-blue-400' : 'text-purple-400'}`}>
        {isUser ? 'You' : 'AI'}
      </div>

      {/* Image attachments */}
      {message.images && message.images.length > 0 && (
        <div className="mb-1.5 flex gap-1.5">
          {message.images.map((img, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={i}
              src={img}
              alt="Attached"
              className="h-20 w-20 rounded border border-zinc-700 object-cover"
            />
          ))}
        </div>
      )}

      {/* Text content */}
      {message.content && (
        <div
          className={`inline-block max-w-[95%] rounded-lg px-3 py-2 text-sm ${
            isUser
              ? 'bg-blue-600/20 text-zinc-200'
              : 'bg-zinc-800 text-zinc-300'
          }`}
        >
          {message.content}
        </div>
      )}

      {/* Tool calls */}
      {message.toolCalls && message.toolCalls.length > 0 && (
        <div className="mt-1.5 w-full">
          {message.toolCalls.map((tc) => (
            <ToolCallCard key={tc.id} toolCall={tc} />
          ))}
        </div>
      )}
    </div>
  );
}
