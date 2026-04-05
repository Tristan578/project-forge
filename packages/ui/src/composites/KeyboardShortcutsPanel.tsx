import { useState, type ReactNode } from 'react';
import { cn } from '../utils/cn';

export interface KeyboardShortcut {
  id: string;
  label: string;
  keys: string[];
}

export interface ShortcutGroup {
  title: string;
  shortcuts: KeyboardShortcut[];
}

export interface KeyboardShortcutsPanelProps {
  groups: ShortcutGroup[];
  onClose?: () => void;
  className?: string;
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd
      className="inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 rounded text-xs font-mono"
      style={{
        backgroundColor: 'var(--sf-bg-elevated)',
        color: 'var(--sf-text)',
        border: '1px solid var(--sf-border-strong)',
        borderRadius: 'var(--sf-radius-sm)',
      }}
    >
      {children}
    </kbd>
  );
}

export function KeyboardShortcutsPanel({
  groups,
  onClose,
  className,
}: KeyboardShortcutsPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredGroups = groups
    .map((group) => ({
      ...group,
      shortcuts: group.shortcuts.filter(
        (s) =>
          s.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
          s.keys.some((k) => k.toLowerCase().includes(searchQuery.toLowerCase()))
      ),
    }))
    .filter((group) => group.shortcuts.length > 0);

  return (
    <div
      className={cn('flex flex-col', className)}
      style={{
        backgroundColor: 'var(--sf-bg-surface)',
        color: 'var(--sf-text)',
      }}
    >
      <div
        className="flex items-center justify-between px-4 py-3 border-b"
        style={{ borderColor: 'var(--sf-border)' }}
      >
        <h2 className="text-sm font-medium">Keyboard Shortcuts</h2>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close keyboard shortcuts"
            className="p-1 rounded transition-colors"
            style={{ color: 'var(--sf-text-muted)' }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14">
              <path d="M3 3 L11 11 M11 3 L3 11" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </button>
        )}
      </div>

      <div className="px-4 py-2">
        <input
          type="text"
          placeholder="Search shortcuts..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label="Search keyboard shortcuts"
          className={cn(
            'w-full rounded px-2.5 py-1.5 text-xs outline-none focus:ring-1',
          )}
          style={{
            backgroundColor: 'var(--sf-bg-elevated)',
            color: 'var(--sf-text)',
            borderRadius: 'var(--sf-radius-md)',
          }}
        />
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-2">
        {filteredGroups.map((group) => (
          <div key={group.title} className="mb-4">
            <h3
              className="text-xs font-medium uppercase mb-2"
              style={{ color: 'var(--sf-text-muted)' }}
            >
              {group.title}
            </h3>
            <div className="space-y-1.5">
              {group.shortcuts.map((shortcut) => (
                <div
                  key={shortcut.id}
                  className="flex items-center justify-between py-1"
                >
                  <span className="text-xs" style={{ color: 'var(--sf-text-secondary)' }}>
                    {shortcut.label}
                  </span>
                  <div className="flex items-center gap-1">
                    {shortcut.keys.map((key, i) => (
                      <Kbd key={i}>{key}</Kbd>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
        {filteredGroups.length === 0 && (
          <p className="text-xs text-center py-4" style={{ color: 'var(--sf-text-muted)' }}>
            No shortcuts match &ldquo;{searchQuery}&rdquo;
          </p>
        )}
      </div>
    </div>
  );
}
