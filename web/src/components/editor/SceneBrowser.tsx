'use client';

import { useCallback, useState } from 'react';
import { Button } from '@spawnforge/ui';
import { useEditorStore } from '@/stores/editorStore';
import { X, Plus, Trash2, Copy, CheckCircle2, Save, RotateCcw } from 'lucide-react';
import type { SceneCheckpoint } from '@/lib/scenes/sceneManager';

interface SceneBrowserProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SceneBrowser({ isOpen, onClose }: SceneBrowserProps) {
  const scenes = useEditorStore((s) => s.scenes);
  const projectId = useEditorStore((s) => s.projectId);
  const checkpointBusy = useEditorStore((s) => s.checkpointBusy);
  const checkpointError = useEditorStore((s) => s.checkpointError);
  const activeSceneId = useEditorStore((s) => s.activeSceneId);
  const sceneGraph = useEditorStore((s) => s.sceneGraph);
  const switchScene = useEditorStore((s) => s.switchScene);
  const createNewScene = useEditorStore((s) => s.createNewScene);
  const deleteScene = useEditorStore((s) => s.deleteScene);
  const duplicateScene = useEditorStore((s) => s.duplicateScene);
  const createCheckpoint = useEditorStore((s) => s.createCheckpoint);
  const listCheckpoints = useEditorStore((s) => s.listCheckpoints);
  const restoreCheckpoint = useEditorStore((s) => s.restoreCheckpoint);
  const deleteCheckpoint = useEditorStore((s) => s.deleteCheckpoint);

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  // Switching and duplicating now read the live scene back out of the engine
  // first, so both are async. A second click while one is in flight would
  // capture a scene that is already halfway through being replaced.
  const [localBusy, setBusy] = useState(false);
  const busy = localBusy || checkpointBusy;
  const [actionError, setActionError] = useState<string | null>(null);
  const [checkpoints, setCheckpoints] = useState<SceneCheckpoint[]>([]);
  const [restoreConfirmId, setRestoreConfirmId] = useState<string | null>(null);
  // Deleting a checkpoint permanently destroys a declared recovery point with
  // no undo, so it gets the same Yes/No gate as scene delete and checkpoint
  // restore — a misclick must not throw the safety net away.
  const [deleteCheckpointConfirmId, setDeleteCheckpointConfirmId] = useState<string | null>(null);
  // Re-read the checkpoint list from storage exactly when the browser opens,
  // using React's "adjust state while rendering" pattern rather than an effect
  // (which would trigger a cascading render). `wasOpen` records the previous
  // `isOpen` so the read fires only on the closed→open transition.
  const [wasOpen, setWasOpen] = useState(false);
  const [previousProjectId, setPreviousProjectId] = useState(projectId);

  const refreshCheckpoints = useCallback(() => {
    setCheckpoints(listCheckpoints());
  }, [listCheckpoints]);

  if (isOpen !== wasOpen || previousProjectId !== projectId) {
    setWasOpen(isOpen);
    setPreviousProjectId(projectId);
    setRestoreConfirmId(null);
    setDeleteCheckpointConfirmId(null);
    setActionError(null);
    if (isOpen) setCheckpoints(listCheckpoints());
  }

  const handleCreateCheckpoint = useCallback(() => {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    void createCheckpoint()
      .then((checkpoint) => {
        if (!checkpoint) setActionError('The checkpoint was not saved. Wait for the engine to finish loading, then try again.');
        refreshCheckpoints();
      })
      .catch(() => setActionError('The checkpoint could not be saved. Try again.'))
      .finally(() => setBusy(false));
  }, [busy, createCheckpoint, refreshCheckpoints]);

  const handleRestoreCheckpoint = useCallback(
    (checkpointId: string) => {
      if (busy) return;
      setBusy(true);
      setActionError(null);
      void restoreCheckpoint(checkpointId)
        .then((restored) => {
          if (!restored) setActionError('The checkpoint was not restored. The previous save is intact; review the error before editing.');
          setRestoreConfirmId(null);
          refreshCheckpoints();
        })
        .catch(() => setActionError('The checkpoint could not be restored. Reload the project before editing.'))
        .finally(() => setBusy(false));
    },
    [busy, restoreCheckpoint, refreshCheckpoints]
  );

  const handleDeleteCheckpoint = useCallback(
    (checkpointId: string) => {
      if (busy) return;
      setActionError(null);
      const remaining = deleteCheckpoint(checkpointId);
      if (remaining.some((checkpoint) => checkpoint.id === checkpointId)) {
        setActionError('The checkpoint was not deleted. Try again after any recovery operation finishes.');
      }
      setDeleteCheckpointConfirmId(null);
      refreshCheckpoints();
    },
    [busy, deleteCheckpoint, refreshCheckpoints]
  );

  const entityCount = Object.keys(sceneGraph.nodes).length;

  const handleSwitch = useCallback(
    (sceneId: string) => {
      if (busy || sceneId === activeSceneId) return;
      setBusy(true);
      void switchScene(sceneId).finally(() => setBusy(false));
    },
    [activeSceneId, busy, switchScene]
  );

  const handleAdd = useCallback(() => {
    if (!busy) createNewScene();
  }, [busy, createNewScene]);

  const handleDuplicate = useCallback(
    (sceneId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (busy) return;
      setBusy(true);
      void duplicateScene(sceneId).finally(() => setBusy(false));
    },
    [busy, duplicateScene]
  );

  const handleDeleteRequest = useCallback((sceneId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteConfirmId(sceneId);
  }, []);

  const handleDeleteConfirm = useCallback(
    (sceneId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (busy) return;
      deleteScene(sceneId);
      setDeleteConfirmId(null);
    },
    [busy, deleteScene]
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

        {(checkpointError || actionError) && (
          <p role="alert" className="mx-4 mt-3 rounded border border-[var(--sf-destructive)] bg-[var(--sf-bg-surface)] p-2 text-xs text-[var(--sf-text)]">
            {checkpointError || actionError}
          </p>
        )}
        {busy && <p role="status" className="px-4 pt-2 text-xs text-[var(--sf-text-secondary)]">Waiting for the scene operation to finish…</p>}

        {/* Scene list */}
        <div
          role="listbox"
          aria-label="Scenes"
          className="flex max-h-80 flex-col gap-1 overflow-y-auto p-2"
        >
          {scenes.length === 0 && (
            <p className="py-6 text-center text-xs text-zinc-400">No scenes yet. Create one below.</p>
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
                    <span className="ml-2 text-xs text-zinc-400">{count} {count === 1 ? 'entity' : 'entities'}</span>
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
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity [.scene-row:hover_&]:opacity-100">
                    <button
                      onClick={(e) => handleDuplicate(scene.id, e)}
                      className="flex h-5 w-5 items-center justify-center rounded text-zinc-400 hover:bg-zinc-700 hover:text-zinc-300"
                      aria-label={`Duplicate ${scene.name}`}
                      title="Duplicate scene"
                    >
                      <Copy size={11} />
                    </button>
                    <button
                      onClick={(e) => handleDeleteRequest(scene.id, e)}
                      className="flex h-5 w-5 items-center justify-center rounded text-zinc-400 hover:bg-zinc-700 hover:text-red-400"
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

        {/* Checkpoints */}
        <div className="border-t border-[var(--sf-border)] px-4 py-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold text-[var(--sf-text)]">Recovery checkpoints</h3>
            <Button size="sm" variant="outline"
              onClick={handleCreateCheckpoint}
              disabled={busy}
              aria-label="Save checkpoint"
              title="Save a recovery point for this project in this browser"
            >
              <Save size={14} aria-hidden="true" />
              Save checkpoint
            </Button>
          </div>
          {checkpoints.length === 0 ? (
            <p className="py-2 text-center text-xs text-[var(--sf-text-secondary)]">
              No checkpoints yet. Save one before a risky change.
            </p>
          ) : (
            <ul role="list" aria-label="Checkpoints" className="flex max-h-64 flex-col gap-2 overflow-y-auto">
              {checkpoints.map((cp) => {
                const isRestoreConfirming = restoreConfirmId === cp.id;
                const isDeleteConfirming = deleteCheckpointConfirmId === cp.id;
                return (
                  <li key={cp.id} className="rounded bg-[var(--sf-bg-surface)] p-2 text-xs text-[var(--sf-text)]">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate" title={cp.label}>{cp.label}</span>
                      {!isRestoreConfirming && !isDeleteConfirming && (
                        <span className="flex items-center gap-1">
                          <Button size="sm" variant="ghost" className="min-w-8 px-2" disabled={busy}
                            onClick={() => {
                              setDeleteCheckpointConfirmId(null);
                              setRestoreConfirmId(cp.id);
                            }}
                            aria-label={`Restore ${cp.label}`}
                            title="Restore this checkpoint"
                          ><RotateCcw size={14} aria-hidden="true" /></Button>
                          <Button size="sm" variant="ghost" className="min-w-8 px-2" disabled={busy}
                            onClick={() => {
                              setRestoreConfirmId(null);
                              setDeleteCheckpointConfirmId(cp.id);
                            }}
                            aria-label={`Delete checkpoint ${cp.label}`}
                            title="Delete checkpoint"
                          ><Trash2 size={14} aria-hidden="true" /></Button>
                        </span>
                      )}
                    </div>
                    {isRestoreConfirming && (
                      <div className="mt-2 space-y-2">
                        <p id="checkpoint-restore-warning">
                          Restoring this checkpoint replaces all scenes in the current project and discards newer unsaved work.
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" variant="destructive" disabled={busy}
                            onClick={() => handleRestoreCheckpoint(cp.id)}
                            aria-label={`Confirm restore ${cp.label}`}
                            aria-describedby="checkpoint-restore-warning"
                          >Restore checkpoint</Button>
                          <Button size="sm" variant="outline" disabled={busy}
                            onClick={() => setRestoreConfirmId(null)} aria-label="Cancel restore"
                          >Cancel</Button>
                        </div>
                      </div>
                    )}
                    {isDeleteConfirming && (
                      <div className="mt-2 space-y-2">
                        <p id="checkpoint-delete-warning">Permanently delete this recovery checkpoint? This cannot be undone.</p>
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" variant="destructive" disabled={busy}
                            onClick={() => handleDeleteCheckpoint(cp.id)}
                            aria-label={`Confirm delete checkpoint ${cp.label}`}
                            aria-describedby="checkpoint-delete-warning"
                          >Delete checkpoint</Button>
                          <Button size="sm" variant="outline" disabled={busy}
                            onClick={() => setDeleteCheckpointConfirmId(null)} aria-label="Cancel delete checkpoint"
                          >Cancel</Button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-zinc-700 px-4 py-3">
          <button
            onClick={handleAdd}
            disabled={busy}
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
