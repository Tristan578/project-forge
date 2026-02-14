'use client';

import { useEffect, useCallback } from 'react';
import { X } from 'lucide-react';

interface ShortcutGroup {
  title: string;
  shortcuts: { keys: string; action: string }[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Selection',
    shortcuts: [
      { keys: 'Click', action: 'Select entity' },
      { keys: 'Ctrl + Click', action: 'Multi-select' },
      { keys: 'Ctrl + A', action: 'Select all' },
      { keys: 'Esc', action: 'Deselect all' },
    ],
  },
  {
    title: 'Transform',
    shortcuts: [
      { keys: 'W', action: 'Translate mode' },
      { keys: 'E', action: 'Rotate mode' },
      { keys: 'R', action: 'Scale mode' },
    ],
  },
  {
    title: 'History',
    shortcuts: [
      { keys: 'Ctrl + Z', action: 'Undo' },
      { keys: 'Ctrl + Shift + Z', action: 'Redo' },
    ],
  },
  {
    title: 'Scene',
    shortcuts: [
      { keys: 'Ctrl + S', action: 'Save scene' },
      { keys: 'Ctrl + D', action: 'Duplicate selected' },
      { keys: 'Delete', action: 'Delete selected' },
      { keys: 'F', action: 'Focus on selected' },
    ],
  },
  {
    title: 'View',
    shortcuts: [
      { keys: '1', action: 'Top view' },
      { keys: '2', action: 'Front view' },
      { keys: '3', action: 'Right view' },
      { keys: '4', action: 'Perspective view' },
      { keys: 'G', action: 'Toggle grid' },
    ],
  },
];

interface KeyboardShortcutsPanelProps {
  open: boolean;
  onClose: () => void;
}

export function KeyboardShortcutsPanel({ open, onClose }: KeyboardShortcutsPanelProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (open) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [open, handleKeyDown]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="mx-4 w-full max-w-lg rounded-lg border border-zinc-700 bg-zinc-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-zinc-100">Keyboard Shortcuts</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
          >
            <X size={16} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.title}>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
                {group.title}
              </h3>
              <div className="space-y-1">
                {group.shortcuts.map((s) => (
                  <div key={s.keys} className="flex items-center justify-between text-sm">
                    <span className="text-zinc-400">{s.action}</span>
                    <kbd className="rounded bg-zinc-800 px-1.5 py-0.5 text-[11px] font-mono text-zinc-300">
                      {s.keys}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <p className="mt-4 text-center text-[11px] text-zinc-600">
          Press <kbd className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-zinc-400">?</kbd> to toggle this panel
        </p>
      </div>
    </div>
  );
}
