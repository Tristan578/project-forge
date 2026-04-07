/**
 * Scene Hierarchy Panel component.
 *
 * Displays a tree view of all entities in the Bevy scene.
 * Supports selection, multi-select, visibility toggle, and context menu.
 */

'use client';

import { useState, useCallback, useRef, useMemo, memo, type MouseEvent, type KeyboardEvent } from 'react';
import { Layers, PackagePlus } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import { useEditorStore, getCommandDispatcher, type SceneGraph } from '@/stores/editorStore';
import { SceneNode } from './SceneNode';
import { ContextMenu } from './ContextMenu';
import { HierarchySearch } from './HierarchySearch';
import { computeInvalidTargets, type DropTarget, type DropZone } from '@/lib/dndUtils';
import { filterHierarchy } from '@/lib/hierarchyFilter';

/**
 * Build a flat, depth-first list of visible entity IDs for keyboard navigation.
 * Respects expanded state and filter visibility.
 */
export function flattenVisibleNodes(
  rootIds: string[],
  graph: SceneGraph,
  expandedIds: Set<string>,
  visibleIds?: Set<string>,
): string[] {
  const result: string[] = [];

  function walk(ids: string[]) {
    for (const id of ids) {
      if (visibleIds && !visibleIds.has(id)) continue;
      const node = graph.nodes[id];
      if (!node) continue;
      result.push(id);
      if (node.children.length > 0 && expandedIds.has(id)) {
        walk(node.children);
      }
    }
  }

  walk(rootIds);
  return result;
}

export const SceneHierarchy = memo(function SceneHierarchy() {
  const containerRef = useRef<HTMLDivElement>(null);

  const sceneGraph = useEditorStore((s) => s.sceneGraph);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const clearSelection = useEditorStore((s) => s.clearSelection);
  const selectEntity = useEditorStore((s) => s.selectEntity);
  const deleteSelectedEntities = useEditorStore((s) => s.deleteSelectedEntities);
  const duplicateSelectedEntity = useEditorStore((s) => s.duplicateSelectedEntity);
  const renameEntity = useEditorStore((s) => s.renameEntity);
  const reparentEntity = useEditorStore((s) => s.reparentEntity);
  const hierarchyFilter = useEditorStore((s) => s.hierarchyFilter);

  // Memoize filter results
  const filterResult = useMemo(() => {
    return filterHierarchy(sceneGraph, hierarchyFilter);
  }, [sceneGraph, hierarchyFilter]);

  const hasEntities = sceneGraph.rootIds.length > 0;
  const isFiltering = hierarchyFilter.trim().length > 0;

  // Keyboard navigation state
  const [focusedEntityId, setFocusedEntityId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // expandedIds stores IDs that are COLLAPSED (toggled from default expanded).
  // Invert to get the actual expanded set: start with all IDs, remove toggled ones.
  const allNodeIds = useMemo(() => new Set(Object.keys(sceneGraph.nodes)), [sceneGraph]);
  const effectiveExpandedIds = useMemo(() => {
    const expanded = new Set(allNodeIds);
    for (const id of expandedIds) {
      expanded.delete(id);
    }
    return expanded;
  }, [allNodeIds, expandedIds]);

  const { ids: flatNodeIds, indexMap } = useMemo(() => {
    const ids = flattenVisibleNodes(
      isFiltering ? filterResult.filteredRootIds : sceneGraph.rootIds,
      sceneGraph,
      effectiveExpandedIds,
      isFiltering ? filterResult.visibleIds : undefined,
    );
    const map = new Map(ids.map((id, i) => [id, i]));
    return { ids, indexMap: map };
  }, [sceneGraph, effectiveExpandedIds, isFiltering, filterResult]);

  // Rename editing state (declared before handleKeyDown so F2 can reference it)
  const [editingEntityId, setEditingEntityId] = useState<string | null>(null);

  // Context menu state (declared before handleKeyDown so Shift+F10 can reference setContextMenu)
  const [contextMenu, setContextMenu] = useState<{
    isOpen: boolean;
    entityId: string | null;
    entityName: string | null;
    position: { x: number; y: number };
  }>({
    isOpen: false,
    entityId: null,
    entityName: null,
    position: { x: 0, y: 0 },
  });

  const toggleExpanded = useCallback((entityId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(entityId)) {
        next.delete(entityId);
      } else {
        next.add(entityId);
      }
      return next;
    });
  }, []);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (flatNodeIds.length === 0) return;

    const currentIndex = focusedEntityId ? (indexMap.get(focusedEntityId) ?? -1) : -1;

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        const nextIndex = currentIndex < flatNodeIds.length - 1 ? currentIndex + 1 : 0;
        setFocusedEntityId(flatNodeIds[nextIndex]);
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        const prevIndex = currentIndex > 0 ? currentIndex - 1 : flatNodeIds.length - 1;
        setFocusedEntityId(flatNodeIds[prevIndex]);
        break;
      }
      case 'ArrowRight': {
        e.preventDefault();
        if (focusedEntityId) {
          const node = sceneGraph.nodes[focusedEntityId];
          if (node?.children.length) {
            // If collapsed, expand. If already expanded, move to first child
            if (!effectiveExpandedIds.has(focusedEntityId)) {
              toggleExpanded(focusedEntityId);
            } else if (node.children.length > 0) {
              setFocusedEntityId(node.children[0]);
            }
          }
        }
        break;
      }
      case 'ArrowLeft': {
        e.preventDefault();
        if (focusedEntityId) {
          const node = sceneGraph.nodes[focusedEntityId];
          if (node?.children.length && effectiveExpandedIds.has(focusedEntityId)) {
            // Collapse if expanded
            toggleExpanded(focusedEntityId);
          } else if (node?.parentId) {
            // Move to parent
            setFocusedEntityId(node.parentId);
          }
        }
        break;
      }
      case 'Enter': {
        e.preventDefault();
        if (focusedEntityId) {
          selectEntity(focusedEntityId, e.ctrlKey || e.metaKey ? 'toggle' : 'replace');
        }
        break;
      }
      case 'Delete': {
        e.preventDefault();
        if (focusedEntityId && selectedIds.has(focusedEntityId)) {
          deleteSelectedEntities();
        }
        break;
      }
      case 'F2': {
        e.preventDefault();
        if (focusedEntityId) {
          setEditingEntityId(focusedEntityId);
        }
        break;
      }
      case 'F10': {
        // Shift+F10: open context menu for focused entity (keyboard right-click)
        if (e.shiftKey && focusedEntityId) {
          e.preventDefault();
          const node = sceneGraph.nodes[focusedEntityId];
          if (node) {
            // Position at the panel's center-ish area
            const panel = containerRef.current;
            const rect = panel?.getBoundingClientRect();
            setContextMenu({
              isOpen: true,
              entityId: focusedEntityId,
              entityName: node.name,
              position: {
                x: (rect?.left ?? 100) + 60,
                y: (rect?.top ?? 100) + 40,
              },
            });
          }
        }
        break;
      }
      default:
        return; // Don't prevent default for unhandled keys
    }
  }, [flatNodeIds, indexMap, focusedEntityId, sceneGraph, effectiveExpandedIds, toggleExpanded, selectEntity, selectedIds, deleteSelectedEntities, setEditingEntityId]);

  // Drag state
  const [dragState, setDragState] = useState<{
    isDragging: boolean;
    draggedEntityId: string | null;
    draggedEntityName: string | null;
    invalidTargetIds: Set<string>;
  }>({
    isDragging: false,
    draggedEntityId: null,
    draggedEntityName: null,
    invalidTargetIds: new Set(),
  });

  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

  // Close context menu callback
  const closeContextMenu = useCallback(() => {
    setContextMenu((prev) => ({ ...prev, isOpen: false }));
  }, []);

  // Click on empty space clears selection
  const handleBackgroundClick = useCallback(
    (e: MouseEvent) => {
      // Only clear if clicking directly on the background, not on a node
      if (e.target === e.currentTarget) {
        clearSelection();
        closeContextMenu();
      }
    },
    [clearSelection, closeContextMenu]
  );

  // Close context menu when right-clicking on background
  const handleBackgroundContextMenu = useCallback(
    (e: MouseEvent) => {
      if (e.target === e.currentTarget) {
        e.preventDefault();
        closeContextMenu();
      }
    },
    [closeContextMenu]
  );

  const handleContextMenu = useCallback(
    (data: { entityId: string; entityName: string; position: { x: number; y: number } }) => {
      setContextMenu({
        isOpen: true,
        entityId: data.entityId,
        entityName: data.entityName,
        position: data.position,
      });
    },
    []
  );

  // Context menu actions
  const handleRename = useCallback(() => {
    if (contextMenu.entityId) {
      // Close context menu and enable inline editing
      setEditingEntityId(contextMenu.entityId);
    }
  }, [contextMenu.entityId]);

  const handleFocus = useCallback(() => {
    if (contextMenu.entityId) {
      // Route through the store dispatcher so the command is tracked and goes
      // through the same path as all other engine operations (undo/event/analytics).
      const dispatch = getCommandDispatcher();
      if (dispatch) {
        dispatch('focus_camera', { entityId: contextMenu.entityId });
      }
    }
  }, [contextMenu.entityId]);

  const handleDuplicate = useCallback(() => {
    if (contextMenu.entityId) {
      // If entity is already in multi-selection, duplicate from current selection
      // Otherwise, select just this entity first
      if (!selectedIds.has(contextMenu.entityId)) {
        selectEntity(contextMenu.entityId, 'replace');
      }
      duplicateSelectedEntity();
    }
  }, [contextMenu.entityId, selectedIds, selectEntity, duplicateSelectedEntity]);

  const handleDelete = useCallback(() => {
    if (contextMenu.entityId) {
      // If entity is already in multi-selection, delete all selected
      // Otherwise, select just this entity first
      if (!selectedIds.has(contextMenu.entityId)) {
        selectEntity(contextMenu.entityId, 'replace');
      }
      deleteSelectedEntities();
    }
  }, [contextMenu.entityId, selectedIds, selectEntity, deleteSelectedEntities]);

  // Drag handlers
  const handleDragStart = useCallback((entityId: string, entityName: string) => {
    const invalidIds = computeInvalidTargets(entityId, sceneGraph);
    setDragState({
      isDragging: true,
      draggedEntityId: entityId,
      draggedEntityName: entityName,
      invalidTargetIds: invalidIds,
    });
  }, [sceneGraph]);

  const handleDragEnd = useCallback(() => {
    setDragState({
      isDragging: false,
      draggedEntityId: null,
      draggedEntityName: null,
      invalidTargetIds: new Set(),
    });
    setDropTarget(null);
  }, []);

  const handleDragOver = useCallback((
    entityId: string,
    zone: DropZone,
    depth: number
  ) => {
    setDropTarget({ entityId, zone, depth });
  }, []);

  const handleDrop = useCallback((targetEntityId: string) => {
    if (!dragState.draggedEntityId) return;
    if (dragState.invalidTargetIds.has(targetEntityId)) return;

    const zone = dropTarget?.zone ?? 'on';

    // Calculate new parent and insert index based on zone
    let newParentId: string | null;
    let insertIndex: number | undefined;

    if (zone === 'on') {
      // Drop ON: target becomes parent
      newParentId = targetEntityId;
      insertIndex = undefined; // Add at end
    } else {
      // Drop BEFORE/AFTER: target's parent becomes parent
      const targetNode = sceneGraph.nodes[targetEntityId];
      newParentId = targetNode?.parentId ?? null;

      // Calculate insert index using a Map for O(1) lookup instead of O(N) indexOf.
      const siblings = newParentId
        ? sceneGraph.nodes[newParentId]?.children ?? []
        : sceneGraph.rootIds;
      const siblingIndexMap = new Map(siblings.map((id, i) => [id, i]));
      const targetIndex = siblingIndexMap.get(targetEntityId) ?? -1;
      insertIndex = zone === 'before' ? targetIndex : targetIndex + 1;
    }

    // Send command to Rust
    reparentEntity(dragState.draggedEntityId, newParentId, insertIndex);

    // Reset drag state
    handleDragEnd();
  }, [dragState, dropTarget, sceneGraph, reparentEntity, handleDragEnd]);

  // Handle drop on empty root area
  const handleRootDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();

    if (!dragState.draggedEntityId) return;

    // Reparent to root (null parent)
    reparentEntity(dragState.draggedEntityId, null, undefined);
    handleDragEnd();
  }, [dragState.draggedEntityId, reparentEntity, handleDragEnd]);

  const handleRootDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (dragState.isDragging) {
      setDropTarget({ entityId: null, zone: 'root', depth: 0 });
    }
  }, [dragState.isDragging]);

  return (
    <div ref={containerRef} className="flex flex-col h-full relative">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--sf-border)]">
        <Layers className="w-4 h-4 text-neutral-400" />
        <span className="text-sm font-medium text-neutral-300">Scene Hierarchy</span>
        {selectedIds.size > 0 && (
          <span className="text-xs text-neutral-500 ml-auto">
            {selectedIds.size} selected
          </span>
        )}
      </div>

      {/* Search input */}
      <HierarchySearch matchCount={isFiltering ? filterResult.matchCount : undefined} />

      {/* Tree view */}
      <div
        className="flex-1 overflow-y-auto py-1 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/50"
        data-editor-region="hierarchy"
        tabIndex={0}
        role="tree"
        aria-label="Scene hierarchy"
        onClick={handleBackgroundClick}
        onContextMenu={handleBackgroundContextMenu}
        onKeyDown={handleKeyDown}
        onDragOver={handleRootDragOver}
        onDrop={handleRootDrop}
      >
        {hasEntities ? (
          filterResult.filteredRootIds.map((rootId) => {
            const node = sceneGraph.nodes[rootId];
            if (!node) return null;
            return (
              <SceneNode
                key={rootId}
                node={node}
                depth={0}
                onContextMenu={handleContextMenu}
                isEditing={editingEntityId === rootId}
                onEditComplete={(newName) => {
                  if (newName && editingEntityId) {
                    renameEntity(editingEntityId, newName);
                  }
                  setEditingEntityId(null);
                }}
                isDragging={dragState.isDragging}
                draggedEntityId={dragState.draggedEntityId}
                invalidTargetIds={dragState.invalidTargetIds}
                dropTarget={dropTarget?.entityId === rootId ? dropTarget : null}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                filterTerm={isFiltering ? hierarchyFilter : undefined}
                matchingIds={isFiltering ? filterResult.matchingIds : undefined}
                visibleIds={isFiltering ? filterResult.visibleIds : undefined}
                focusedEntityId={focusedEntityId}
                onToggleExpand={toggleExpanded}
                expandedIds={effectiveExpandedIds}
              />
            );
          })
        ) : isFiltering ? (
          <div className="flex flex-col items-center justify-center h-32 text-neutral-500 text-sm">
            <span>No matching entities</span>
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center p-4">
            <EmptyState
              icon={PackagePlus}
              title="No entities yet"
              description="Add entities using the toolbar above, or ask AI to build a scene for you"
            />
          </div>
        )}

        {/* Root drop zone indicator */}
        {dragState.isDragging && dropTarget?.zone === 'root' && (
          <div className="h-0.5 bg-blue-500 rounded-full mx-2 mt-2" />
        )}
      </div>

      {/* Context Menu */}
      {contextMenu.isOpen && contextMenu.entityId && contextMenu.entityName && (
        <ContextMenu
          isOpen={contextMenu.isOpen}
          position={contextMenu.position}
          onClose={closeContextMenu}
          onRename={handleRename}
          onFocus={handleFocus}
          onDuplicate={handleDuplicate}
          onDelete={handleDelete}
          selectionCount={contextMenu.entityId && selectedIds.has(contextMenu.entityId) ? selectedIds.size : 1}
        />
      )}
    </div>
  );
});
