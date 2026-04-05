import { useState, useCallback, useMemo, type ReactNode, type KeyboardEvent } from 'react';
import { cn } from '../utils/cn';

export interface TreeNode {
  id: string;
  label: string;
  children?: TreeNode[];
  icon?: ReactNode;
}

export interface TreeViewProps {
  nodes: TreeNode[];
  selectedId?: string;
  onSelect?: (id: string) => void;
  expandedIds?: string[];
  onToggleExpand?: (id: string) => void;
  className?: string;
}

function TreeItem({
  node,
  depth,
  selectedId,
  expandedIds,
  onSelect,
  onToggleExpand,
}: {
  node: TreeNode;
  depth: number;
  selectedId?: string;
  expandedIds: Set<string>;
  onSelect?: (id: string) => void;
  onToggleExpand: (id: string) => void;
}) {
  const hasChildren = node.children && node.children.length > 0;
  const isExpanded = expandedIds.has(node.id);
  const isSelected = selectedId === node.id;

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect?.(node.id);
    } else if (e.key === 'ArrowRight' && hasChildren && !isExpanded) {
      e.preventDefault();
      onToggleExpand(node.id);
    } else if (e.key === 'ArrowLeft' && hasChildren && isExpanded) {
      e.preventDefault();
      onToggleExpand(node.id);
    }
  };

  return (
    <div role="treeitem" aria-expanded={hasChildren ? isExpanded : undefined} aria-selected={isSelected}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => onSelect?.(node.id)}
        onKeyDown={handleKeyDown}
        className={cn(
          'flex items-center gap-1 px-2 py-1 cursor-pointer text-xs rounded',
          'transition-colors duration-100',
        )}
        style={{
          paddingLeft: `${depth * 16 + 8}px`,
          backgroundColor: isSelected ? 'var(--sf-bg-elevated)' : 'transparent',
          color: isSelected ? 'var(--sf-text)' : 'var(--sf-text-secondary)',
        }}
      >
        {hasChildren && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(node.id);
            }}
            aria-label={isExpanded ? `Collapse ${node.label}` : `Expand ${node.label}`}
            className="w-4 h-4 flex items-center justify-center shrink-0"
            style={{ color: 'var(--sf-text-muted)' }}
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              className={cn('transition-transform duration-100', isExpanded && 'rotate-90')}
            >
              <path d="M3 1 L7 5 L3 9" fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </button>
        )}
        {!hasChildren && <span className="w-4 shrink-0" />}
        {node.icon && <span className="shrink-0">{node.icon}</span>}
        <span className="truncate">{node.label}</span>
      </div>
      {hasChildren && isExpanded && (
        <div role="group">
          {node.children!.map((child) => (
            <TreeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              expandedIds={expandedIds}
              onSelect={onSelect}
              onToggleExpand={onToggleExpand}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function TreeView({
  nodes,
  selectedId,
  onSelect,
  expandedIds: controlledExpandedIds,
  onToggleExpand: controlledOnToggle,
  className,
}: TreeViewProps) {
  const [internalExpanded, setInternalExpanded] = useState<Set<string>>(new Set());

  const expandedSet = useMemo(
    () => controlledExpandedIds ? new Set(controlledExpandedIds) : internalExpanded,
    [controlledExpandedIds, internalExpanded],
  );

  const handleToggle = useCallback(
    (id: string) => {
      if (controlledOnToggle) {
        controlledOnToggle(id);
      } else {
        setInternalExpanded((prev) => {
          const next = new Set(prev);
          if (next.has(id)) {
            next.delete(id);
          } else {
            next.add(id);
          }
          return next;
        });
      }
    },
    [controlledOnToggle]
  );

  return (
    <div
      role="tree"
      className={cn('text-xs', className)}
      style={{ color: 'var(--sf-text)' }}
    >
      {nodes.map((node) => (
        <TreeItem
          key={node.id}
          node={node}
          depth={0}
          selectedId={selectedId}
          expandedIds={expandedSet}
          onSelect={onSelect}
          onToggleExpand={handleToggle}
        />
      ))}
    </div>
  );
}
