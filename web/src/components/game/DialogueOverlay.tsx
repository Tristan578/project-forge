'use client';

import { useState, useEffect, useCallback } from 'react';
import { MessageSquare, ChevronRight, History } from 'lucide-react';
import { useDialogueStore, type TextNode, type ChoiceNode, type DialogueChoice } from '@/stores/dialogueStore';
import { useEditorStore } from '@/stores/editorStore';

const TYPEWRITER_MS = 30; // ms per character

export function DialogueOverlay() {
  const isActive = useDialogueStore((s) => s.runtime.isActive);
  const currentNodeId = useDialogueStore((s) => s.runtime.currentNodeId);
  const activeTreeId = useDialogueStore((s) => s.runtime.activeTreeId);
  const dialogueTrees = useDialogueStore((s) => s.dialogueTrees);
  const runtimeHistory = useDialogueStore((s) => s.runtime.history);
  const typewriterComplete = useDialogueStore((s) => s.runtime.typewriterComplete);
  const displayedText = useDialogueStore((s) => s.runtime.displayedText);
  const currentChoices = useDialogueStore((s) => s.runtime.currentChoices);
  const advanceDialogue = useDialogueStore((s) => s.advanceDialogue);
  const selectChoice = useDialogueStore((s) => s.selectChoice);
  const skipTypewriter = useDialogueStore((s) => s.skipTypewriter);
  const endDialogue = useDialogueStore((s) => s.endDialogue);
  const engineMode = useEditorStore((s) => s.engineMode);

  const [showHistory, setShowHistory] = useState(false);
  const [typewriterText, setTypewriterText] = useState('');
  const [typewriterDone, setTypewriterDone] = useState(false);

  // Get current node
  const tree = activeTreeId ? dialogueTrees[activeTreeId] : null;
  const currentNode = tree?.nodes.find((n) => n.id === currentNodeId) ?? null;

  // Typewriter effect
  useEffect(() => {
    if (!currentNode || currentNode.type !== 'text') {
      setTypewriterText('');
      setTypewriterDone(true);
      return;
    }

    if (typewriterComplete) {
      setTypewriterText(currentNode.text);
      setTypewriterDone(true);
      return;
    }

    const fullText = currentNode.text;
    let charIndex = 0;
    setTypewriterText('');
    setTypewriterDone(false);

    const interval = setInterval(() => {
      charIndex++;
      if (charIndex >= fullText.length) {
        setTypewriterText(fullText);
        setTypewriterDone(true);
        clearInterval(interval);
        // Mark typewriter as complete in store
        skipTypewriter();
      } else {
        setTypewriterText(fullText.slice(0, charIndex));
      }
    }, TYPEWRITER_MS);

    return () => clearInterval(interval);
  }, [currentNodeId, currentNode, typewriterComplete, skipTypewriter]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isActive) return;

      // H key toggles history
      if (e.key === 'h' || e.key === 'H') {
        setShowHistory((prev) => !prev);
        return;
      }

      // Space/Enter advances text nodes
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        if (currentNode?.type === 'text') {
          if (!typewriterDone) {
            skipTypewriter();
          } else {
            advanceDialogue();
          }
        }
        return;
      }

      // Escape ends dialogue
      if (e.key === 'Escape') {
        endDialogue();
        return;
      }

      // Number keys select choices (1-9)
      if (currentChoices.length > 0) {
        const num = parseInt(e.key, 10);
        if (num >= 1 && num <= currentChoices.length) {
          selectChoice(currentChoices[num - 1].id);
        }
      }
    },
    [isActive, currentNode, typewriterDone, currentChoices, advanceDialogue, selectChoice, skipTypewriter, endDialogue]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Only show in play mode when active
  if (!isActive || engineMode !== 'play') return null;

  const speaker =
    currentNode?.type === 'text'
      ? (currentNode as TextNode).speaker
      : currentNode?.type === 'choice'
        ? (currentNode as ChoiceNode).speaker
        : null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center pb-8 pointer-events-none">
      {/* History panel */}
      {showHistory && runtimeHistory.length > 0 && (
        <div className="mb-2 w-[600px] max-w-[90vw] max-h-48 overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900/95 p-3 pointer-events-auto">
          <div className="mb-2 flex items-center gap-1.5 text-xs text-zinc-500">
            <History size={12} />
            <span>Dialogue History</span>
          </div>
          {runtimeHistory.map((entry, i) => (
            <div key={i} className="mb-1 text-xs">
              <span className="font-medium text-zinc-300">{entry.speaker}:</span>{' '}
              <span className="text-zinc-400">{entry.text}</span>
            </div>
          ))}
        </div>
      )}

      {/* Main dialogue box */}
      <div className="w-[600px] max-w-[90vw] rounded-lg border border-zinc-700 bg-zinc-900/95 shadow-2xl pointer-events-auto backdrop-blur-sm">
        {/* Speaker name bar */}
        {speaker && (
          <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-2">
            <MessageSquare size={14} className="text-blue-400" />
            <span className="text-sm font-semibold text-blue-400">{speaker}</span>
          </div>
        )}

        {/* Text content */}
        {currentNode?.type === 'text' && (
          <div className="px-4 py-3">
            <p className="text-sm leading-relaxed text-zinc-200">{typewriterText}</p>
            {typewriterDone && (
              <div className="mt-2 text-right text-xs text-zinc-500">
                <ChevronRight size={12} className="inline" /> Space to continue
              </div>
            )}
          </div>
        )}

        {/* Choice content */}
        {currentNode?.type === 'choice' && (
          <div className="px-4 py-3">
            {displayedText && (
              <p className="mb-3 text-sm text-zinc-300">{displayedText}</p>
            )}
            <div className="space-y-1.5">
              {currentChoices.map((choice: DialogueChoice, idx: number) => (
                <button
                  key={choice.id}
                  onClick={() => selectChoice(choice.id)}
                  className="flex w-full items-center gap-2 rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-left text-sm text-zinc-200 transition-colors hover:border-blue-500/50 hover:bg-zinc-700"
                >
                  <span className="shrink-0 rounded bg-zinc-700 px-1.5 py-0.5 text-xs font-mono text-zinc-400">
                    {idx + 1}
                  </span>
                  <span>{choice.text}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Bottom bar */}
        <div className="flex items-center justify-between border-t border-zinc-800 px-4 py-1.5 text-xs text-zinc-500">
          <button
            onClick={() => setShowHistory((prev) => !prev)}
            className="flex items-center gap-1 hover:text-zinc-300 transition-colors"
          >
            <History size={10} />H — History
          </button>
          <button
            onClick={endDialogue}
            className="hover:text-zinc-300 transition-colors"
          >
            Esc — Close
          </button>
        </div>
      </div>
    </div>
  );
}
