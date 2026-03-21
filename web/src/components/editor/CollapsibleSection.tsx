'use client';

import { useState, useCallback, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

const STORAGE_KEY = 'forge-inspector-collapsed';

/**
 * Read collapsed section IDs from localStorage.
 */
function readCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const arr: unknown = JSON.parse(raw);
    if (Array.isArray(arr)) return new Set(arr.filter((s): s is string => typeof s === 'string'));
  } catch {
    // Ignore
  }
  return new Set();
}

/**
 * Write collapsed section IDs to localStorage.
 */
function writeCollapsed(ids: Set<string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // Ignore quota errors
  }
}

interface CollapsibleSectionProps {
  /** Unique ID for localStorage persistence (e.g. "transform", "material") */
  id: string;
  /** Display title */
  title: string;
  /** Optional right-side content (badges, buttons) */
  headerRight?: ReactNode;
  children: ReactNode;
  /** Additional className on the outer wrapper */
  className?: string;
}

export function CollapsibleSection({
  id,
  title,
  headerRight,
  children,
  className = '',
}: CollapsibleSectionProps) {
  // Initialize from localStorage
  const [isCollapsed, setIsCollapsed] = useState(() => readCollapsed().has(id));

  const toggle = useCallback(() => {
    setIsCollapsed((prev) => {
      const next = !prev;
      const collapsed = readCollapsed();
      if (next) {
        collapsed.add(id);
      } else {
        collapsed.delete(id);
      }
      writeCollapsed(collapsed);
      return next;
    });
  }, [id]);

  return (
    <div className={`border-t border-zinc-800 pt-3 mt-3 ${className}`}>
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center gap-1.5 text-left group"
        aria-expanded={!isCollapsed}
      >
        {isCollapsed ? (
          <ChevronRight className="w-3 h-3 text-zinc-400 group-hover:text-zinc-300" />
        ) : (
          <ChevronDown className="w-3 h-3 text-zinc-400 group-hover:text-zinc-300" />
        )}
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400 group-hover:text-zinc-400">
          {title}
        </h3>
        {headerRight && <div className="ml-auto">{headerRight}</div>}
      </button>
      {!isCollapsed && <div className="mt-2">{children}</div>}
    </div>
  );
}
