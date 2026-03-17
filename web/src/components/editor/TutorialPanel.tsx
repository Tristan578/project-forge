'use client';

import { useState, useCallback, useMemo } from 'react';
import { BookOpen, Wand2, GripVertical, Download, Loader2, AlertCircle, ChevronDown, ChevronRight } from 'lucide-react';
import { useEditorStore } from '@/stores/editorStore';
import {
  detectMechanics,
  generateTutorialPlan,
  tutorialPlanToScript,
  type GameMechanic,
  type TutorialPlan,
  type SceneEntityContext,
} from '@/lib/ai/tutorialGenerator';

// ---------------------------------------------------------------------------
// Helper: extract SceneEntityContext[] from editor store state
// ---------------------------------------------------------------------------

function useSceneEntities(): SceneEntityContext[] {
  const sceneGraph = useEditorStore((s) => s.sceneGraph);
  const allGameComponents = useEditorStore((s) => s.allGameComponents);
  const allScripts = useEditorStore((s) => s.allScripts);

  return useMemo(() => {
    const entities: SceneEntityContext[] = [];
    for (const node of Object.values(sceneGraph.nodes)) {
      const gameComps = allGameComponents[node.entityId];
      // Detect physics from component names (bridge emits these as strings)
      const hasPhysics = node.components.some(
        (c) => c === 'RigidBody' || c === 'Collider' || c === 'PhysicsData' || c === 'PhysicsEnabled',
      );
      entities.push({
        entityId: node.entityId,
        name: node.name,
        components: node.components,
        gameComponents: gameComps?.map((c) => ({ type: c.type })),
        hasPhysics,
        hasScript: !!allScripts[node.entityId],
      });
    }
    return entities;
  }, [sceneGraph, allGameComponents, allScripts]);
}

// ---------------------------------------------------------------------------
// MechanicItem
// ---------------------------------------------------------------------------

function MechanicItem({
  mechanic,
  checked,
  onToggle,
}: {
  mechanic: GameMechanic;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label className="flex items-start gap-2 rounded px-2 py-1.5 hover:bg-zinc-800 cursor-pointer transition-colors">
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="mt-0.5 accent-blue-500"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-zinc-200">{mechanic.name}</span>
          <span className="text-[10px] text-zinc-500">
            complexity {mechanic.complexity}/5
          </span>
        </div>
        <p className="text-[10px] text-zinc-500 leading-tight">{mechanic.description}</p>
      </div>
    </label>
  );
}

// ---------------------------------------------------------------------------
// TutorialStepCard
// ---------------------------------------------------------------------------

function TutorialStepCard({
  step,
  isExpanded,
  onToggle,
}: {
  step: TutorialPlan['steps'][number];
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="rounded border border-zinc-700 bg-zinc-800/50">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-zinc-700/50"
        aria-expanded={isExpanded}
      >
        <GripVertical size={12} className="shrink-0 text-zinc-600" />
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-600 text-[10px] font-bold text-white">
          {step.order}
        </span>
        <span className="flex-1 truncate text-xs font-medium text-zinc-200">
          {step.mechanic}
        </span>
        {isExpanded ? (
          <ChevronDown size={12} className="text-zinc-500" />
        ) : (
          <ChevronRight size={12} className="text-zinc-500" />
        )}
      </button>
      {isExpanded && (
        <div className="space-y-1.5 border-t border-zinc-700 px-3 py-2">
          <p className="text-xs text-zinc-300">{step.instruction}</p>
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] text-zinc-500">
              <span className="font-medium text-zinc-400">Trigger:</span>{' '}
              {step.triggerCondition}
            </span>
            <span className="text-[10px] text-zinc-500">
              <span className="font-medium text-zinc-400">Complete:</span>{' '}
              {step.completionCondition}
            </span>
            {step.hint && (
              <span className="text-[10px] text-zinc-500">
                <span className="font-medium text-zinc-400">Hint:</span>{' '}
                {step.hint}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TutorialPanel
// ---------------------------------------------------------------------------

export function TutorialPanel() {
  const entities = useSceneEntities();

  // Detection state
  const [detectedMechanics, setDetectedMechanics] = useState<GameMechanic[]>([]);
  const [selectedMechanics, setSelectedMechanics] = useState<Set<string>>(new Set());
  const [hasDetected, setHasDetected] = useState(false);

  // Generation state
  const [plan, setPlan] = useState<TutorialPlan | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set());

  // Actions
  const handleDetect = useCallback(() => {
    setError(null);
    const mechanics = detectMechanics(entities);
    setDetectedMechanics(mechanics);
    setSelectedMechanics(new Set(mechanics.map((m) => m.name)));
    setHasDetected(true);
    setPlan(null);
  }, [entities]);

  const handleToggleMechanic = useCallback((name: string) => {
    setSelectedMechanics((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }, []);

  const handleGenerate = useCallback(async () => {
    const mechanics = detectedMechanics.filter((m) => selectedMechanics.has(m.name));
    if (mechanics.length === 0) {
      setError('Select at least one mechanic to include in the tutorial.');
      return;
    }

    setIsGenerating(true);
    setError(null);
    setPlan(null);

    try {
      const result = await generateTutorialPlan(mechanics);
      setPlan(result);
      // Expand the first step by default
      setExpandedSteps(new Set([0]));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Tutorial generation failed');
    } finally {
      setIsGenerating(false);
    }
  }, [detectedMechanics, selectedMechanics]);

  const handleExportScript = useCallback(() => {
    if (!plan) return;
    const script = tutorialPlanToScript(plan);
    const blob = new Blob([script], { type: 'text/typescript' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tutorial.ts';
    a.click();
    URL.revokeObjectURL(url);
  }, [plan]);

  const handleToggleStep = useCallback((index: number) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  const selectedCount = selectedMechanics.size;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-zinc-900">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
        <BookOpen size={14} className="text-blue-400" />
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
          Tutorial Generator
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Step 1: Detect */}
        <section>
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            1. Detect Mechanics
          </h3>
          <button
            onClick={handleDetect}
            className="flex w-full items-center justify-center gap-2 rounded bg-zinc-800 px-3 py-2 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-700 focus:ring-2 focus:ring-blue-500 focus:outline-none"
            aria-label="Detect game mechanics in the current scene"
          >
            <Wand2 size={13} />
            Detect Mechanics
          </button>

          {hasDetected && detectedMechanics.length === 0 && (
            <div className="mt-2 flex items-start gap-2 rounded border border-amber-700/50 bg-amber-900/20 px-3 py-2">
              <AlertCircle size={13} className="mt-0.5 shrink-0 text-amber-400" />
              <p className="text-[10px] text-amber-300 leading-tight">
                No game mechanics detected. Add game components (CharacterController, Collectible, Health, etc.) to your scene entities first.
              </p>
            </div>
          )}
        </section>

        {/* Step 2: Select Mechanics */}
        {hasDetected && detectedMechanics.length > 0 && (
          <section>
            <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              2. Select Mechanics ({selectedCount}/{detectedMechanics.length})
            </h3>
            <div className="space-y-0.5">
              {detectedMechanics.map((m) => (
                <MechanicItem
                  key={m.name}
                  mechanic={m}
                  checked={selectedMechanics.has(m.name)}
                  onToggle={() => handleToggleMechanic(m.name)}
                />
              ))}
            </div>
          </section>
        )}

        {/* Step 3: Generate */}
        {hasDetected && detectedMechanics.length > 0 && (
          <section>
            <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              3. Generate Tutorial
            </h3>
            <button
              onClick={handleGenerate}
              disabled={isGenerating || selectedCount === 0}
              className="flex w-full items-center justify-center gap-2 rounded bg-blue-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50 focus:ring-2 focus:ring-blue-500 focus:outline-none"
              aria-label="Generate tutorial plan with AI"
            >
              {isGenerating ? (
                <>
                  <Loader2 size={13} className="animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Wand2 size={13} />
                  Generate Tutorial Plan
                </>
              )}
            </button>
          </section>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 rounded border border-red-700/50 bg-red-900/20 px-3 py-2">
            <AlertCircle size={13} className="mt-0.5 shrink-0 text-red-400" />
            <p className="text-[10px] text-red-300 leading-tight">{error}</p>
          </div>
        )}

        {/* Results */}
        {plan && (
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Tutorial Plan
              </h3>
              <div className="flex items-center gap-2 text-[10px] text-zinc-500">
                <span>{plan.estimatedDuration}</span>
                <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-400">
                  {plan.difficulty}
                </span>
              </div>
            </div>

            {/* Intro text */}
            <div className="mb-3 rounded border border-zinc-700 bg-zinc-800/30 px-3 py-2">
              <p className="text-[10px] font-medium text-zinc-400">Intro</p>
              <p className="text-xs text-zinc-300">{plan.introText}</p>
            </div>

            {/* Steps */}
            <div className="space-y-1.5">
              {plan.steps.map((step, i) => (
                <TutorialStepCard
                  key={step.order}
                  step={step}
                  isExpanded={expandedSteps.has(i)}
                  onToggle={() => handleToggleStep(i)}
                />
              ))}
            </div>

            {/* Completion text */}
            <div className="mt-3 rounded border border-zinc-700 bg-zinc-800/30 px-3 py-2">
              <p className="text-[10px] font-medium text-zinc-400">Completion</p>
              <p className="text-xs text-zinc-300">{plan.completionText}</p>
            </div>

            {/* Export */}
            <button
              onClick={handleExportScript}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded bg-zinc-800 px-3 py-2 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-700 focus:ring-2 focus:ring-blue-500 focus:outline-none"
              aria-label="Export tutorial as game script"
            >
              <Download size={13} />
              Export as Script
            </button>
          </section>
        )}

        {/* Empty state */}
        {!hasDetected && (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <BookOpen size={24} className="text-zinc-600" />
            <p className="text-xs text-zinc-500">
              Detect game mechanics in your scene to generate a progressive tutorial that teaches players step-by-step.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
