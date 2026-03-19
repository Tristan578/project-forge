'use client';

import { useState, useCallback, useRef } from 'react';
import { Save, Loader2, Play, Trash2, Plus, CheckCircle } from 'lucide-react';
import { useEditorStore } from '@/stores/editorStore';
import {
  analyzeSaveNeeds,
  validateSaveSystemConfig,
  saveSystemToScript,
  generateDefaultUISpecs,
  type PersistedField,
  type CheckpointConfig,
  type SaveSystem,
  type SaveSystemConfig,
} from '@/lib/ai/saveSystemGenerator';

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function FieldRow({
  field,
  enabled,
  onToggle,
}: {
  field: PersistedField;
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer hover:bg-zinc-800 px-2 py-1 rounded">
      <input
        type="checkbox"
        checked={enabled}
        onChange={onToggle}
        className="accent-blue-500"
      />
      <span className="truncate flex-1">{field.path}</span>
      <span className="text-zinc-500">{field.type}</span>
    </label>
  );
}

function CheckpointRow({
  checkpoint,
  onRemove,
}: {
  checkpoint: CheckpointConfig;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-2 text-xs text-zinc-300 bg-zinc-800 px-2 py-1.5 rounded">
      <CheckCircle size={12} className="text-green-400 shrink-0" />
      <span className="truncate flex-1">{checkpoint.name}</span>
      <span className="text-zinc-500">{checkpoint.trigger}</span>
      <button
        type="button"
        onClick={onRemove}
        className="text-zinc-500 hover:text-red-400 transition-colors duration-150"
        aria-label={`Remove checkpoint ${checkpoint.name}`}
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function SaveSystemPanel() {
  // Store selectors — primitive values only
  const sceneGraph = useEditorStore((s) => s.sceneGraph);
  const allGameComponents = useEditorStore((s) => s.allGameComponents);

  // Local state
  const [detectedFields, setDetectedFields] = useState<PersistedField[]>([]);
  const [enabledPaths, setEnabledPaths] = useState<Set<string>>(new Set());
  const [saveSlots, setSaveSlots] = useState(3);
  const [autoSaveInterval, setAutoSaveInterval] = useState(60);
  const [compression, setCompression] = useState(false);
  const [checkpoints, setCheckpoints] = useState<CheckpointConfig[]>([]);
  const [generatedSystem, setGeneratedSystem] = useState<SaveSystem | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  // -- Analyze scene --
  const handleAnalyze = useCallback(() => {
    const gameComps = allGameComponents as Record<string, Array<{ type: string }>>;
    const fields = analyzeSaveNeeds(sceneGraph, gameComps);
    setDetectedFields(fields);
    setEnabledPaths(new Set(fields.map((f) => f.path)));
    setErrors([]);
    setGeneratedSystem(null);
  }, [sceneGraph, allGameComponents]);

  // -- Toggle a field --
  const toggleField = useCallback((path: string) => {
    setEnabledPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  // Monotonic counter prevents duplicate IDs after deletions
  const nextCpId = useRef(1);

  // -- Add checkpoint --
  const addCheckpoint = useCallback(() => {
    const n = nextCpId.current++;
    setCheckpoints((prev) => [
      ...prev,
      {
        id: `cp_${n}`,
        name: `Checkpoint ${n}`,
        trigger: 'manual' as const,
        position: { x: 0, y: 0, z: 0 },
      },
    ]);
  }, []);

  // -- Remove checkpoint --
  const removeCheckpoint = useCallback((id: string) => {
    setCheckpoints((prev) => prev.filter((cp) => cp.id !== id));
  }, []);

  // -- Generate system --
  const handleGenerate = useCallback(() => {
    const selectedFields = detectedFields.filter((f) => enabledPaths.has(f.path));

    const config: SaveSystemConfig = {
      saveSlots,
      autoSaveInterval,
      checkpointTriggers: [...new Set(checkpoints.map((cp) => cp.trigger))],
      persistedData: selectedFields,
      compression,
    };

    const validationErrors = validateSaveSystemConfig(config);
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }

    setIsGenerating(true);
    setErrors([]);

    // Synchronous generation (no AI call needed for script)
    const system: SaveSystem = {
      config,
      checkpoints,
      script: '',
      uiComponents: generateDefaultUISpecs(),
    };
    system.script = saveSystemToScript(system);
    setGeneratedSystem(system);
    setIsGenerating(false);
  }, [detectedFields, enabledPaths, saveSlots, autoSaveInterval, checkpoints, compression]);

  // -- Apply to project (copies script to clipboard) --
  const handleApply = useCallback(() => {
    if (!generatedSystem) return;
    navigator.clipboard.writeText(generatedSystem.script).catch(() => {
      // Clipboard API may not be available; silent fail
    });
  }, [generatedSystem]);

  return (
    <div className="flex flex-col h-full overflow-y-auto text-sm text-zinc-200">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-700">
        <Save size={16} className="text-blue-400" />
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Save System Generator
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Step 1 — Analyze */}
        <section className="space-y-2">
          <h3 className="text-xs font-semibold text-zinc-400 uppercase">
            1. Analyze Scene
          </h3>
          <button
            type="button"
            onClick={handleAnalyze}
            className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors duration-150 focus:ring-2 focus:ring-blue-500 focus:outline-none"
          >
            <Play size={12} />
            Analyze Scene
          </button>

          {detectedFields.length > 0 && (
            <div className="space-y-1 mt-2">
              <p className="text-xs text-zinc-500">
                {detectedFields.length} field(s) detected
              </p>
              {detectedFields.map((field) => (
                <FieldRow
                  key={field.path}
                  field={field}
                  enabled={enabledPaths.has(field.path)}
                  onToggle={() => toggleField(field.path)}
                />
              ))}
            </div>
          )}
        </section>

        {/* Step 2 — Config */}
        <section className="space-y-2">
          <h3 className="text-xs font-semibold text-zinc-400 uppercase">
            2. Configuration
          </h3>

          <div className="space-y-2">
            <label className="flex items-center justify-between text-xs text-zinc-300">
              <span>Save Slots</span>
              <input
                type="number"
                min={1}
                max={20}
                value={saveSlots}
                onChange={(e) => setSaveSlots(Number(e.target.value))}
                className="w-16 bg-zinc-800 border border-zinc-600 rounded px-2 py-0.5 text-right text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </label>

            <label className="flex items-center justify-between text-xs text-zinc-300">
              <span>Auto-save (sec)</span>
              <input
                type="number"
                min={0}
                step={10}
                value={autoSaveInterval}
                onChange={(e) => setAutoSaveInterval(Number(e.target.value))}
                className="w-16 bg-zinc-800 border border-zinc-600 rounded px-2 py-0.5 text-right text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </label>

            <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
              <input
                type="checkbox"
                checked={compression}
                onChange={(e) => setCompression(e.target.checked)}
                className="accent-blue-500"
              />
              Enable compression
            </label>
          </div>
        </section>

        {/* Step 3 — Checkpoints */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-zinc-400 uppercase">
              3. Checkpoints
            </h3>
            <button
              type="button"
              onClick={addCheckpoint}
              className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 transition-colors duration-150"
              aria-label="Add checkpoint"
            >
              <Plus size={12} />
              Add
            </button>
          </div>

          {checkpoints.length === 0 && (
            <p className="text-xs text-zinc-500 italic">
              No checkpoints yet. Click &ldquo;Add&rdquo; to create one.
            </p>
          )}

          <div className="space-y-1">
            {checkpoints.map((cp) => (
              <CheckpointRow
                key={cp.id}
                checkpoint={cp}
                onRemove={() => removeCheckpoint(cp.id)}
              />
            ))}
          </div>
        </section>

        {/* Errors */}
        {errors.length > 0 && (
          <div className="bg-red-900/30 border border-red-700 rounded p-2 space-y-1">
            {errors.map((err, i) => (
              <p key={i} className="text-xs text-red-300">
                {err}
              </p>
            ))}
          </div>
        )}

        {/* Step 4 — Generate */}
        <section className="space-y-2">
          <button
            type="button"
            onClick={handleGenerate}
            disabled={isGenerating}
            className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded bg-green-600 hover:bg-green-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-xs font-medium transition-colors duration-150 focus:ring-2 focus:ring-green-500 focus:outline-none"
          >
            {isGenerating ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Save size={12} />
            )}
            Generate Save System
          </button>
        </section>

        {/* Script preview */}
        {generatedSystem && (
          <section className="space-y-2">
            <h3 className="text-xs font-semibold text-zinc-400 uppercase">
              Generated Script
            </h3>
            <pre className="bg-zinc-950 border border-zinc-700 rounded p-2 text-[10px] leading-tight text-zinc-300 overflow-auto max-h-60 font-mono">
              {generatedSystem.script}
            </pre>
            <button
              type="button"
              onClick={handleApply}
              className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded bg-purple-600 hover:bg-purple-500 text-white text-xs font-medium transition-colors duration-150 focus:ring-2 focus:ring-purple-500 focus:outline-none"
            >
              <CheckCircle size={12} />
              Copy Script to Clipboard
            </button>
          </section>
        )}
      </div>
    </div>
  );
}
