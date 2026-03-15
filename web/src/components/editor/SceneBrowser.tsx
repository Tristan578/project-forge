'use client';

import { useCallback, useState } from 'react';
import { useEditorStore } from '@/stores/editorStore';
import { X, Plus, Trash2, Copy, CheckCircle2 } from 'lucide-react';

interface SceneBrowserProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SceneBrowser({ isOpen, onClose }: SceneBrowserProps) {
  const scenes = useEditorStore((s) => s.scenes);
  const activeSceneId = useEditorStore((s) => s.activeSceneId);
  const sceneGraph = useEditorStore((s) => s.sceneGraph);
  const switchScene = useEditorStore((s) => s.switchScene);
  const createNewScene = useEditorStore((s) => s.createNewScene);
  const deleteScene = useEditorStore((s) => s.deleteScene);
  const duplicateScene = useEditorStore((s) => s.duplicateScene);

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const entityCount = Object.keys(sceneGraph.nodes).length;

  const handleSwitch = useCallback(
    (sceneId: string) => {
      if (sceneId !== activeSceneId) {
        switchScene(sceneId);
      }
    },
    [activeSceneId, switchScene]
  );

  const handleAdd = useCallback(() => {
    createNewScene();
  }, [createNewScene]);

  const handleDuplicate = useCallback(
    (sceneId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      duplicateScene(sceneId);
    },
    [duplicateScene]
  );

  const handleDeleteRequest = useCallback((sceneId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteConfirmId(sceneId);
  }, []);

  const handleDeleteConfirm = useCallback(
    (sceneId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      deleteScene(sceneId);
      setDeleteConfirmId(null);
    },
    [deleteScene]
  );

  const handleDeleteCancel = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteConfirmId(null);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, sceneId: string) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleSwitch(sceneId);
      }
    },
    [handleSwitch]
  );

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-label="Scene Browser"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="relative flex w-96 flex-col rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-700 px-4 py-3">
          <h2 className="text-sm font-semibold text-zinc-200">Scenes</h2>
          <button
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
            aria-label="Close scene browser"
          >
            <X size={14} />
          </button>
        </div>

        {/* Scene list */}
        <div
          role="listbox"
          aria-label="Scenes"
          className="flex max-h-80 flex-col gap-1 overflow-y-auto p-2"
        >
          {scenes.length === 0 && (
            <p className="py-6 text-center text-xs text-zinc-500">No scenes yet. Create one below.</p>
          )}
          {scenes.map((scene) => {
            const isActive = scene.id === activeSceneId;
            const count = isActive ? entityCount : 0;
            const isConfirming = deleteConfirmId === scene.id;

            return (
              <div
                key={scene.id}
                role="option"
                aria-selected={isActive}
                tabIndex={0}
                onClick={() => handleSwitch(scene.id)}
                onKeyDown={(e) => handleKeyDown(e, scene.id)}
                className={`group flex cursor-pointer items-center gap-2 rounded px-3 py-2 text-sm transition-colors outline-none focus-visible:ring-1 focus-visible:ring-blue-500 ${
                  isActive
                    ? 'bg-blue-600/20 text-zinc-100'
                    : 'text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100'
                }`}
              >
                {/* Active indicator */}
                <span className={`shrink-0 ${isActive ? 'text-blue-400' : 'text-transparent'}`} aria-hidden="true">
                  <CheckCircle2 size={13} />
                </span>

                {/* Scene name and meta */}
                <div className="min-w-0 flex-1">
                  <span className="truncate font-medium">{scene.name}</span>
                  {scene.isStartScene && (
                    <span className="ml-2 rounded bg-zinc-700 px-1 py-0.5 text-xs text-zinc-400">start</span>
                  )}
                  {isActive && (
                    <span className="ml-2 text-xs text-zinc-500">{count} {count === 1 ? 'entity' : 'entities'}</span>
                  )}
                </div>

                {/* Actions */}
                {isConfirming ? (
                  <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <span className="text-xs text-red-400">Delete?</span>
                    <button
                      onClick={(e) => handleDeleteConfirm(scene.id, e)}
                      className="rounded px-1.5 py-0.5 text-xs text-red-400 hover:bg-red-900/40"
                      aria-label={`Confirm delete ${scene.name}`}
                    >
                      Yes
                    </button>
                    <button
                      onClick={handleDeleteCancel}
                      className="rounded px-1.5 py-0.5 text-xs text-zinc-400 hover:bg-zinc-700"
                      aria-label="Cancel delete"
                    >
                      No
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity [.scene-row:hover_&]:opacity-100">
                    <button
                      onClick={(e) => handleDuplicate(scene.id, e)}
                      className="flex h-5 w-5 items-center justify-center rounded text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300"
                      aria-label={`Duplicate ${scene.name}`}
                      title="Duplicate scene"
                    >
                      <Copy size={11} />
                    </button>
                    <button
                      onClick={(e) => handleDeleteRequest(scene.id, e)}
                      className="flex h-5 w-5 items-center justify-center rounded text-zinc-500 hover:bg-zinc-700 hover:text-red-400"
                      aria-label={`Delete ${scene.name}`}
                      title="Delete scene"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="border-t border-zinc-700 px-4 py-3">
          <button
            onClick={handleAdd}
            className="flex w-full items-center justify-center gap-1.5 rounded bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100"
            aria-label="Add new scene"
          >
            <Plus size={12} />
            Add Scene
          </button>
        </div>
      </div>
    </div>
  );
}
