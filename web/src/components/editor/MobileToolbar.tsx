'use client';

import {
  Move,
  RotateCw,
  Maximize2,
  PanelLeft,
  PanelRight,
} from 'lucide-react';
import { useEditorStore, type GizmoMode } from '@/stores/editorStore';
import { AddEntityMenu } from './AddEntityMenu';

interface MobileToolbarProps {
  onToggleLeft: () => void;
  onToggleRight: () => void;
}

export function MobileToolbar({ onToggleLeft, onToggleRight }: MobileToolbarProps) {
  const gizmoMode = useEditorStore((s) => s.gizmoMode);
  const setGizmoMode = useEditorStore((s) => s.setGizmoMode);
  const spawnEntity = useEditorStore((s) => s.spawnEntity);

  const gizmoButtons: { mode: GizmoMode; icon: typeof Move; label: string }[] = [
    { mode: 'translate', icon: Move, label: 'Move' },
    { mode: 'rotate', icon: RotateCw, label: 'Rotate' },
    { mode: 'scale', icon: Maximize2, label: 'Scale' },
  ];

  return (
    <div className="fixed bottom-0 left-0 right-0 z-30 flex h-12 items-center justify-between border-t border-zinc-700 bg-zinc-900 px-2">
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
      <div className="flex items-center gap-1">
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
        <div className="mx-1 h-6 w-px bg-zinc-700" />
        <AddEntityMenu onSpawn={(type) => spawnEntity(type)} />
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
