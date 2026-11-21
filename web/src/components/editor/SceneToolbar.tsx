'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { useEditorStore } from '@/stores/editorStore';
import { downloadSceneFile, openSceneFilePicker } from '@/lib/sceneFile';
import { saveSceneToCloud } from '@/lib/projects/cloudSave';
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

export function SceneToolbar() {
  const sceneName = useEditorStore((s) => s.sceneName);
  const sceneModified = useEditorStore((s) => s.sceneModified);
  const saveScene = useEditorStore((s) => s.saveScene);
  const loadScene = useEditorStore((s) => s.loadScene);
  const newScene = useEditorStore((s) => s.newScene);
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
        void saveSceneToCloud(projectId, name, json).then((result) => {
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
    const requestId = newSceneExportRequestId();
    pendingDownloadRef.current = requestId;
    saveScene(requestId);
  }, [saveScene]);

  /**
   * Trigger a cloud save. Records the request id so the matching
   * forge:scene-exported event completes the PUT to /api/projects/{id} (PF-540).
   */
  const handleCloudSave = useCallback(() => {
    if (!projectId) return;
    const requestId = newSceneExportRequestId();
    pendingCloudSaveRef.current = requestId;
    saveToCloud(requestId);
  }, [projectId, saveToCloud]);

  const handleLoad = useCallback(async () => {
    const json = await openSceneFilePicker();
    if (json) {
      loadScene(json);
    }
  }, [loadScene]);

  const handleNew = useCallback(async () => {
    if (sceneModified) {
      if (!await confirm('Discard unsaved changes and create a new scene?')) return;
    }
    newScene();
  }, [newScene, sceneModified, confirm]);

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
        newScene();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleSave, newScene, projectId, handleCloudSave]);

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
      >
        <Download size={13} />
      </button>
    </div>
    <ConfirmDialogPortal />
    </>
  );
}
