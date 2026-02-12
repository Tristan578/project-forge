/**
 * Individual tree node component for the scene hierarchy.
 *
 * Renders a single entity with its children recursively.
 * Supports selection, visibility toggle, expand/collapse, context menu, and inline editing.
 */

'use client';

import { useState, useCallback, useEffect, useRef, type MouseEvent } from 'react';
import { ChevronRight, ChevronDown, Eye, EyeOff, Box, Sun, Camera, Layers } from 'lucide-react';
import { useEditorStore, type SceneNode as SceneNodeData } from '@/stores/editorStore';
import type { DropTarget, DropZone } from '@/lib/dndUtils';
import { HighlightedText } from './HighlightedText';

interface SceneNodeProps {
  node: SceneNodeData;
  depth: number;
  onContextMenu: (data: {
    entityId: string;
    entityName: string;
    position: { x: number; y: number };
  }) => void;
  isEditing?: boolean;
  onEditComplete?: (newName: string | null) => void;
  // Drag-related props
  isDragging?: boolean;
  draggedEntityId?: string | null;
  invalidTargetIds?: Set<string>;
  dropTarget?: DropTarget | null;
  onDragStart?: (entityId: string, entityName: string) => void;
  onDragEnd?: () => void;
  onDragOver?: (entityId: string, zone: DropZone, depth: number) => void;
  onDrop?: (entityId: string) => void;
  // Filter-related props
  filterTerm?: string;
  matchingIds?: Set<string>;
  visibleIds?: Set<string>;
}

// Icon mapping based on component types or entity names
function getEntityIconName(node: SceneNodeData): 'camera' | 'sun' | 'layers' | 'box' {
  const name = node.name.toLowerCase();

  if (name.includes('camera')) return 'camera';
  if (name.includes('light') || name.includes('sun')) return 'sun';
  if (name.includes('ground') || name.includes('plane')) return 'layers';

  // Default to box for meshes
  return 'box';
}

// Static icon component
function EntityIcon({ type, className }: { type: 'camera' | 'sun' | 'layers' | 'box'; className?: string }) {
  switch (type) {
    case 'camera':
      return <Camera className={className} />;
    case 'sun':
      return <Sun className={className} />;
    case 'layers':
      return <Layers className={className} />;
    case 'box':
    default:
      return <Box className={className} />;
  }
}

export function SceneNode({
  node,
  depth,
  onContextMenu,
  isEditing = false,
  onEditComplete,
  isDragging,
  draggedEntityId,
  invalidTargetIds,
  dropTarget,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  filterTerm,
  matchingIds,
  visibleIds,
}: SceneNodeProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  // Use a lazy initializer to avoid the linter warning
  const [editValue, setEditValue] = useState(() => node.name);
  const [editingEntityId, setEditingEntityId] = useState<string | null>(null);

  const selectedIds = useEditorStore((s) => s.selectedIds);
  const primaryId = useEditorStore((s) => s.primaryId);
  const sceneGraph = useEditorStore((s) => s.sceneGraph);
  const selectEntity = useEditorStore((s) => s.selectEntity);
  const selectRange = useEditorStore((s) => s.selectRange);
  const toggleVisibility = useEditorStore((s) => s.toggleVisibility);

  const isSelected = selectedIds.has(node.entityId);
  const isPrimary = primaryId === node.entityId;
  const hasChildren = node.children.length > 0;

  const iconType = getEntityIconName(node);

  // Drag state
  const isInvalidTarget = invalidTargetIds?.has(node.entityId) ?? false;
  const isBeingDragged = draggedEntityId === node.entityId;
  const isDropTarget = dropTarget?.entityId === node.entityId;

  // Track when editing starts for a specific entity
  if (isEditing && editingEntityId !== node.entityId) {
    setEditingEntityId(node.entityId);
    setEditValue(node.name);
  } else if (!isEditing && editingEntityId === node.entityId) {
    setEditingEntityId(null);
  }

  // Focus input when editing starts
  useEffect(() => {
    if (isEditing && inputRef.current) {
      // Use requestAnimationFrame to ensure DOM is ready
      requestAnimationFrame(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.select();
        }
      });
    }
  }, [isEditing]);

  const handleClick = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();

      if (e.shiftKey && primaryId) {
        // Shift+Click: select range
        selectRange(primaryId, node.entityId);
      } else if (e.ctrlKey || e.metaKey) {
        // Ctrl+Click: toggle selection
        selectEntity(node.entityId, 'toggle');
      } else {
        // Normal click: replace selection
        selectEntity(node.entityId, 'replace');
      }
    },
    [node.entityId, primaryId, selectEntity, selectRange]
  );

  const handleVisibilityClick = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      toggleVisibility(node.entityId);
    },
    [node.entityId, toggleVisibility]
  );

  const handleExpandClick = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      setIsExpanded((prev) => !prev);
    },
    []
  );

  const handleContextMenuClick = useCallback(
    (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // Select the entity if not already selected
      if (!isSelected) {
        selectEntity(node.entityId, 'replace');
      }

      // Open context menu via callback prop
      onContextMenu({
        entityId: node.entityId,
        entityName: node.name,
        position: { x: e.clientX, y: e.clientY },
      });
    },
    [node.entityId, node.name, isSelected, selectEntity, onContextMenu]
  );

  const handleEditKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        onEditComplete?.(editValue.trim() || null);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onEditComplete?.(null); // Cancel
      }
    },
    [editValue, onEditComplete]
  );

  const handleEditBlur = useCallback(() => {
    onEditComplete?.(editValue.trim() || null);
  }, [editValue, onEditComplete]);

  // Drag handlers
  const getDropZone = useCallback((e: React.DragEvent): DropZone => {
    if (!rowRef.current) return 'on';

    const rect = rowRef.current.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const height = rect.height;
    const threshold = height * 0.2; // 20% top/bottom for before/after

    if (y < threshold) return 'before';
    if (y > height - threshold) return 'after';
    return 'on';
  }, []);

  const handleDragStart = useCallback((e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', node.entityId);
    onDragStart?.(node.entityId, node.name);
  }, [node.entityId, node.name, onDragStart]);

  const handleDragEnd = useCallback(() => {
    onDragEnd?.();
  }, [onDragEnd]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();

    if (isInvalidTarget || isBeingDragged) {
      e.dataTransfer.dropEffect = 'none';
      return;
    }

    e.dataTransfer.dropEffect = 'move';
    const zone = getDropZone(e);
    onDragOver?.(node.entityId, zone, depth);
  }, [isInvalidTarget, isBeingDragged, getDropZone, node.entityId, depth, onDragOver]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (isInvalidTarget || isBeingDragged) return;

    onDrop?.(node.entityId);
  }, [isInvalidTarget, isBeingDragged, node.entityId, onDrop]);

  // Get selection styling
  const getSelectionClasses = () => {
    if (isPrimary) {
      return 'bg-blue-600/30 border-l-2 border-blue-500';
    }
    if (isSelected) {
      return 'bg-blue-600/15 border-l-2 border-blue-400/50';
    }
    return 'hover:bg-white/5 border-l-2 border-transparent';
  };

  // Get visibility styling
  const getVisibilityClasses = () => {
    if (!node.visible) {
      return 'opacity-50';
    }
    return '';
  };

  // Get drag styling
  const getDragClasses = () => {
    if (isBeingDragged) {
      return 'opacity-50';
    }
    if (isDragging && isInvalidTarget) {
      return 'opacity-40 cursor-not-allowed';
    }
    if (isDropTarget && dropTarget?.zone === 'on') {
      return 'bg-blue-500/20 ring-1 ring-blue-500';
    }
    return '';
  };

  return (
    <div className={getVisibilityClasses()}>
      {/* Drop indicator BEFORE */}
      {isDropTarget && dropTarget?.zone === 'before' && (
        <div
          className="h-0.5 bg-blue-500 rounded-full"
          style={{ marginLeft: `${depth * 16 + 8}px` }}
        />
      )}

      <div
        ref={rowRef}
        draggable={!isEditing}
        className={`flex items-center gap-1 px-2 py-1 cursor-grab select-none ${getSelectionClasses()} ${getDragClasses()}`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={handleClick}
        onContextMenu={handleContextMenuClick}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {/* Expand/collapse chevron */}
        <button
          className={`w-4 h-4 flex items-center justify-center text-neutral-500 hover:text-neutral-300 ${
            !hasChildren ? 'invisible' : ''
          }`}
          onClick={handleExpandClick}
        >
          {isExpanded ? (
            <ChevronDown className="w-3 h-3" />
          ) : (
            <ChevronRight className="w-3 h-3" />
          )}
        </button>

        {/* Visibility toggle */}
        <button
          className="w-4 h-4 flex items-center justify-center text-neutral-500 hover:text-neutral-300"
          onClick={handleVisibilityClick}
          title={node.visible ? 'Hide entity' : 'Show entity'}
        >
          {node.visible ? (
            <Eye className="w-3 h-3" />
          ) : (
            <EyeOff className="w-3 h-3" />
          )}
        </button>

        {/* Entity icon */}
        <EntityIcon type={iconType} className="w-4 h-4 text-neutral-400" />

        {/* Entity name (with inline editing support) */}
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleEditKeyDown}
            onBlur={handleEditBlur}
            onClick={(e) => e.stopPropagation()}
            className="
              flex-1 min-w-0 text-sm bg-neutral-700 text-white
              border border-blue-500 rounded px-1 py-0.5
              outline-none focus:ring-1 focus:ring-blue-400
            "
          />
        ) : (
          <HighlightedText
            text={node.name}
            highlight={filterTerm}
            className={`text-sm truncate ${
              isPrimary ? 'text-white font-medium' : matchingIds?.has(node.entityId) ? 'text-neutral-200' : 'text-neutral-300'
            } ${filterTerm && !matchingIds?.has(node.entityId) ? 'opacity-60' : ''}`}
          />
        )}
      </div>

      {/* Drop indicator AFTER (only if not expanded or no children) */}
      {isDropTarget && dropTarget?.zone === 'after' && !isExpanded && (
        <div
          className="h-0.5 bg-blue-500 rounded-full"
          style={{ marginLeft: `${depth * 16 + 8}px` }}
        />
      )}

      {/* Children */}
      {hasChildren && isExpanded && (
        <div>
          {node.children
            .filter((childId) => !visibleIds || visibleIds.has(childId))
            .map((childId) => {
              const childNode = sceneGraph.nodes[childId];
              if (!childNode) return null;
              return (
                <SceneNode
                  key={childId}
                  node={childNode}
                  depth={depth + 1}
                  onContextMenu={onContextMenu}
                  isEditing={editingEntityId === childId}
                  onEditComplete={onEditComplete}
                  isDragging={isDragging}
                  draggedEntityId={draggedEntityId}
                  invalidTargetIds={invalidTargetIds}
                  dropTarget={dropTarget?.entityId === childId ? dropTarget : null}
                  onDragStart={onDragStart}
                  onDragEnd={onDragEnd}
                  onDragOver={onDragOver}
                  onDrop={onDrop}
                  filterTerm={filterTerm}
                  matchingIds={matchingIds}
                  visibleIds={visibleIds}
                />
              );
            })}
        </div>
      )}
    </div>
  );
}
