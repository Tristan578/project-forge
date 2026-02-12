/**
 * Search input component for the Scene Hierarchy panel.
 *
 * Provides debounced filtering with clear button and keyboard shortcuts.
 */

'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Search, X } from 'lucide-react';
import { useEditorStore } from '@/stores/editorStore';

interface HierarchySearchProps {
  /** Number of entities matching the filter */
  matchCount?: number;
}

export function HierarchySearch({ matchCount }: HierarchySearchProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hierarchyFilter = useEditorStore((s) => s.hierarchyFilter);
  const setHierarchyFilter = useEditorStore((s) => s.setHierarchyFilter);
  const clearHierarchyFilter = useEditorStore((s) => s.clearHierarchyFilter);

  // Local input value for responsive typing (debounced to store)
  const [localValue, setLocalValue] = useState(hierarchyFilter);

  // Sync local value when store changes (e.g., from clear action)
  useEffect(() => {
    setLocalValue(hierarchyFilter);
  }, [hierarchyFilter]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setLocalValue(value);

      // Debounce the store update
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }

      debounceRef.current = setTimeout(() => {
        setHierarchyFilter(value);
      }, 150);
    },
    [setHierarchyFilter]
  );

  const handleClear = useCallback(() => {
    setLocalValue('');
    clearHierarchyFilter();
    inputRef.current?.focus();
  }, [clearHierarchyFilter]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClear();
        inputRef.current?.blur();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        inputRef.current?.blur();
      }
    },
    [handleClear]
  );

  // Keyboard shortcut: Ctrl+F to focus
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        // Only capture if not in another input
        const activeEl = document.activeElement;
        const isInInput =
          activeEl instanceof HTMLInputElement ||
          activeEl instanceof HTMLTextAreaElement;

        if (!isInInput || activeEl === inputRef.current) {
          e.preventDefault();
          inputRef.current?.focus();
          inputRef.current?.select();
        }
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  const hasValue = localValue.length > 0;
  const showMatchCount = hasValue && matchCount !== undefined;

  return (
    <div className="px-2 py-1.5 border-b border-neutral-700">
      <div className="relative flex items-center">
        {/* Search icon */}
        <Search className="absolute left-2 w-3.5 h-3.5 text-neutral-500 pointer-events-none" />

        {/* Input */}
        <input
          ref={inputRef}
          type="text"
          value={localValue}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Search entities..."
          className="
            w-full pl-7 pr-7 py-1 text-sm
            bg-neutral-800 text-neutral-200
            border border-neutral-600 rounded
            placeholder:text-neutral-500
            focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30
          "
        />

        {/* Match count or clear button */}
        <div className="absolute right-1.5 flex items-center gap-1">
          {showMatchCount && (
            <span className="text-xs text-neutral-500">
              {matchCount}
            </span>
          )}
          {hasValue && (
            <button
              onClick={handleClear}
              className="p-0.5 text-neutral-500 hover:text-neutral-300 rounded hover:bg-neutral-700"
              title="Clear filter (Esc)"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
