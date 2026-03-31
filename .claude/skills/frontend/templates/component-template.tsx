'use client';

// Standard React component scaffold for SpawnForge editor panels.
//
// Instructions:
//   1. Replace "MyComponent" with your PascalCase component name everywhere.
//   2. Define domain-specific props in the interface.
//   3. Use cn() for conditional class names (already imported).
//   4. Prefer named exports — no default exports.
//   5. Keep this file co-located with a __tests__/MyComponent.test.tsx.

import { useCallback, useState } from 'react';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MyComponentProps {
  /** The entity this component displays data for. Required. */
  entityId: string;
  /** Optional additional CSS classes. */
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * MyComponent — one-line description of purpose.
 *
 * Reads state from Zustand store via granular selectors. Dispatches engine
 * commands through `dispatchCommand` rather than mutating ECS state directly.
 *
 * @example
 *   <MyComponent entityId="abc-123" />
 */
export function MyComponent({ entityId, className }: MyComponentProps) {
  // --- Local UI state (ephemeral, not persisted to engine) ---
  const [isExpanded, setIsExpanded] = useState(false);

  // --- Zustand store selectors (granular — never select the whole store) ---
  // const data = useEditorStore(s => s.myDataMap[entityId]);
  // const dispatchCommand = useEditorStore(s => s.dispatchCommand);

  // --- Stable event handlers (wrapped in useCallback — deps listed exhaustively) ---
  const handleToggle = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  // --- Guard: entity has no data yet ---
  // if (!data) return null;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div
      className={cn(
        'space-y-3 p-3',   // layout
        'text-zinc-200',    // text color — always zinc-*, never gray-*
        className,
      )}
    >
      {/* Section header */}
      <button
        type="button"
        onClick={handleToggle}
        className="flex w-full items-center justify-between"
        aria-expanded={isExpanded}
        aria-controls="my-component-content"
      >
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
          My Component
        </h3>
      </button>

      {/* Collapsible content */}
      {isExpanded && (
        <div id="my-component-content">
          {/* TODO: add inspector fields */}
        </div>
      )}
    </div>
  );
}
