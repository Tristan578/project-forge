'use client';

/**
 * Manual completion-mode picker (idea.FR-1.OP-04, #9998).
 *
 * Writes through `setCompletionMode`, the same store action the AI's
 * `set_completion_mode` tool calls, so both surfaces share one validator and
 * one error text. The Undo/Redo buttons drive that action's own history: the
 * engine's Ctrl+Z stack only holds what the engine owns, and this value is
 * frontend-only.
 *
 * Native radio inputs sharing one `name` give arrow-key navigation and a
 * checked state for free; the `radiogroup` is named by the section heading and
 * each option's consequence is wired as its accessible description.
 */

import { useCallback, useId, useState } from 'react';
import { Redo2, Undo2 } from 'lucide-react';
import { useEditorStore } from '@/stores/editorStore';
import {
  COMPLETION_MODES,
  COMPLETION_MODE_INFO,
  DEFAULT_COMPLETION_MODE,
  type CompletionMode,
} from '@/lib/playMode/completionMode';

/**
 * Scene-level completion-mode radio group with undo/redo and a status line.
 * @returns The picker section for the Scene Settings panel.
 */
export function CompletionModeSection() {
  const completionMode = useEditorStore((s) => s.sceneGraph.completionMode);
  const canUndo = useEditorStore((s) => s.completionModeHistory.past.length > 0);
  const canRedo = useEditorStore((s) => s.completionModeHistory.future.length > 0);
  const setCompletionMode = useEditorStore((s) => s.setCompletionMode);
  const undoCompletionMode = useEditorStore((s) => s.undoCompletionMode);
  const redoCompletionMode = useEditorStore((s) => s.redoCompletionMode);
  const [status, setStatus] = useState('');
  // Scoped ids: the panel can be mounted more than once in a dock layout.
  const idBase = useId();
  const headingId = `${idBase}-heading`;

  const effective: CompletionMode = completionMode ?? DEFAULT_COMPLETION_MODE;

  const handleChoose = useCallback(
    (mode: CompletionMode) => {
      const result = setCompletionMode(mode);
      // The radios only offer valid modes, but the action is the authority:
      // show its words rather than assuming it agreed.
      setStatus(result.ok ? `Completion mode set to ${COMPLETION_MODE_INFO[result.mode].label}.` : result.error);
    },
    [setCompletionMode],
  );

  const announceStep = useCallback((verb: 'undone' | 'redone') => {
    const now = useEditorStore.getState().sceneGraph.completionMode ?? DEFAULT_COMPLETION_MODE;
    setStatus(`Completion mode change ${verb}. Now ${COMPLETION_MODE_INFO[now].label}.`);
  }, []);

  const handleUndo = useCallback(() => {
    if (undoCompletionMode()) announceStep('undone');
  }, [undoCompletionMode, announceStep]);

  const handleRedo = useCallback(() => {
    if (redoCompletionMode()) announceStep('redone');
  }, [redoCompletionMode, announceStep]);

  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-center justify-between">
        <h3 id={headingId} className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Completion mode
        </h3>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleUndo}
            disabled={!canUndo}
            aria-label="Undo completion mode change"
            title="Undo completion mode change"
            className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
          >
            <Undo2 size={12} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={handleRedo}
            disabled={!canRedo}
            aria-label="Redo completion mode change"
            title="Redo completion mode change"
            className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
          >
            <Redo2 size={12} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div role="radiogroup" aria-labelledby={headingId} className="space-y-1">
        {COMPLETION_MODES.map((mode) => {
          const info = COMPLETION_MODE_INFO[mode];
          const inputId = `${idBase}-${mode}`;
          const descriptionId = `${idBase}-${mode}-desc`;
          return (
            <div key={mode} className="flex items-start gap-2 rounded px-1 py-1 hover:bg-zinc-800/50">
              <input
                id={inputId}
                type="radio"
                name={`${idBase}-completion-mode`}
                value={mode}
                checked={effective === mode}
                onChange={() => handleChoose(mode)}
                // A legacy scene shows Win checked without having chosen it, and
                // a checked radio fires no change event — so clicking it is the
                // only way to record an explicit `win`. Guarded on the implicit
                // state so an ordinary selection is not handled twice.
                onClick={() => {
                  if (completionMode === undefined && mode === effective) handleChoose(mode);
                }}
                aria-describedby={descriptionId}
                className="mt-0.5 accent-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
              />
              <div className="min-w-0">
                <label htmlFor={inputId} className="cursor-pointer text-xs text-zinc-200">
                  {info.label}
                </label>
                <p id={descriptionId} className="text-[10px] leading-snug text-zinc-400">
                  {info.description}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {completionMode === undefined && (
        <p className="mt-1 text-[10px] text-zinc-400">
          Win is the default and is not saved with this scene yet. Choosing a mode saves it.
        </p>
      )}

      <p role="status" aria-live="polite" className="mt-1 min-h-[1em] text-[10px] text-zinc-400">
        {status}
      </p>
    </div>
  );
}
