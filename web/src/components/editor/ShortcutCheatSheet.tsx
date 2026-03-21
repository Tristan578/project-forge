'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { X, Search } from 'lucide-react';
import { KEYBOARD_SHORTCUTS, SHORTCUT_CATEGORIES, type ShortcutEntry } from '@/data/keyboardShortcuts';

interface ShortcutCheatSheetProps {
  open: boolean;
  onClose: () => void;
}

function formatKey(shortcut: ShortcutEntry): string {
  const parts = shortcut.modifiers ? [...shortcut.modifiers] : [];
  parts.push(shortcut.key);
  return parts.join(' + ');
}

function KeyBadge({ children }: { children: string }) {
  return (
    <kbd className="inline-block min-w-[1.5rem] rounded bg-zinc-800 px-1.5 py-0.5 text-center text-[11px] font-mono text-zinc-300 shadow-sm border border-zinc-700">
      {children}
    </kbd>
  );
}

function ShortcutKeyDisplay({ shortcut }: { shortcut: ShortcutEntry }) {
  const parts = shortcut.modifiers ? [...shortcut.modifiers] : [];
  parts.push(shortcut.key);

  return (
    <span className="flex items-center gap-0.5 shrink-0">
      {parts.map((part, i) => (
        <span key={`${part}-${i}`} className="flex items-center gap-0.5">
          {i > 0 && <span className="text-[10px] text-zinc-400">+</span>}
          <KeyBadge>{part}</KeyBadge>
        </span>
      ))}
    </span>
  );
}

export function ShortcutCheatSheet({ open, onClose }: ShortcutCheatSheetProps) {
  const [search, setSearch] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Reset search when opening (prev-value pattern)
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) {
      setSearch('');
    }
  }

  // Focus search input on open
  useEffect(() => {
    if (open) {
      // Defer to next frame so the input is rendered
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
      });
    }
  }, [open]);

  // Close on Escape
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    },
    [onClose]
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

  if (!open) return null;

  const query = search.toLowerCase().trim();
  const filtered = query
    ? KEYBOARD_SHORTCUTS.filter(
        (s) =>
          s.action.toLowerCase().includes(query) ||
          s.key.toLowerCase().includes(query) ||
          s.category.toLowerCase().includes(query) ||
          formatKey(s).toLowerCase().includes(query)
      )
    : KEYBOARD_SHORTCUTS;

  // Group filtered shortcuts by category, preserving category order
  const grouped: Record<string, ShortcutEntry[]> = {};
  for (const s of filtered) {
    if (!grouped[s.category]) grouped[s.category] = [];
    grouped[s.category].push(s);
  }

  const orderedCategories = SHORTCUT_CATEGORIES.filter((c) => grouped[c]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60"
      onClick={onClose}
      data-testid="cheatsheet-backdrop"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cheatsheet-title"
        tabIndex={-1}
        className="mx-4 flex max-h-[80vh] w-full max-w-2xl flex-col rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3">
          <h2 id="cheatsheet-title" className="text-base font-semibold text-zinc-100">
            Keyboard Shortcuts
          </h2>
          <button
            onClick={onClose}
            aria-label="Close cheat sheet"
            className="rounded p-1 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Search */}
        <div className="border-b border-zinc-800 px-5 py-2">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              ref={searchInputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search shortcuts..."
              aria-label="Search shortcuts"
              className="w-full rounded bg-zinc-800 py-1.5 pl-8 pr-3 text-sm text-zinc-200 placeholder-zinc-500 border border-zinc-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors"
            />
          </div>
        </div>

        {/* Shortcuts list */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {orderedCategories.length === 0 && (
            <p className="py-8 text-center text-sm text-zinc-400">
              No shortcuts match &ldquo;{search}&rdquo;
            </p>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {orderedCategories.map((category) => (
              <div key={category}>
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-400">
                  {category}
                </h3>
                <div className="space-y-1.5">
                  {grouped[category].map((shortcut, i) => (
                    <div
                      key={`${shortcut.action}-${i}`}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <span className="text-zinc-400 truncate">{shortcut.action}</span>
                      <ShortcutKeyDisplay shortcut={shortcut} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-zinc-800 px-5 py-2">
          <p className="text-center text-[10px] text-zinc-400">
            Press <KeyBadge>?</KeyBadge> to toggle this overlay.
            Press <KeyBadge>Esc</KeyBadge> to close.
          </p>
        </div>
      </div>
    </div>
  );
}
