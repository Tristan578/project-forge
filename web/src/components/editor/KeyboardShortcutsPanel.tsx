'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { X, RotateCcw } from 'lucide-react';
import {
  getMergedBindings,
  getEffectiveKey,
  groupByCategory,
  eventToKeyCombo,
  saveCustomBinding,
  resetBinding,
  resetAllBindings,
} from '@/lib/workspace/keybindings';

interface KeyboardShortcutsPanelProps {
  open: boolean;
  onClose: () => void;
}

export function KeyboardShortcutsPanel({ open, onClose }: KeyboardShortcutsPanelProps) {
  const [editingAction, setEditingAction] = useState<string | null>(null);
  const [bindings, setBindings] = useState(() => getMergedBindings());
  const dialogRef = useRef<HTMLDivElement>(null);

  const grouped = groupByCategory(bindings);

  const refreshBindings = useCallback(() => {
    setBindings(getMergedBindings());
  }, []);

  // Reload bindings when panel opens (prev-value pattern)
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) {
      setBindings(getMergedBindings());
    } else {
      setEditingAction(null);
    }
  }

  // Close on Escape (only if not editing a binding)
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (editingAction) {
        e.preventDefault();
        e.stopPropagation();

        if (e.key === 'Escape') {
          // Cancel editing
          setEditingAction(null);
          return;
        }

        const combo = eventToKeyCombo(e);
        if (combo) {
          saveCustomBinding(editingAction, combo);
          setEditingAction(null);
          refreshBindings();
        }
        return;
      }

      if (e.key === 'Escape') onClose();
    },
    [editingAction, onClose, refreshBindings]
  );

  useEffect(() => {
    if (!open) return;

    const handleFocusTrap = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        const dialog = dialogRef.current;
        if (!dialog) return;
        const focusable = dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) { e.preventDefault(); last.focus(); }
        } else {
          if (document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('keydown', handleFocusTrap);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('keydown', handleFocusTrap);
    };
  }, [open, handleKeyDown]);

  // Auto-focus dialog on open
  useEffect(() => {
    if (open) dialogRef.current?.focus();
  }, [open]);

  const handleReset = useCallback((action: string) => {
    resetBinding(action);
    refreshBindings();
  }, [refreshBindings]);

  const handleResetAll = useCallback(() => {
    resetAllBindings();
    refreshBindings();
  }, [refreshBindings]);

  if (!open) return null;

  // Non-rebindable shortcuts shown as static info
  const staticShortcuts = [
    { keys: 'Click', action: 'Select entity' },
    { keys: 'Ctrl + Click', action: 'Multi-select' },
  ];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-dialog-title"
        tabIndex={-1}
        className="mx-4 w-full max-w-lg rounded-lg border border-zinc-700 bg-zinc-900 p-5 shadow-2xl focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id="shortcuts-dialog-title" className="text-base font-semibold text-zinc-100">Keyboard Shortcuts</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={handleResetAll}
              aria-label="Reset all shortcuts to defaults"
              className="flex items-center gap-1 rounded px-2 py-1 text-[10px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
              title="Reset all to defaults"
            >
              <RotateCcw size={10} />
              Reset All
            </button>
            <button
              onClick={onClose}
              aria-label="Close keyboard shortcuts"
              className="rounded p-1 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Static (mouse) shortcuts */}
        <div className="mb-3">
          <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wider text-zinc-400">Mouse</h3>
          <div className="space-y-1">
            {staticShortcuts.map((s) => (
              <div key={s.keys} className="flex items-center justify-between text-sm">
                <span className="text-zinc-400">{s.action}</span>
                <kbd className="rounded bg-zinc-800 px-1.5 py-0.5 text-[11px] font-mono text-zinc-300">
                  {s.keys}
                </kbd>
              </div>
            ))}
          </div>
        </div>

        {/* Customizable bindings */}
        <div className="grid grid-cols-2 gap-4">
          {Object.entries(grouped).map(([category, categoryBindings]) => (
            <div key={category}>
              <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wider text-zinc-400">
                {category}
              </h3>
              <div className="space-y-1">
                {categoryBindings.map((binding) => {
                  const isEditing = editingAction === binding.action;
                  const isCustomized = binding.customKey !== null;
                  const effectiveKey = getEffectiveKey(binding);

                  return (
                    <div key={binding.action} className="flex items-center justify-between text-sm group">
                      <span className="text-zinc-400">{binding.label}</span>
                      <div className="flex items-center gap-1">
                        {isCustomized && !isEditing && (
                          <button
                            onClick={() => handleReset(binding.action)}
                            aria-label={`Reset ${binding.label} to default`}
                            className="opacity-0 group-hover:opacity-100 rounded p-0.5 text-zinc-400 hover:text-zinc-400 transition-opacity"
                            title="Reset to default"
                          >
                            <RotateCcw size={10} />
                          </button>
                        )}
                        <button
                          onClick={() => setEditingAction(isEditing ? null : binding.action)}
                          aria-label={isEditing ? `Press a key combo for ${binding.label}` : `Rebind ${binding.label} (${effectiveKey})`}
                          className={`rounded px-1.5 py-0.5 text-[11px] font-mono transition-colors ${
                            isEditing
                              ? 'bg-blue-600 text-white motion-safe:animate-pulse'
                              : isCustomized
                                ? 'bg-blue-900/50 text-blue-300 hover:bg-blue-900/70'
                                : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                          }`}
                          title={isEditing ? 'Press a key combo...' : 'Click to rebind'}
                        >
                          {isEditing ? 'Press key...' : effectiveKey}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <p className="mt-4 text-center text-[10px] text-zinc-400">
          Click any shortcut to rebind it. Press <kbd className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-zinc-400">Esc</kbd> to cancel.
          Press <kbd className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-zinc-400">?</kbd> to toggle this panel.
        </p>
      </div>
    </div>
  );
}
