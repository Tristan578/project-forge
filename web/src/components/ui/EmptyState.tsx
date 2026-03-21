'use client';

import type { LucideIcon } from 'lucide-react';

interface EmptyStateAction {
  label: string;
  onClick: () => void;
}

interface EmptyStateProps {
  /** Lucide icon component to display */
  icon: LucideIcon;
  /** Primary heading */
  title: string;
  /** Supporting description sentence */
  description: string;
  /** Optional call-to-action button */
  action?: EmptyStateAction;
  /** Additional CSS class names for the wrapper */
  className?: string;
}

/**
 * Reusable empty state component for editor panels.
 *
 * Renders a centered, non-intrusive placeholder with an icon, title,
 * description, and optional action button. Follows the zinc-* color
 * scale and uses a subtle dashed border to hint at the interactive zone.
 *
 * Usage:
 *   <EmptyState
 *     icon={Layers}
 *     title="No entities yet"
 *     description="Add entities using the toolbar or ask AI to build a scene"
 *     action={{ label: 'Add Entity', onClick: handleAdd }}
 *   />
 */
export function EmptyState({ icon: Icon, title, description, action, className = '' }: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-zinc-700 bg-zinc-800/20 p-6 text-center ${className}`}
    >
      <Icon
        size={28}
        className="text-zinc-400"
        aria-hidden="true"
      />
      <div className="space-y-1">
        <p className="text-sm font-medium text-zinc-400">{title}</p>
        <p className="text-xs text-zinc-400 max-w-[220px]">{description}</p>
      </div>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-1 rounded bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-300
            border border-zinc-700 hover:bg-zinc-700 hover:text-zinc-200 hover:border-zinc-600
            transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
