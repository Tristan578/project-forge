'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { useEditorStore } from '@/stores/editorStore';
import { downloadSceneFile, openSceneFilePicker } from '@/lib/sceneFile';
import { Save, FolderOpen, FilePlus, Download, Cloud, CloudOff, Loader2 } from 'lucide-react';
import { ExportDialog } from './ExportDialog';

export function SceneToolbar() {
  const sceneName = useEditorStore((s) => s.sceneName);
  const sceneModified = useEditorStore((s) => s.sceneModified);
  const saveScene = useEditorStore((s) => s.saveScene);
  const loadScene = useEditorStore((s) => s.loadScene);
  const newScene = useEditorStore((s) => s.newScene);
  const setSceneName = useEditorStore((s) => s.setSceneName);
  const engineMode = useEditorStore((s) => s.engineMode);
  const projectId = useEditorStore((s) => s.projectId);
  const cloudSaveStatus = useEditorStore((s) => s.cloudSaveStatus);
  const saveToCloud = useEditorStore((s) => s.saveToCloud);

  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(sceneName);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingDownloadRef = useRef(false);

  // Listen for SCENE_EXPORTED to trigger file download when save was manual
  useEffect(() => {
    const handleExported = (e: CustomEvent<{ json: string; name: string }>) => {
      if (pendingDownloadRef.current) {
        pendingDownloadRef.current = false;
        downloadSceneFile(e.detail.json, e.detail.name);
      }
    };
    window.addEventListener('forge:scene-exported', handleExported as EventListener);
    return () => window.removeEventListener('forge:scene-exported', handleExported as EventListener);
  }, []);

  const handleSave = useCallback(() => {
    pendingDownloadRef.current = true;
    saveScene();
  }, [saveScene]);

  const handleLoad = useCallback(async () => {
    const json = await openSceneFilePicker();
    if (json) {
      loadScene(json);
    }
  }, [loadScene]);

  const handleNew = useCallback(() => {
    if (sceneModified) {
      if (!confirm('Discard unsaved changes and create a new scene?')) return;
    }
    newScene();
  }, [newScene, sceneModified]);

  // Ctrl+S shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        if (projectId) {
          saveToCloud();
        } else {
          pendingDownloadRef.current = true;
          saveScene();
        }
      }
      if (e.ctrlKey && e.shiftKey && e.key === 'N') {
        e.preventDefault();
        newScene();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [saveScene, newScene, projectId, saveToCloud]);

  const handleExport = useCallback(() => {
    setShowExportDialog(true);
  }, []);

  const isEdit = engineMode === 'edit';

  return (
    <>
      <ExportDialog isOpen={showExportDialog} onClose={() => setShowExportDialog(false)} />
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
          className="w-28 rounded border border-zinc-600 bg-zinc-800 px-1 py-0.5 text-xs text-zinc-200 outline-none focus:border-blue-500"
          autoFocus
        />
      ) : (
        <button
          onClick={() => {
            setEditValue(sceneName);
            setEditing(true);
          }}
          className="max-w-[160px] truncate rounded px-1 py-0.5 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
          title="Click to rename scene"
        >
          {sceneName}
          {sceneModified && <span className="ml-0.5 text-yellow-500">*</span>}
        </button>
      )}

      {/* Save button */}
      <button
        onClick={handleSave}
        disabled={!isEdit}
        className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200 disabled:opacity-30"
        title="Save (Ctrl+S)"
      >
        <Save size={13} />
      </button>

      {/* Cloud save indicator */}
      {projectId && (
        <div className="flex h-6 w-6 items-center justify-center" title={
          cloudSaveStatus === 'saved' ? 'Saved to cloud' :
          cloudSaveStatus === 'saving' ? 'Saving to cloud...' :
          cloudSaveStatus === 'error' ? 'Cloud save error' :
          'Not saved'
        }>
          {cloudSaveStatus === 'saved' && <Cloud size={13} className="text-green-500" />}
          {cloudSaveStatus === 'saving' && <Loader2 size={13} className="animate-spin text-blue-500" />}
          {cloudSaveStatus === 'error' && <CloudOff size={13} className="text-red-500" />}
        </div>
      )}

      {/* Load button */}
      <button
        onClick={handleLoad}
        disabled={!isEdit}
        className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200 disabled:opacity-30"
        title="Load Scene"
      >
        <FolderOpen size={13} />
      </button>

      {/* New Scene button */}
      <button
        onClick={handleNew}
        disabled={!isEdit}
        className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200 disabled:opacity-30"
        title="New Scene (Ctrl+Shift+N)"
      >
        <FilePlus size={13} />
      </button>

      {/* Export button */}
      <button
        onClick={handleExport}
        disabled={!isEdit}
        className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200 disabled:opacity-30"
        title="Export Game"
      >
        <Download size={13} />
      </button>
    </div>
    </>
  );
}
