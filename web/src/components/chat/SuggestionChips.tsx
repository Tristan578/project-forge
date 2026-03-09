'use client';

import { useMemo } from 'react';
import { Sparkles } from 'lucide-react';
import { useEditorStore } from '@/stores/editorStore';
import { useChatStore } from '@/stores/chatStore';
import { generateSuggestions, type Suggestion } from '@/lib/chat/suggestions';

interface SuggestionChipsProps {
  /** Override suggestions (for testing or static prompts) */
  suggestions?: Suggestion[];
  /** Additional className */
  className?: string;
}

/**
 * Renders context-aware suggestion pills that auto-send a prompt when clicked.
 */
export function SuggestionChips({ suggestions: overrideSuggestions, className = '' }: SuggestionChipsProps) {
  const sceneGraph = useEditorStore((s) => s.sceneGraph);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const primaryId = useEditorStore((s) => s.primaryId);
  const messages = useChatStore((s) => s.messages);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const isStreaming = useChatStore((s) => s.isStreaming);

  const dynamicSuggestions = useMemo(() => {
    if (overrideSuggestions) return overrideSuggestions;

    // Get last assistant message's tool calls for follow-up context
    const lastAssistantMsg = [...messages].reverse().find((m) => m.role === 'assistant');
    const lastToolCalls = lastAssistantMsg?.toolCalls?.filter(
      (tc) => tc.status === 'success'
    );

    return generateSuggestions(
      { sceneGraph, selectedIds, primaryId },
      lastToolCalls
    );
  }, [overrideSuggestions, sceneGraph, selectedIds, primaryId, messages]);

  if (dynamicSuggestions.length === 0) return null;

  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`}>
      {dynamicSuggestions.map((suggestion) => (
        <button
          key={suggestion.label}
          onClick={() => sendMessage(suggestion.prompt)}
          disabled={isStreaming}
          className="flex items-center gap-1 rounded-full border border-zinc-700 bg-zinc-800/50 px-2.5 py-1 text-[11px] text-zinc-400 hover:border-purple-600/50 hover:text-purple-300 hover:bg-purple-900/10 transition-colors disabled:opacity-40 disabled:hover:border-zinc-700 disabled:hover:text-zinc-400"
          title={suggestion.prompt}
        >
          <Sparkles size={10} className="text-purple-500/50" />
          {suggestion.label}
        </button>
      ))}
    </div>
  );
}
