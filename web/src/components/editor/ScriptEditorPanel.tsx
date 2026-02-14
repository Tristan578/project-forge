'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { Trash2, Save, FileCode } from 'lucide-react';
import { useEditorStore } from '@/stores/editorStore';
import { SCRIPT_TEMPLATES } from '@/lib/scripting/scriptTemplates';
import { FORGE_TYPE_DEFINITIONS } from '@/lib/scripting/forgeTypes';

// Dynamic import Monaco with SSR disabled (it accesses browser APIs)
const MonacoEditor = dynamic(() => import('@monaco-editor/react'), { ssr: false });

const DEFAULT_SCRIPT = `function onStart() {
  forge.log("Script started!");
}

function onUpdate(dt) {
  // Write your game logic here
}
`;

export function ScriptEditorPanel() {
  const primaryId = useEditorStore((s) => s.primaryId);
  const primaryName = useEditorStore((s) => s.primaryName);
  const primaryScript = useEditorStore((s) => s.primaryScript);
  const allScripts = useEditorStore((s) => s.allScripts);
  const scriptLogs = useEditorStore((s) => s.scriptLogs);
  const setScript = useEditorStore((s) => s.setScript);
  const removeScript = useEditorStore((s) => s.removeScript);
  const applyScriptTemplate = useEditorStore((s) => s.applyScriptTemplate);
  const clearScriptLogs = useEditorStore((s) => s.clearScriptLogs);

  const [localSource, setLocalSource] = useState('');
  const [localEnabled, setLocalEnabled] = useState(true);
  const [isDirty, setIsDirty] = useState(false);
  const [showConsole, setShowConsole] = useState(true);
  const consoleRef = useRef<HTMLDivElement>(null);
  const monacoSetup = useRef(false);

  // Derive local state from selection/script changes
  const currentScript = primaryId ? allScripts[primaryId] ?? primaryScript : null;
  const derivedSource = currentScript?.source ?? '';
  const derivedEnabled = currentScript?.enabled ?? true;

  // Reset local state when the derived values change (React-documented pattern)
  const [prevDerived, setPrevDerived] = useState({ source: derivedSource, enabled: derivedEnabled });
  if (prevDerived.source !== derivedSource || prevDerived.enabled !== derivedEnabled) {
    setPrevDerived({ source: derivedSource, enabled: derivedEnabled });
    if (localSource !== derivedSource) setLocalSource(derivedSource);
    if (localEnabled !== derivedEnabled) setLocalEnabled(derivedEnabled);
    if (isDirty) setIsDirty(false);
  }

  // Auto-scroll console
  useEffect(() => {
    if (consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    }
  }, [scriptLogs]);

  const handleSave = useCallback(() => {
    if (!primaryId) return;
    setScript(primaryId, localSource, localEnabled);
    setIsDirty(false);
  }, [primaryId, localSource, localEnabled, setScript]);

  const handleAddScript = useCallback(() => {
    if (!primaryId) return;
    setScript(primaryId, DEFAULT_SCRIPT, true);
    setLocalSource(DEFAULT_SCRIPT);
    setLocalEnabled(true);
    setIsDirty(false);
  }, [primaryId, setScript]);

  const handleRemoveScript = useCallback(() => {
    if (!primaryId) return;
    removeScript(primaryId);
    setLocalSource('');
    setIsDirty(false);
  }, [primaryId, removeScript]);

  const handleApplyTemplate = useCallback(
    (templateId: string) => {
      if (!primaryId) return;
      const template = SCRIPT_TEMPLATES.find((t) => t.id === templateId);
      if (!template) return;
      applyScriptTemplate(primaryId, templateId, template.source);
      setLocalSource(template.source);
      setLocalEnabled(true);
      setIsDirty(false);
    },
    [primaryId, applyScriptTemplate]
  );

  // Monaco editor mount handler — register forge.* type definitions
  const handleEditorDidMount = useCallback((_editor: unknown, monaco: unknown) => {
    if (monacoSetup.current) return;
    monacoSetup.current = true;

    const m = monaco as {
      languages: {
        typescript: {
          typescriptDefaults: {
            addExtraLib: (content: string, filePath: string) => void;
            setCompilerOptions: (options: Record<string, unknown>) => void;
            setDiagnosticsOptions: (options: Record<string, unknown>) => void;
          };
          ScriptTarget: { ES2020: number };
          ModuleResolutionKind: { NodeJs: number };
          ModuleKind: { CommonJS: number };
        };
      };
    };

    // Register forge.* type definitions for autocomplete
    m.languages.typescript.typescriptDefaults.addExtraLib(
      FORGE_TYPE_DEFINITIONS,
      'ts:filename/forge.d.ts'
    );

    // Configure TypeScript compiler for script editing
    m.languages.typescript.typescriptDefaults.setCompilerOptions({
      target: m.languages.typescript.ScriptTarget.ES2020,
      allowNonTsExtensions: true,
      moduleResolution: m.languages.typescript.ModuleResolutionKind.NodeJs,
      module: m.languages.typescript.ModuleKind.CommonJS,
      noEmit: true,
      allowJs: true,
    });

    // Enable full diagnostics
    m.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: false,
      noSyntaxValidation: false,
    });
  }, []);

  // Monaco editor options
  const editorOptions = useMemo(() => ({
    minimap: { enabled: false },
    fontSize: 12,
    lineNumbers: 'on' as const,
    scrollBeyondLastLine: false,
    automaticLayout: true,
    tabSize: 2,
    wordWrap: 'on' as const,
    renderLineHighlight: 'all' as const,
    quickSuggestions: true,
    suggestOnTriggerCharacters: true,
    folding: true,
    bracketPairColorization: { enabled: true },
    padding: { top: 8 },
    overviewRulerLanes: 0,
    hideCursorInOverviewRuler: true,
    scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
  }), []);

  const hasScript = primaryId ? !!allScripts[primaryId] || !!primaryScript : false;

  // No entity selected
  if (!primaryId) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-zinc-900 p-4">
        <FileCode size={32} className="mb-2 text-zinc-600" />
        <p className="text-xs text-zinc-500">Select an entity to edit its script</p>
      </div>
    );
  }

  // Entity selected but no script
  if (!hasScript) {
    return (
      <div className="flex h-full flex-col bg-zinc-900 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-300">Script</h2>
          <span className="text-xs text-zinc-500">{primaryName}</span>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-3">
          <FileCode size={32} className="text-zinc-600" />
          <p className="text-xs text-zinc-500">No script attached</p>
          <button
            onClick={handleAddScript}
            className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
          >
            Add Script
          </button>
          <div className="mt-2 w-full">
            <p className="mb-1.5 text-center text-[10px] uppercase tracking-wider text-zinc-600">
              Or start from a template
            </p>
            <div className="space-y-1">
              {SCRIPT_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => handleApplyTemplate(t.id)}
                  className="flex w-full items-center justify-between rounded bg-zinc-800 px-2 py-1.5 text-left text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-300"
                >
                  <span>{t.name}</span>
                  <span className="text-[10px] text-zinc-600">{t.description}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Entity has script — show Monaco editor
  const filteredLogs = scriptLogs.filter((l) => l.entityId === primaryId || l.entityId === '*');

  return (
    <div className="flex h-full flex-col bg-zinc-900">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-1.5">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-semibold text-zinc-300">{primaryName}</h2>
          {isDirty && <span className="text-[10px] text-amber-400">unsaved</span>}
        </div>
        <div className="flex items-center gap-1">
          {/* Template dropdown */}
          <select
            className="rounded bg-zinc-800 px-1 py-0.5 text-[10px] text-zinc-400 outline-none"
            value=""
            onChange={(e) => {
              if (e.target.value) handleApplyTemplate(e.target.value);
            }}
          >
            <option value="">Template...</option>
            {SCRIPT_TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>

          {/* Enable toggle */}
          <label className="flex items-center gap-1 text-[10px] text-zinc-400">
            <input
              type="checkbox"
              checked={localEnabled}
              onChange={(e) => {
                setLocalEnabled(e.target.checked);
                if (primaryId) {
                  setScript(primaryId, localSource, e.target.checked);
                }
              }}
              className="h-3 w-3"
            />
            On
          </label>

          {/* Save */}
          <button
            onClick={handleSave}
            disabled={!isDirty}
            className="rounded p-1 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300 disabled:opacity-30"
            title="Save (Ctrl+S)"
          >
            <Save size={14} />
          </button>

          {/* Remove */}
          <button
            onClick={handleRemoveScript}
            className="rounded p-1 text-zinc-500 hover:bg-zinc-700 hover:text-red-400"
            title="Remove script"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Monaco Code Editor */}
      <div className="flex-1 overflow-hidden">
        <MonacoEditor
          height="100%"
          defaultLanguage="typescript"
          value={localSource}
          onChange={(value) => {
            setLocalSource(value ?? '');
            setIsDirty(true);
          }}
          onMount={handleEditorDidMount}
          theme="vs-dark"
          options={editorOptions}
        />
      </div>

      {/* Console */}
      {showConsole && (
        <div className="border-t border-zinc-800">
          <div className="flex items-center justify-between px-2 py-0.5">
            <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-600">
              Console
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={clearScriptLogs}
                className="text-[10px] text-zinc-600 hover:text-zinc-400"
              >
                Clear
              </button>
              <button
                onClick={() => setShowConsole(false)}
                className="text-[10px] text-zinc-600 hover:text-zinc-400"
              >
                Hide
              </button>
            </div>
          </div>
          <div
            ref={consoleRef}
            className="max-h-24 overflow-y-auto px-2 pb-1"
          >
            {filteredLogs.length === 0 ? (
              <p className="text-[10px] italic text-zinc-700">No output yet</p>
            ) : (
              filteredLogs.map((log, i) => (
                <div
                  key={i}
                  className={`text-[10px] font-mono ${
                    log.level === 'error'
                      ? 'text-red-400'
                      : log.level === 'warn'
                        ? 'text-amber-400'
                        : 'text-zinc-500'
                  }`}
                >
                  {log.message}
                </div>
              ))
            )}
          </div>
        </div>
      )}
      {!showConsole && (
        <button
          onClick={() => setShowConsole(true)}
          className="border-t border-zinc-800 px-2 py-0.5 text-left text-[10px] text-zinc-600 hover:text-zinc-400"
        >
          Show Console ({filteredLogs.length})
        </button>
      )}
    </div>
  );
}
