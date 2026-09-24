'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { useEditorStore } from '@/stores/editorStore';
import { downloadSceneFile, openSceneFilePicker } from '@/lib/sceneFile';
import { saveSceneToCloud } from '@/lib/projects/cloudSave';
import { useMusicArrangementStore } from '@/lib/music/arrangementStore';
import { loadPrefabInstances, stagePrefabInstancesForExport } from '@/lib/prefabs/prefabStore';
import { showError } from '@/lib/toast';
import { Save, FolderOpen, FilePlus, Download, Cloud, CloudOff, Loader2, Undo2, Redo2, Layers } from 'lucide-react';
import { ExportDialog } from './ExportDialog';
import { SceneBrowser } from './SceneBrowser';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import {
  SCENE_EXPORTED_EVENT,
  isSceneExportResponseFor,
  newSceneExportRequestId,
  type SceneExportedDetail,
} from '@/lib/engine/sceneExportWire';

// The prefab-instance registry (and its transitive definitions) is folded into
// `e.detail.json` upstream, at the single `SCENE_EXPORTED` choke point in
// `transformEvents.ts` — every consumer of that event, this toolbar's
// download/cloud-save included, now receives already-folded JSON. Folding was
// previously duplicated here, reading the LIVE registry at answer-time, which
// raced a concurrent scene load (scene.FR-1 N1 BUG-3): `handleSave` /
// `handleCloudSave` below stage the registry as it stood at REQUEST time
// instead, so the upstream fold reflects what was active when the save was
// asked for rather than whatever is active when the answer happens to land.

export function SceneToolbar() {
  const sceneName = useEditorStore((s) => s.sceneName);
  const sceneModified = useEditorStore((s) => s.sceneModified);
  const saveScene = useEditorStore((s) => s.saveScene);
  const loadScene = useEditorStore((s) => s.loadScene);
  const newScene = useEditorStore((s) => s.newScene);
  const isEngineAttached = useEditorStore((s) => s.isEngineAttached);
  const setSceneName = useEditorStore((s) => s.setSceneName);
  const engineMode = useEditorStore((s) => s.engineMode);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const canUndo = useEditorStore((s) => s.canUndo);
  const canRedo = useEditorStore((s) => s.canRedo);
  const undoDescription = useEditorStore((s) => s.undoDescription);
  const redoDescription = useEditorStore((s) => s.redoDescription);
  const projectId = useEditorStore((s) => s.projectId);
  const cloudSaveStatus = useEditorStore((s) => s.cloudSaveStatus);
  const saveToCloud = useEditorStore((s) => s.saveToCloud);
  const setCloudSaveStatus = useEditorStore((s) => s.setCloudSaveStatus);
  const setLastCloudSave = useEditorStore((s) => s.setLastCloudSave);
  // Set while the engine is holding a scene it REJECTED rather than this
  // project's. `saveScene`/`saveToCloud` already refuse in that state, but a
  // silent refusal from a button press reads as a broken button — this is what
  // turns the store's data guard into an answer for the user (#10056).
  const sceneLoadError = useEditorStore((s) => s.sceneLoadError);

  const { confirm, ConfirmDialogPortal } = useConfirmDialog();
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(sceneName);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [showSceneBrowser, setShowSceneBrowser] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Correlation ids for the two exports this toolbar can be waiting on, or null
  // when it is waiting on neither. These replace the plain pending-flags that
  // used to consume whichever export landed first, whoever triggered it
  // (PF-1103); holding the id is what makes "is this mine?" answerable.
  const pendingDownloadRef = useRef<string | null>(null);
  // Set when a cloud save is requested so the matching forge:scene-exported
  // event handler performs the PUT to /api/projects/{id} (PF-540).
  const pendingCloudSaveRef = useRef<string | null>(null);

  // Listen for SCENE_EXPORTED to trigger file download or cloud save
  useEffect(() => {
    const handleExported = (e: CustomEvent<SceneExportedDetail>) => {
      const downloadId = pendingDownloadRef.current;
      if (downloadId !== null && isSceneExportResponseFor(downloadId, e.detail)) {
        pendingDownloadRef.current = null;
        downloadSceneFile(e.detail.json, e.detail.name);
      }

      const cloudSaveId = pendingCloudSaveRef.current;
      if (cloudSaveId !== null && isSceneExportResponseFor(cloudSaveId, e.detail) && projectId) {
        pendingCloudSaveRef.current = null;
        const { json, name } = e.detail;
        // Persist the music arrangement alongside the scene (#9854) so it
        // survives save → reopen through the same project payload.
        const arrangement = useMusicArrangementStore.getState().serialize();
        void saveSceneToCloud(projectId, name, json, arrangement).then((result) => {
          if (result.ok && result.savedAt) {
            setCloudSaveStatus('saved');
            setLastCloudSave(result.savedAt);
          } else {
            setCloudSaveStatus('error');
          }
        });
      }
    };
    window.addEventListener(SCENE_EXPORTED_EVENT, handleExported as EventListener);
    return () => window.removeEventListener(SCENE_EXPORTED_EVENT, handleExported as EventListener);
  }, [projectId, setCloudSaveStatus, setLastCloudSave]);

  const handleSave = useCallback(() => {
    if (sceneLoadError) {
      showError(`${sceneLoadError.reason} Saving is disabled until a scene loads successfully.`);
      return;
    }
    const requestId = newSceneExportRequestId();
    pendingDownloadRef.current = requestId;
    // Stage the registry as it stands RIGHT NOW, before the async round trip —
    // not whatever it holds when the answer lands (scene.FR-1 N1 BUG-3).
    stagePrefabInstancesForExport(requestId, loadPrefabInstances());
    saveScene(requestId);
  }, [saveScene, sceneLoadError]);

  /**
   * Trigger a cloud save. Records the request id so the matching
   * forge:scene-exported event completes the PUT to /api/projects/{id} (PF-540).
   */
  const handleCloudSave = useCallback(() => {
    if (!projectId) return;
    if (sceneLoadError) {
      // Same refusal as `handleSave`, and the consequential one: without it the
      // pending-ref would be armed for an export the store never dispatches, so
      // the cloud-save indicator would sit on 'saving' forever (#10056).
      showError(`${sceneLoadError.reason} Your saved project was left untouched.`);
      return;
    }
    const requestId = newSceneExportRequestId();
    pendingCloudSaveRef.current = requestId;
    // Same request-time staging as `handleSave` — see its comment.
    stagePrefabInstancesForExport(requestId, loadPrefabInstances());
    saveToCloud(requestId);
  }, [projectId, saveToCloud, sceneLoadError]);

  const handleLoad = useCallback(async () => {
    const json = await openSceneFilePicker();
    // The scene currently on screen stays on screen if the import is rejected,
    // so this must not strand the editor: the toast below is the whole report
    // and saving of the current scene stays enabled (#10056).
    if (json && loadScene(json, { rejectionStrandsEditor: false }) === false) {
      // Parity with the AI/MCP `load_scene` handler, which surfaces the same
      // rejection: without this the scene silently vanishes into a no-op when
      // its embedded prefab graph is rejected or the engine is not ready.
      showError('The scene was not loaded. Check its prefab metadata and that the engine is ready, then try again.');
    }
  }, [loadScene]);

  /**
   * Report a `newScene()` that returned false, naming the RIGHT cause.
   *
   * The boolean is false for two unrelated facts, and this button is reachable
   * during the window that produces the second: the toolbar renders as soon as
   * the editor page does, while the dispatcher is only attached once the WASM
   * engine has finished loading. Calling that "the engine did not accept a new
   * scene" tells the user their engine refused them when it had simply not
   * arrived yet — and the two want different reactions (retry in a moment vs.
   * something is wrong). `isEngineAttached()` reads the fact the boolean drops.
   */
  const reportNewSceneFailure = useCallback(() => {
    showError(
      isEngineAttached()
        // Parity with the AI/MCP `new_scene` handler.
        ? 'The engine did not accept a new scene. The current scene is unchanged.'
        : 'The engine is not ready yet — try again in a moment. The current scene is unchanged.',
    );
  }, [isEngineAttached]);

  const handleNew = useCallback(async () => {
    if (sceneModified) {
      if (!await confirm('Discard unsaved changes and create a new scene?')) return;
    }
    if (newScene() === false) reportNewSceneFailure();
  }, [newScene, sceneModified, confirm, reportNewSceneFailure]);

  // Ctrl+S shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        // Delegate rather than re-inline the download path: it used to be a copy
        // of handleSave's body, which is one more place the request-id wiring
        // could be forgotten.
        if (projectId) {
          handleCloudSave();
        } else {
          handleSave();
        }
      }
      if (e.ctrlKey && e.shiftKey && e.key === 'N') {
        e.preventDefault();
        if (newScene() === false) reportNewSceneFailure();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleSave, newScene, projectId, handleCloudSave, reportNewSceneFailure]);

  const handleExport = useCallback(() => {
    setShowExportDialog(true);
  }, []);

  const isEdit = engineMode === 'edit';

  return (
    <>
      <ExportDialog isOpen={showExportDialog} onClose={() => setShowExportDialog(false)} />
      <SceneBrowser isOpen={showSceneBrowser} onClose={() => setShowSceneBrowser(false)} />
      <div className="flex items-center gap-1">
      {/* Scene name (click to edit) */}
      {editing ? (
        <input
          ref={inputRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={() => {
            if (editValue.trim()) setSceneName(editValue.trim());
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              if (editValue.trim()) setSceneName(editValue.trim());
              setEditing(false);
            }
            if (e.key === 'Escape') setEditing(false);
          }}
          className="w-28 rounded border border-[var(--sf-border)] bg-[var(--sf-bg-surface)] px-1 py-0.5 text-xs text-zinc-200 outline-none focus:border-blue-500"
          autoFocus
        />
      ) : (
        <button
          onClick={() => {
            setEditValue(sceneName);
            setEditing(true);
          }}
          className="max-w-[160px] truncate rounded px-1 py-0.5 text-xs text-zinc-400 hover:bg-[var(--sf-bg-elevated)] hover:text-zinc-200"
          title="Click to rename scene"
        >
          {sceneName}
          {sceneModified && <span className="ml-0.5 text-yellow-500">*</span>}
        </button>
      )}

      {/* Undo button */}
      <button
        onClick={undo}
        disabled={!isEdit || !canUndo}
        className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:bg-[var(--sf-bg-elevated)] hover:text-zinc-200 disabled:opacity-30"
        title={canUndo && undoDescription ? `Undo: ${undoDescription} (Ctrl+Z)` : 'Undo (Ctrl+Z)'}
        aria-label={canUndo && undoDescription ? `Undo: ${undoDescription}` : 'Undo'}
      >
        <Undo2 size={13} />
      </button>

      {/* Redo button */}
      <button
        onClick={redo}
        disabled={!isEdit || !canRedo}
        className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:bg-[var(--sf-bg-elevated)] hover:text-zinc-200 disabled:opacity-30"
        title={canRedo && redoDescription ? `Redo: ${redoDescription} (Ctrl+Shift+Z)` : 'Redo (Ctrl+Shift+Z)'}
        aria-label={canRedo && redoDescription ? `Redo: ${redoDescription}` : 'Redo'}
      >
        <Redo2 size={13} />
      </button>

      <div className="mx-0.5 h-4 w-px bg-[var(--sf-border)]" />

      {/* Save button */}
      <button
        onClick={handleSave}
        disabled={!isEdit}
        className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:bg-[var(--sf-bg-elevated)] hover:text-zinc-200 disabled:opacity-30"
        title="Save (Ctrl+S)"
        aria-label="Save"
      >
        <Save size={13} />
      </button>

      {/* Cloud save indicator — accessible with live region for screen readers */}
      {projectId && (
        <div
          role="status"
          aria-live="polite"
          tabIndex={0}
          className="flex h-6 w-6 items-center justify-center rounded focus:outline-none focus:ring-1 focus:ring-amber-500"
          title={
            cloudSaveStatus === 'saved' ? 'Saved to cloud' :
            cloudSaveStatus === 'saving' ? 'Saving to cloud...' :
            cloudSaveStatus === 'error' ? 'Cloud save error' :
            'Not saved'
          }
        >
          {cloudSaveStatus === 'saved' && <Cloud size={13} className="text-green-500" aria-hidden="true" />}
          {cloudSaveStatus === 'saving' && <Loader2 size={13} className="animate-spin text-blue-500" aria-hidden="true" />}
          {cloudSaveStatus === 'error' && <CloudOff size={13} className="text-red-500" aria-hidden="true" />}
          {/* Visually hidden text for aria-live announcement — DOM text content
              is required for screen readers to detect changes in live regions. */}
          <span className="sr-only">
            {cloudSaveStatus === 'saved' ? 'Saved to cloud' :
             cloudSaveStatus === 'saving' ? 'Saving to cloud...' :
             cloudSaveStatus === 'error' ? 'Cloud save error' :
             'Not saved'}
          </span>
        </div>
      )}

      {/* Load button */}
      <button
        onClick={handleLoad}
        disabled={!isEdit}
        className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:bg-[var(--sf-bg-elevated)] hover:text-zinc-200 disabled:opacity-30"
        title="Load Scene"
        aria-label="Load scene"
      >
        <FolderOpen size={13} />
      </button>

      {/* New Scene button */}
      <button
        onClick={handleNew}
        disabled={!isEdit}
        className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:bg-[var(--sf-bg-elevated)] hover:text-zinc-200 disabled:opacity-30"
        title="New Scene (Ctrl+Shift+N)"
        aria-label="New scene"
      >
        <FilePlus size={13} />
      </button>

      {/* Scenes browser button */}
      <button
        onClick={() => setShowSceneBrowser(true)}
        className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:bg-[var(--sf-bg-elevated)] hover:text-zinc-200"
        title="Browse Scenes"
        aria-label="Browse scenes"
      >
        <Layers size={13} />
      </button>

      {/* Export button */}
      <button
        onClick={handleExport}
        disabled={!isEdit}
        className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:bg-[var(--sf-bg-elevated)] hover:text-zinc-200 disabled:opacity-30"
        title="Export Game"
        aria-label="Export game"
        data-testid="scene-toolbar-export"
      >
        <Download size={13} />
      </button>
    </div>
    <ConfirmDialogPortal />
    </>
  );
}
