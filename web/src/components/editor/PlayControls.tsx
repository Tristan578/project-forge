'use client';

import { useEditorStore } from '@/stores/editorStore';
import { Play, Pause, Square } from 'lucide-react';

export function PlayControls() {
  const engineMode = useEditorStore((s) => s.engineMode);
  const play = useEditorStore((s) => s.play);
  const stop = useEditorStore((s) => s.stop);
  const pause = useEditorStore((s) => s.pause);
  const resume = useEditorStore((s) => s.resume);

  const isEdit = engineMode === 'edit';
  const isPlaying = engineMode === 'play';
  const isPaused = engineMode === 'paused';

  return (
    <div className="flex items-center gap-0.5">
      {/* Play / Resume button */}
      {isPaused ? (
        <button
          onClick={resume}
          className="flex h-6 w-6 items-center justify-center rounded text-green-400 hover:bg-zinc-700"
          title="Resume (Ctrl+P)"
        >
          <Play size={13} fill="currentColor" />
        </button>
      ) : (
        <button
          onClick={play}
          disabled={!isEdit}
          className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:bg-zinc-700 hover:text-green-400 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-zinc-400"
          title="Play (Ctrl+P)"
        >
          <Play size={13} fill={isEdit ? 'none' : 'currentColor'} />
        </button>
      )}

      {/* Pause button */}
      <button
        onClick={pause}
        disabled={!isPlaying}
        className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:bg-zinc-700 hover:text-yellow-400 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-zinc-400"
        title="Pause"
      >
        <Pause size={13} />
      </button>

      {/* Stop button */}
      <button
        onClick={stop}
        disabled={isEdit}
        className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:bg-zinc-700 hover:text-red-400 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-zinc-400"
        title="Stop"
      >
        <Square size={13} />
      </button>

      {/* Mode indicator */}
      {!isEdit && (
        <span className={`ml-1 text-[10px] font-medium uppercase tracking-wider ${
          isPlaying ? 'text-green-400' : 'text-yellow-400'
        }`}>
          {isPlaying ? 'Playing' : 'Paused'}
        </span>
      )}
    </div>
  );
}
