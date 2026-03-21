'use client';

import { useState, useCallback } from 'react';
import { Wand2, ChevronDown, ChevronUp, AlertCircle, CheckCircle, Loader2 } from 'lucide-react';
import { useEditorStore, getCommandDispatcher } from '@/stores/editorStore';
import { buildSceneContext, type SceneContextStore } from '@/lib/ai/sceneContext';
import {
  planModification,
  executeModificationPlan,
  type ModificationPlan,
  type ModificationScope,
  type StepExecutionResult,
} from '@/lib/ai/gameModifier';

type PanelState = 'idle' | 'planning' | 'planned' | 'executing' | 'done' | 'error';

export function ModifyPanel() {
  const [description, setDescription] = useState('');
  const [scope, setScope] = useState<ModificationScope>('scene');
  const [plan, setPlan] = useState<ModificationPlan | null>(null);
  const [panelState, setPanelState] = useState<PanelState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<StepExecutionResult[]>([]);
  const [showSteps, setShowSteps] = useState(false);

  // Select primitive values from the store, not functions
  const sceneGraph = useEditorStore((s) => s.sceneGraph);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const ambientLight = useEditorStore((s) => s.ambientLight);
  const environment = useEditorStore((s) => s.environment);
  const engineMode = useEditorStore((s) => s.engineMode);

  const handlePlan = useCallback(async () => {
    if (!description.trim()) return;

    setPanelState('planning');
    setError(null);
    setPlan(null);
    setResults([]);

    try {
      const storeSnapshot: SceneContextStore = {
        sceneGraph,
        selectedIds,
        ambientLight,
        environment,
        engineMode,
      };
      const sceneContext = buildSceneContext(storeSnapshot);
      const newPlan = await planModification(
        { description: description.trim(), scope },
        sceneContext,
      );
      setPlan(newPlan);
      setPanelState('planned');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate modification plan');
      setPanelState('error');
    }
  }, [description, scope, sceneGraph, selectedIds, ambientLight, environment, engineMode]);

  const handleApply = useCallback(() => {
    if (!plan) return;

    const dispatch = getCommandDispatcher();
    if (!dispatch) {
      setError('Engine not connected. Please wait for WASM to load.');
      setPanelState('error');
      return;
    }

    setPanelState('executing');
    try {
      const stepResults = executeModificationPlan(plan, dispatch);
      setResults(stepResults);
      setPanelState('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to execute modification plan');
      setPanelState('error');
    }
  }, [plan]);

  const handleReset = useCallback(() => {
    setDescription('');
    setPlan(null);
    setPanelState('idle');
    setError(null);
    setResults([]);
    setShowSteps(false);
  }, []);

  const successCount = results.filter((r) => r.success).length;
  const failCount = results.filter((r) => !r.success).length;

  return (
    <div className="flex flex-col gap-3 p-3">
      <h3 className="text-xs font-semibold uppercase text-zinc-400">
        <Wand2 size={12} className="mr-1 inline-block" />
        Modify Game
      </h3>

      {/* Description input */}
      <div>
        <label htmlFor="modify-description" className="mb-1 block text-xs text-zinc-400">
          What would you like to change?
        </label>
        <textarea
          id="modify-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. make the enemies faster, change the background to a sunset, add more lights..."
          className="w-full resize-none rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          rows={3}
          disabled={panelState === 'planning' || panelState === 'executing'}
        />
      </div>

      {/* Scope toggle */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-zinc-400">Scope:</span>
        <div className="flex rounded border border-zinc-700">
          <button
            onClick={() => setScope('selected')}
            className={`px-2 py-0.5 text-xs transition-colors ${
              scope === 'selected'
                ? 'bg-zinc-700 text-white'
                : 'text-zinc-400 hover:text-zinc-300'
            }`}
            title="Only modify selected entities"
            aria-pressed={scope === 'selected'}
          >
            Selected
          </button>
          <button
            onClick={() => setScope('scene')}
            className={`px-2 py-0.5 text-xs transition-colors ${
              scope === 'scene'
                ? 'bg-zinc-700 text-white'
                : 'text-zinc-400 hover:text-zinc-300'
            }`}
            title="Modify any entity in the scene"
            aria-pressed={scope === 'scene'}
          >
            Entire Scene
          </button>
        </div>
      </div>

      {/* Plan button */}
      {(panelState === 'idle' || panelState === 'error') && (
        <button
          onClick={handlePlan}
          disabled={!description.trim()}
          className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Plan Changes
        </button>
      )}

      {/* Loading state */}
      {panelState === 'planning' && (
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <Loader2 size={14} className="animate-spin" />
          Analyzing scene and planning modifications...
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="flex items-start gap-2 rounded border border-red-800/50 bg-red-900/20 p-2 text-xs text-red-300">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <div>
            <p>{error}</p>
            <button
              onClick={handleReset}
              className="mt-1 text-red-400 underline hover:text-red-300"
            >
              Try again
            </button>
          </div>
        </div>
      )}

      {/* Plan preview */}
      {plan && (panelState === 'planned' || panelState === 'executing' || panelState === 'done') && (
        <div className="rounded border border-zinc-700 bg-zinc-800/50 p-2">
          <div className="mb-2 text-xs text-zinc-300">{plan.summary}</div>
          <div className="mb-2 flex items-center gap-3 text-xs text-zinc-400">
            <span>{plan.steps.length} step{plan.steps.length !== 1 ? 's' : ''}</span>
            <span>{plan.affectedEntities.length} entit{plan.affectedEntities.length !== 1 ? 'ies' : 'y'}</span>
            <span>Confidence: {Math.round(plan.confidence * 100)}%</span>
          </div>

          {/* Expandable steps */}
          <button
            onClick={() => setShowSteps(!showSteps)}
            className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-300"
            aria-expanded={showSteps}
          >
            {showSteps ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            {showSteps ? 'Hide' : 'Show'} steps
          </button>

          {showSteps && (
            <div className="mt-2 space-y-1">
              {plan.steps.map((step, i) => {
                const result = results[i];
                return (
                  <div
                    key={`step-${step.command}-${step.entityId ?? 'global'}-${i}`}
                    className="flex items-start gap-2 rounded bg-zinc-900/50 p-1.5 text-xs"
                  >
                    {result ? (
                      result.success ? (
                        <CheckCircle size={12} className="mt-0.5 shrink-0 text-green-500" />
                      ) : (
                        <AlertCircle size={12} className="mt-0.5 shrink-0 text-red-500" />
                      )
                    ) : (
                      <span className="mt-0.5 inline-block h-3 w-3 shrink-0 rounded-full border border-zinc-600" />
                    )}
                    <div className="min-w-0 flex-1">
                      <span className="font-mono text-zinc-400">{step.command}</span>
                      {step.entityId && (
                        <span className="ml-1 text-zinc-400">({step.entityId})</span>
                      )}
                      {result && !result.success && result.error && (
                        <p className="mt-0.5 text-red-400">{result.error}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Apply / Done buttons */}
          {panelState === 'planned' && (
            <div className="mt-2 flex gap-2">
              <button
                onClick={handleApply}
                className="rounded bg-green-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-green-500"
              >
                Apply Changes
              </button>
              <button
                onClick={handleReset}
                className="rounded border border-zinc-700 px-3 py-1 text-xs text-zinc-400 transition-colors hover:text-zinc-200"
              >
                Cancel
              </button>
            </div>
          )}

          {panelState === 'executing' && (
            <div className="mt-2 flex items-center gap-2 text-xs text-zinc-400">
              <Loader2 size={14} className="animate-spin" />
              Applying modifications...
            </div>
          )}

          {panelState === 'done' && (
            <div className="mt-2">
              <div className="mb-1 text-xs text-zinc-400">
                {successCount > 0 && (
                  <span className="text-green-400">{successCount} succeeded</span>
                )}
                {failCount > 0 && (
                  <span className="ml-2 text-red-400">{failCount} failed</span>
                )}
              </div>
              <button
                onClick={handleReset}
                className="rounded border border-zinc-700 px-3 py-1 text-xs text-zinc-400 transition-colors hover:text-zinc-200"
              >
                New Modification
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
