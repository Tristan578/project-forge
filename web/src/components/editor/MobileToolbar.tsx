'use client';

import {
  Move,
  RotateCw,
  Maximize2,
  PanelLeft,
  PanelRight,
  Sparkles,
} from 'lucide-react';
import { Button } from '@spawnforge/ui';
import { useEditorStore, type GizmoMode } from '@/stores/editorStore';
import { AddEntityMenu } from './AddEntityMenu';
import { spawnEntityWithFeedback } from './spawnFeedback';

interface MobileToolbarProps {
  onToggleLeft: () => void;
  onToggleRight: () => void;
  /**
   * Opens the quick-start dialog (PF-1215). Required, not optional: this is the
   * only visible entry into the game-creation pipeline on a compact viewport, so
   * a caller that forgets to wire it should be a compile error rather than a
   * silently missing button.
   */
  onQuickStart: () => void;
}

export function MobileToolbar({ onToggleLeft, onToggleRight, onQuickStart }: MobileToolbarProps) {
  const gizmoMode = useEditorStore((s) => s.gizmoMode);
  const setGizmoMode = useEditorStore((s) => s.setGizmoMode);
  const spawnEntity = useEditorStore((s) => s.spawnEntity);

  const gizmoButtons: { mode: GizmoMode; icon: typeof Move; label: string }[] = [
    { mode: 'translate', icon: Move, label: 'Move' },
    { mode: 'rotate', icon: RotateCw, label: 'Rotate' },
    { mode: 'scale', icon: Maximize2, label: 'Scale' },
  ];

  return (
    <div className="fixed bottom-0 left-0 right-0 z-30 flex h-12 items-center justify-between border-t border-zinc-700 bg-zinc-900 px-1">
      {/* Left: panel toggle */}
      <button
        onClick={onToggleLeft}
        aria-label="Scene Hierarchy"
        className="flex h-11 w-11 items-center justify-center rounded text-zinc-400 hover:text-zinc-200 active:bg-zinc-700"
        title="Scene Hierarchy"
      >
        <PanelLeft size={20} />
      </button>

      {/* Center: gizmo modes + spawn */}
      <div className="flex items-center gap-0.5">
        {gizmoButtons.map(({ mode, icon: Icon, label }) => (
          <button
            key={mode}
            onClick={() => setGizmoMode(mode)}
            aria-label={label}
            aria-pressed={gizmoMode === mode}
            className={`flex h-11 w-11 items-center justify-center rounded transition-colors ${
              gizmoMode === mode
                ? 'bg-blue-600 text-white'
                : 'text-zinc-400 hover:text-zinc-200 active:bg-zinc-700'
            }`}
            title={label}
          >
            <Icon size={18} />
          </button>
        ))}
        <div className="mx-0.5 h-6 w-px bg-zinc-700" />
        <AddEntityMenu onSpawn={(type) => spawnEntityWithFeedback(spawnEntity, type)} />
        <div className="mx-0.5 h-6 w-px bg-zinc-700" />
        <Button
          size="sm"
          onClick={onQuickStart}
          aria-label="Make me a game"
          data-testid="quick-start-trigger"
          title="Make me a game"
          className="h-11 w-11 p-0"
        >
          <Sparkles size={18} />
        </Button>
      </div>

      {/* Right: inspector toggle */}
      <button
        onClick={onToggleRight}
        aria-label="Inspector"
        className="flex h-11 w-11 items-center justify-center rounded text-zinc-400 hover:text-zinc-200 active:bg-zinc-700"
        title="Inspector"
      >
        <PanelRight size={20} />
      </button>
    </div>
  );
}
