/**
 * Scene Hierarchy Panel component.
 *
 * Displays a tree view of all entities in the Bevy scene.
 * Supports selection, multi-select, visibility toggle, and context menu.
 */

'use client';

import { useState, useCallback, useRef, useMemo, memo, type MouseEvent } from 'react';
import { Layers } from 'lucide-react';
import { useEditorStore } from '@/stores/editorStore';
import { getWasmModule } from '@/hooks/useEngine';
import { SceneNode } from './SceneNode';
import { ContextMenu } from './ContextMenu';
import { HierarchySearch } from './HierarchySearch';
import { computeInvalidTargets, type DropTarget, type DropZone } from '@/lib/dndUtils';
import { filterHierarchy } from '@/lib/hierarchyFilter';

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

  // Context menu state
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

  // Rename editing state
  const [editingEntityId, setEditingEntityId] = useState<string | null>(null);

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
      // Send focus_camera command to Rust
      const wasmModule = getWasmModule();
      if (wasmModule) {
        wasmModule.handle_command('focus_camera', { entityId: contextMenu.entityId });
      }
    }
  }, [contextMenu.entityId]);

  const handleDuplicate = useCallback(() => {
    if (contextMenu.entityId) {
      // Ensure entity is selected, then duplicate
      selectEntity(contextMenu.entityId, 'replace');
      duplicateSelectedEntity();
    }
  }, [contextMenu.entityId, selectEntity, duplicateSelectedEntity]);

  const handleDelete = useCallback(() => {
    if (contextMenu.entityId) {
      // Ensure entity is selected, then delete
      selectEntity(contextMenu.entityId, 'replace');
      deleteSelectedEntities();
    }
  }, [contextMenu.entityId, selectEntity, deleteSelectedEntities]);

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

      // Calculate insert index
      const siblings = newParentId
        ? sceneGraph.nodes[newParentId]?.children ?? []
        : sceneGraph.rootIds;
      const targetIndex = siblings.indexOf(targetEntityId);
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
      <div className="flex items-center gap-2 px-3 py-2 border-b border-neutral-700">
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
        className="flex-1 overflow-y-auto py-1"
        onClick={handleBackgroundClick}
        onContextMenu={handleBackgroundContextMenu}
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
              />
            );
          })
        ) : isFiltering ? (
          <div className="flex flex-col items-center justify-center h-32 text-neutral-500 text-sm">
            <span>No matching entities</span>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-neutral-500 text-sm">
            <Layers className="w-8 h-8 mb-2 opacity-50" />
            <span>No entities in scene</span>
            <span className="text-xs mt-1">Waiting for engine...</span>
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
        />
      )}
    </div>
  );
});
