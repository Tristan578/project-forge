'use client';

import { useState, useMemo, useCallback } from 'react';
import { ChevronDown, ChevronRight, Brain, ThumbsUp, ThumbsDown, RotateCcw, Check, X } from 'lucide-react';
import type { ChatMessage as ChatMessageType } from '@/stores/chatStore';
import { useChatStore } from '@/stores/chatStore';
import { useEditorStore } from '@/stores/editorStore';
import { ToolCallCard } from './ToolCallCard';

interface ChatMessageProps {
  message: ChatMessageType;
}

/** Parse text for entity names that match scene graph and render as clickable chips */
function EntityAwareText({ text }: { text: string }) {
  const sceneGraph = useEditorStore((s) => s.sceneGraph);
  const selectEntity = useEditorStore((s) => s.selectEntity);

  // Build a Set of entity names for fast lookup
  const entityNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const node of Object.values(sceneGraph.nodes)) {
      map.set(node.name.toLowerCase(), node.entityId);
    }
    return map;
  }, [sceneGraph.nodes]);

  // Split text into segments — entity names become clickable chips
  const segments = useMemo(() => {
    if (entityNameMap.size === 0) return [{ type: 'text' as const, value: text }];

    // Build regex from entity names (escape special chars, sort by length descending)
    const names = [...entityNameMap.keys()].sort((a, b) => b.length - a.length);
    if (names.length === 0) return [{ type: 'text' as const, value: text }];

    const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const pattern = new RegExp(`\\b(${escaped.join('|')})\\b`, 'gi');

    const result: { type: 'text' | 'entity'; value: string; entityId?: string }[] = [];
    let lastIndex = 0;

    for (const match of text.matchAll(pattern)) {
      if (match.index > lastIndex) {
        result.push({ type: 'text', value: text.slice(lastIndex, match.index) });
      }
      const id = entityNameMap.get(match[0].toLowerCase());
      if (id) {
        result.push({ type: 'entity', value: match[0], entityId: id });
      } else {
        result.push({ type: 'text', value: match[0] });
      }
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
      result.push({ type: 'text', value: text.slice(lastIndex) });
    }

    return result;
  }, [text, entityNameMap]);

  const handleEntityClick = useCallback((entityId: string) => {
    selectEntity(entityId, 'replace');
  }, [selectEntity]);

  return (
    <span>
      {segments.map((seg, i) =>
        seg.type === 'entity' && seg.entityId ? (
          <button
            key={i}
            onClick={() => handleEntityClick(seg.entityId!)}
            className="mx-0.5 inline-flex items-center rounded-full bg-purple-600/20 px-1.5 py-0.5 text-purple-300 hover:bg-purple-600/30 transition-colors"
            title={`Select ${seg.value} (${seg.entityId})`}
          >
            {seg.value}
          </button>
        ) : (
          <span key={i}>{seg.value}</span>
        )
      )}
    </span>
  );
}

export function ChatMessage({ message }: ChatMessageProps) {
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const setMessageFeedback = useChatStore((s) => s.setMessageFeedback);
  const batchUndoMessage = useChatStore((s) => s.batchUndoMessage);
  const approveToolCalls = useChatStore((s) => s.approveToolCalls);
  const rejectToolCalls = useChatStore((s) => s.rejectToolCalls);

  if (message.role === 'system') {
    return (
      <div className="px-3 py-1.5 text-center text-xs text-zinc-600">
        {message.content}
      </div>
    );
  }

  const isUser = message.role === 'user';
  const toolCalls = message.toolCalls || [];
  const hasPreviewTools = toolCalls.some((tc) => tc.status === 'preview');
  const successfulUndoable = toolCalls.filter((tc) => tc.status === 'success' && tc.undoable);
  const allToolsDone = toolCalls.length > 0 && toolCalls.every(
    (tc) => tc.status === 'success' || tc.status === 'error' || tc.status === 'rejected' || tc.status === 'undone'
  );

  return (
    <div className={`px-3 py-2 ${isUser ? 'flex flex-col items-end' : ''}`}>
      {/* Role label + token cost */}
      <div className={`mb-1 flex items-center gap-2 ${isUser ? 'flex-row-reverse' : ''}`}>
        <span className={`text-[10px] font-medium uppercase tracking-wider ${isUser ? 'text-blue-400' : 'text-purple-400'}`}>
          {isUser ? 'You' : 'AI'}
        </span>
        {!isUser && message.tokenCost != null && message.tokenCost > 0 && (
          <span className="text-[9px] text-zinc-600" title="Token cost for this response">
            ~{message.tokenCost.toLocaleString()} tokens
          </span>
        )}
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

      {/* Thinking block (collapsible) */}
      {message.thinking && (
        <div className="mb-1.5 w-full">
          <button
            onClick={() => setThinkingOpen(!thinkingOpen)}
            className="flex items-center gap-1 text-[10px] text-amber-500/70 hover:text-amber-400 transition-colors"
          >
            <Brain size={11} />
            {thinkingOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            <span>Reasoning</span>
          </button>
          {thinkingOpen && (
            <div className="mt-1 rounded border border-amber-900/30 bg-amber-950/20 px-2.5 py-2 text-[11px] text-zinc-500 leading-relaxed max-h-40 overflow-y-auto">
              {message.thinking}
            </div>
          )}
        </div>
      )}

      {/* Text content — with entity chip rendering for assistant messages */}
      {message.content && (
        <div
          className={`inline-block max-w-[95%] rounded-lg px-3 py-2 text-sm ${
            isUser
              ? 'bg-blue-600/20 text-zinc-200'
              : 'bg-zinc-800 text-zinc-300'
          }`}
        >
          {!isUser ? <EntityAwareText text={message.content} /> : message.content}
        </div>
      )}

      {/* Tool calls */}
      {toolCalls.length > 0 && (
        <div className="mt-1.5 w-full">
          {toolCalls.map((tc) => (
            <ToolCallCard
              key={tc.id}
              toolCall={tc}
              onApprove={() => approveToolCalls(message.id)}
              onReject={() => rejectToolCalls(message.id)}
            />
          ))}

          {/* Batch approve/reject for preview tools */}
          {hasPreviewTools && (
            <div className="mt-1.5 flex gap-2">
              <button
                onClick={() => approveToolCalls(message.id)}
                className="flex items-center gap-1 rounded bg-green-600/20 px-2.5 py-1 text-xs text-green-400 hover:bg-green-600/30"
              >
                <Check size={12} />
                Approve All ({toolCalls.filter((tc) => tc.status === 'preview').length})
              </button>
              <button
                onClick={() => rejectToolCalls(message.id)}
                className="flex items-center gap-1 rounded bg-red-600/20 px-2.5 py-1 text-xs text-red-400 hover:bg-red-600/30"
              >
                <X size={12} />
                Reject All
              </button>
            </div>
          )}

          {/* Batch undo button — only for messages with 2+ successful undoable tool calls */}
          {!isUser && allToolsDone && successfulUndoable.length >= 2 && (
            <button
              onClick={() => batchUndoMessage(message.id)}
              className="mt-1.5 flex items-center gap-1 rounded border border-zinc-700 px-2 py-1 text-[10px] text-zinc-500 hover:border-zinc-600 hover:text-zinc-300 transition-colors"
            >
              <RotateCcw size={11} />
              Undo All ({successfulUndoable.length} actions)
            </button>
          )}
        </div>
      )}

      {/* Feedback buttons — after assistant messages where all tool calls completed */}
      {!isUser && allToolsDone && (
        <div className="mt-1.5 flex items-center gap-1">
          <button
            onClick={() => setMessageFeedback(
              message.id,
              message.feedback === 'positive' ? null : 'positive'
            )}
            className={`rounded p-1 transition-colors ${
              message.feedback === 'positive'
                ? 'text-green-400'
                : 'text-zinc-600 hover:text-green-400'
            }`}
            title="Good response"
          >
            <ThumbsUp size={12} fill={message.feedback === 'positive' ? 'currentColor' : 'none'} />
          </button>
          <button
            onClick={() => setMessageFeedback(
              message.id,
              message.feedback === 'negative' ? null : 'negative'
            )}
            className={`rounded p-1 transition-colors ${
              message.feedback === 'negative'
                ? 'text-red-400'
                : 'text-zinc-600 hover:text-red-400'
            }`}
            title="Bad response"
          >
            <ThumbsDown size={12} fill={message.feedback === 'negative' ? 'currentColor' : 'none'} />
          </button>
        </div>
      )}
    </div>
  );
}
