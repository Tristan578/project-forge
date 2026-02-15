'use client';

import { useState, useMemo, useCallback } from 'react';
import { FileCode, Search, ToggleLeft, ToggleRight, Trash2, Plus, Library, Copy, Download, Upload } from 'lucide-react';
import { useEditorStore } from '@/stores/editorStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { loadScripts, saveScript, deleteScript as deleteLibraryScript, duplicateScript, exportScript, importScript, type LibraryScript } from '@/stores/scriptLibraryStore';
import { SCRIPT_TEMPLATES } from '@/lib/scripting/scriptTemplates';

type Tab = 'entity' | 'library';

interface EntityScriptEntry {
  entityId: string;
  entityName: string;
  enabled: boolean;
  sourceLength: number;
}

export function ScriptExplorerPanel() {
  const [tab, setTab] = useState<Tab>('entity');
  const [filter, setFilter] = useState('');
  const [libraryVersion, setLibraryVersion] = useState(0);
  const [showNewMenu, setShowNewMenu] = useState(false);

  const allScripts = useEditorStore((s) => s.allScripts);
  const sceneGraph = useEditorStore((s) => s.sceneGraph);
  const primaryId = useEditorStore((s) => s.primaryId);
  const selectEntity = useEditorStore((s) => s.selectEntity);
  const setScript = useEditorStore((s) => s.setScript);
  const removeScript = useEditorStore((s) => s.removeScript);
  const openScriptEditor = useWorkspaceStore((s) => s.openScriptEditor);

  // Entity scripts
  const entityEntries = useMemo((): EntityScriptEntry[] => {
    const result: EntityScriptEntry[] = [];
    for (const [entityId, script] of Object.entries(allScripts)) {
      if (!script) continue;
      const node = sceneGraph.nodes[entityId];
      result.push({
        entityId,
        entityName: node?.name ?? entityId,
        enabled: script.enabled,
        sourceLength: script.source.length,
      });
    }
    result.sort((a, b) => a.entityName.localeCompare(b.entityName));
    return result;
  }, [allScripts, sceneGraph]);

  // Library scripts (re-read on version bump)
  const libraryScripts = useMemo((): LibraryScript[] => {
    void libraryVersion; // trigger re-read
    return loadScripts();
  }, [libraryVersion]);

  const refresh = useCallback(() => setLibraryVersion((v) => v + 1), []);

  // Filtered entries
  const filteredEntity = useMemo(() => {
    if (!filter) return entityEntries;
    const lower = filter.toLowerCase();
    return entityEntries.filter((e) => e.entityName.toLowerCase().includes(lower));
  }, [entityEntries, filter]);

  const filteredLibrary = useMemo(() => {
    if (!filter) return libraryScripts;
    const lower = filter.toLowerCase();
    return libraryScripts.filter(
      (s) =>
        s.name.toLowerCase().includes(lower) ||
        s.description.toLowerCase().includes(lower) ||
        s.tags.some((t) => t.toLowerCase().includes(lower))
    );
  }, [libraryScripts, filter]);

  const handleEntityClick = useCallback(
    (entry: EntityScriptEntry) => {
      selectEntity(entry.entityId, 'replace');
      openScriptEditor(entry.entityId, entry.entityName);
    },
    [selectEntity, openScriptEditor]
  );

  const handleToggle = useCallback(
    (e: React.MouseEvent, entry: EntityScriptEntry) => {
      e.stopPropagation();
      const script = allScripts[entry.entityId];
      if (script) setScript(entry.entityId, script.source, !script.enabled);
    },
    [allScripts, setScript]
  );

  const handleDeleteEntity = useCallback(
    (e: React.MouseEvent, entry: EntityScriptEntry) => {
      e.stopPropagation();
      removeScript(entry.entityId);
    },
    [removeScript]
  );

  // Library actions
  const handleNewBlank = useCallback(() => {
    saveScript('New Script', 'function onStart() {\n  forge.log("Hello!");\n}\n\nfunction onUpdate(dt) {\n  // Game logic\n}\n');
    refresh();
    setShowNewMenu(false);
  }, [refresh]);

  const handleNewFromTemplate = useCallback(
    (templateId: string) => {
      const template = SCRIPT_TEMPLATES.find((t) => t.id === templateId);
      if (!template) return;
      saveScript(template.name, template.source, template.description, []);
      refresh();
      setShowNewMenu(false);
    },
    [refresh]
  );

  const handleDeleteLibrary = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      deleteLibraryScript(id);
      refresh();
    },
    [refresh]
  );

  const handleDuplicate = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      duplicateScript(id);
      refresh();
    },
    [refresh]
  );

  const handleExport = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const json = exportScript(id);
    if (!json) return;
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'script.json';
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleImport = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        importScript(reader.result as string);
        refresh();
      };
      reader.readAsText(file);
    };
    input.click();
  }, [refresh]);

  const handleAttachToEntity = useCallback(
    (e: React.MouseEvent, script: LibraryScript) => {
      e.stopPropagation();
      if (!primaryId) return;
      setScript(primaryId, script.source, true);
    },
    [primaryId, setScript]
  );

  return (
    <div className="flex h-full flex-col text-xs">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-2 py-1.5">
        <div className="flex items-center gap-1.5">
          <FileCode size={13} className="text-green-400" />
          <span className="font-medium text-zinc-300">Scripts</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleImport}
            className="rounded p-0.5 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300"
            title="Import script"
          >
            <Upload size={12} />
          </button>
          <div className="relative">
            <button
              onClick={() => setShowNewMenu(!showNewMenu)}
              className="rounded p-0.5 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300"
              title="New script"
            >
              <Plus size={12} />
            </button>
            {showNewMenu && (
              <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded border border-zinc-700 bg-zinc-800 py-1 shadow-lg">
                <button
                  onClick={handleNewBlank}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-zinc-300 hover:bg-zinc-700"
                >
                  <FileCode size={11} />
                  Blank Script
                </button>
                <div className="my-1 border-t border-zinc-700" />
                <p className="px-3 py-0.5 text-[10px] uppercase tracking-wider text-zinc-600">
                  From Template
                </p>
                {SCRIPT_TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => handleNewFromTemplate(t.id)}
                    className="flex w-full items-center justify-between px-3 py-1 text-left text-zinc-400 hover:bg-zinc-700 hover:text-zinc-300"
                  >
                    <span>{t.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-zinc-800">
        <button
          onClick={() => setTab('entity')}
          className={`flex-1 py-1 text-center text-[10px] font-medium ${
            tab === 'entity'
              ? 'border-b border-blue-500 text-blue-400'
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          Entity ({entityEntries.length})
        </button>
        <button
          onClick={() => setTab('library')}
          className={`flex-1 py-1 text-center text-[10px] font-medium ${
            tab === 'library'
              ? 'border-b border-blue-500 text-blue-400'
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          Library ({libraryScripts.length})
        </button>
      </div>

      {/* Search */}
      <div className="border-b border-zinc-800 px-2 py-1">
        <div className="flex items-center gap-1 rounded bg-zinc-800 px-1.5 py-1">
          <Search size={11} className="text-zinc-500" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter scripts..."
            className="flex-1 bg-transparent text-xs text-zinc-300 placeholder:text-zinc-600 outline-none"
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'entity' ? (
          filteredEntity.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-3 py-8 text-zinc-600">
              <FileCode size={24} />
              <span>{entityEntries.length === 0 ? 'No entity scripts' : 'No matches'}</span>
              {entityEntries.length === 0 && (
                <span className="text-center text-[10px]">
                  Select an entity and add a script from the Inspector
                </span>
              )}
            </div>
          ) : (
            filteredEntity.map((entry) => (
              <button
                key={entry.entityId}
                onClick={() => handleEntityClick(entry)}
                className="flex w-full items-center gap-2 border-b border-zinc-800/50 px-2 py-1.5 text-left transition-colors hover:bg-zinc-800/50"
              >
                <FileCode size={12} className={entry.enabled ? 'text-green-400' : 'text-zinc-600'} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-zinc-300">{entry.entityName}</div>
                  <div className="text-[10px] text-zinc-600">
                    {entry.sourceLength} chars {!entry.enabled && '(disabled)'}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <span
                    onClick={(e) => handleToggle(e, entry)}
                    className="cursor-pointer text-zinc-500 hover:text-zinc-300"
                    title={entry.enabled ? 'Disable' : 'Enable'}
                  >
                    {entry.enabled ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                  </span>
                  <span
                    onClick={(e) => handleDeleteEntity(e, entry)}
                    className="cursor-pointer text-zinc-500 hover:text-red-400"
                    title="Remove script"
                  >
                    <Trash2 size={11} />
                  </span>
                </div>
              </button>
            ))
          )
        ) : filteredLibrary.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-3 py-8 text-zinc-600">
            <Library size={24} />
            <span>{libraryScripts.length === 0 ? 'No library scripts' : 'No matches'}</span>
            <span className="text-center text-[10px]">
              Click + to create a standalone script
            </span>
          </div>
        ) : (
          filteredLibrary.map((script) => (
            <div
              key={script.id}
              className="flex items-center gap-2 border-b border-zinc-800/50 px-2 py-1.5 transition-colors hover:bg-zinc-800/50"
            >
              <Library size={12} className="text-purple-400" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-zinc-300">{script.name}</div>
                <div className="text-[10px] text-zinc-600">
                  {script.description || `${script.source.length} chars`}
                  {script.tags.length > 0 && ` · ${script.tags.join(', ')}`}
                </div>
              </div>
              <div className="flex items-center gap-0.5">
                {primaryId && (
                  <button
                    onClick={(e) => handleAttachToEntity(e, script)}
                    className="rounded p-0.5 text-zinc-500 hover:text-green-400"
                    title="Attach to selected entity"
                  >
                    <FileCode size={11} />
                  </button>
                )}
                <button
                  onClick={(e) => handleDuplicate(e, script.id)}
                  className="rounded p-0.5 text-zinc-500 hover:text-zinc-300"
                  title="Duplicate"
                >
                  <Copy size={11} />
                </button>
                <button
                  onClick={(e) => handleExport(e, script.id)}
                  className="rounded p-0.5 text-zinc-500 hover:text-zinc-300"
                  title="Export JSON"
                >
                  <Download size={11} />
                </button>
                <button
                  onClick={(e) => handleDeleteLibrary(e, script.id)}
                  className="rounded p-0.5 text-zinc-500 hover:text-red-400"
                  title="Delete"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
