'use client';

/**
 * PhysicsFeelPanel — UI for selecting and blending physics feel presets.
 *
 * Provides a gallery of 8 built-in presets, per-parameter sliders,
 * blend control between two presets, scene analysis, and custom generation.
 */

import { useState, useCallback, useMemo } from 'react';
import { Gauge, Blend, Search, Sparkles, Check } from 'lucide-react';
import {
  PHYSICS_PRESETS,
  PRESET_KEYS,
  interpolateProfiles,
  analyzePhysicsFeel,
  applyPhysicsProfile,
  generateCustomProfile,
} from '@/lib/ai/physicsFeel';
import type { PhysicsProfile, PhysicsAnalysis, PhysicsSceneContext } from '@/lib/ai/physicsFeel';
import { useEditorStore } from '@/stores/editorStore';
import { getCommandDispatcher } from '@/stores/editorStore';

// ---------------------------------------------------------------------------
// Parameter slider config
// ---------------------------------------------------------------------------

interface SliderParam {
  key: keyof PhysicsProfile;
  label: string;
  min: number;
  max: number;
  step: number;
}

const SLIDER_PARAMS: SliderParam[] = [
  { key: 'gravity', label: 'Gravity', min: 0.1, max: 30, step: 0.5 },
  { key: 'jumpForce', label: 'Jump Force', min: 0, max: 25, step: 0.5 },
  { key: 'moveSpeed', label: 'Move Speed', min: 1, max: 40, step: 0.5 },
  { key: 'friction', label: 'Friction', min: 0, max: 1, step: 0.05 },
  { key: 'airControl', label: 'Air Control', min: 0, max: 1, step: 0.05 },
  { key: 'terminalVelocity', label: 'Terminal Velocity', min: 5, max: 80, step: 1 },
  { key: 'acceleration', label: 'Acceleration', min: 1, max: 120, step: 1 },
  { key: 'deceleration', label: 'Deceleration', min: 1, max: 120, step: 1 },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PhysicsFeelPanel() {
  // --- Store selectors (primitives only) ---
  const sceneGraph = useEditorStore((s) => s.sceneGraph);
  const primaryPhysics = useEditorStore((s) => s.primaryPhysics);
  const physicsEnabled = useEditorStore((s) => s.physicsEnabled);

  // --- Local state ---
  const [selectedPresetA, setSelectedPresetA] = useState<string>(PRESET_KEYS[0]);
  const [selectedPresetB, setSelectedPresetB] = useState<string>(PRESET_KEYS[1]);
  const [blendT, setBlendT] = useState(0);
  const [analysis, setAnalysis] = useState<PhysicsAnalysis | null>(null);
  const [customDescription, setCustomDescription] = useState('');
  const [applied, setApplied] = useState(false);

  // --- Derived profile ---
  const currentProfile = useMemo(() => {
    const presetA = PHYSICS_PRESETS[selectedPresetA];
    const presetB = PHYSICS_PRESETS[selectedPresetB];
    if (!presetA || !presetB) return PHYSICS_PRESETS[PRESET_KEYS[0]];
    return interpolateProfiles(presetA, presetB, blendT);
  }, [selectedPresetA, selectedPresetB, blendT]);

  // --- Entity IDs with physics ---
  const physicsEntityIds = useMemo(() => {
    if (!sceneGraph) return [];
    return Object.keys(sceneGraph.nodes);
  }, [sceneGraph]);

  // --- Handlers ---
  const handleAnalyze = useCallback(() => {
    const entities: PhysicsSceneContext['entities'] = [];
    if (sceneGraph) {
      for (const node of Object.values(sceneGraph.nodes)) {
        entities.push({
          entityId: node.entityId,
          physics: primaryPhysics && physicsEnabled
            ? { gravityScale: primaryPhysics.gravityScale, friction: primaryPhysics.friction }
            : null,
        });
      }
    }
    const result = analyzePhysicsFeel({ entities });
    setAnalysis(result);
  }, [sceneGraph, primaryPhysics, physicsEnabled]);

  const handleApply = useCallback(() => {
    const dispatch = getCommandDispatcher();
    if (!dispatch) return;
    applyPhysicsProfile(currentProfile, dispatch, physicsEntityIds);
    setApplied(true);
    // Reset the "applied" indicator after 2 seconds
    const timeout = setTimeout(() => setApplied(false), 2000);
    return () => clearTimeout(timeout);
  }, [currentProfile, physicsEntityIds]);

  const handleCustomGenerate = useCallback(() => {
    if (!customDescription.trim()) return;
    const profile = generateCustomProfile(customDescription);
    // Find or set the closest preset
    setSelectedPresetA(PRESET_KEYS[0]);
    setSelectedPresetB(PRESET_KEYS[0]);
    setBlendT(0);
    // Apply the custom profile directly
    const dispatch = getCommandDispatcher();
    if (dispatch) {
      applyPhysicsProfile(profile, dispatch, physicsEntityIds);
    }
  }, [customDescription, physicsEntityIds]);

  return (
    <div className="flex flex-col gap-4 p-3 text-sm text-zinc-300 overflow-y-auto max-h-full">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Gauge className="w-4 h-4 text-blue-400" />
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Physics Feel
        </h2>
      </div>

      {/* Preset Gallery */}
      <div>
        <label className="text-xs text-zinc-500 mb-1 block">Preset A</label>
        <div className="grid grid-cols-2 gap-1.5">
          {PRESET_KEYS.map((key) => {
            const preset = PHYSICS_PRESETS[key];
            return (
              <button
                key={key}
                type="button"
                onClick={() => setSelectedPresetA(key)}
                className={`text-left p-2 rounded text-xs transition-colors duration-150 ${
                  selectedPresetA === key
                    ? 'bg-blue-600/30 border border-blue-500/50 text-blue-300'
                    : 'bg-zinc-800 border border-zinc-700 hover:border-zinc-600 text-zinc-300'
                }`}
                aria-label={`Select ${preset.name} as Preset A`}
              >
                <div className="font-medium">{preset.name}</div>
                <div className="text-zinc-500 mt-0.5 line-clamp-2">{preset.description}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Blend Control */}
      <div className="border-t border-zinc-800 pt-3">
        <div className="flex items-center gap-2 mb-2">
          <Blend className="w-3.5 h-3.5 text-zinc-500" />
          <label className="text-xs text-zinc-500">
            Blend with Preset B
          </label>
        </div>
        <select
          value={selectedPresetB}
          onChange={(e) => setSelectedPresetB(e.target.value)}
          className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-300 mb-2 focus:ring-2 focus:ring-blue-500 focus:outline-none"
          aria-label="Select Preset B for blending"
        >
          {PRESET_KEYS.map((key) => (
            <option key={key} value={key}>
              {PHYSICS_PRESETS[key].name}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500 w-6">A</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={blendT}
            onChange={(e) => setBlendT(parseFloat(e.target.value))}
            className="flex-1 accent-blue-500"
            aria-label="Blend factor between Preset A and Preset B"
          />
          <span className="text-xs text-zinc-500 w-6">B</span>
          <span className="text-xs text-zinc-400 w-10 text-right">
            {Math.round(blendT * 100)}%
          </span>
        </div>
      </div>

      {/* Parameter Preview */}
      <div className="border-t border-zinc-800 pt-3">
        <h3 className="text-xs font-semibold uppercase text-zinc-500 mb-2">
          Current Values
        </h3>
        <div className="space-y-2">
          {SLIDER_PARAMS.map(({ key, label, min, max, step }) => {
            const value = currentProfile[key] as number;
            return (
              <div key={key} className="flex items-center gap-2">
                <label className="text-xs text-zinc-400 w-28 shrink-0">{label}</label>
                <input
                  type="range"
                  min={min}
                  max={max}
                  step={step}
                  value={value}
                  readOnly
                  className="flex-1 accent-blue-500"
                  aria-label={`${label} value`}
                />
                <span className="text-xs text-zinc-400 w-12 text-right font-mono">
                  {typeof value === 'number' ? value.toFixed(1) : value}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Apply Button */}
      <button
        type="button"
        onClick={handleApply}
        disabled={physicsEntityIds.length === 0}
        className={`w-full py-2 px-3 rounded text-xs font-medium transition-colors duration-150 focus:ring-2 focus:ring-blue-500 focus:outline-none ${
          applied
            ? 'bg-green-600/30 border border-green-500/50 text-green-300'
            : physicsEntityIds.length === 0
              ? 'bg-zinc-800 border border-zinc-700 text-zinc-600 cursor-not-allowed'
              : 'bg-blue-600 hover:bg-blue-500 text-white'
        }`}
        aria-label="Apply physics profile to all entities"
      >
        {applied ? (
          <span className="flex items-center justify-center gap-1.5">
            <Check className="w-3.5 h-3.5" /> Applied
          </span>
        ) : (
          `Apply to ${physicsEntityIds.length} entities`
        )}
      </button>

      {/* Analyze Current Scene */}
      <div className="border-t border-zinc-800 pt-3">
        <button
          type="button"
          onClick={handleAnalyze}
          className="w-full py-2 px-3 rounded text-xs font-medium bg-zinc-800 border border-zinc-700 hover:border-zinc-600 text-zinc-300 transition-colors duration-150 flex items-center justify-center gap-1.5 focus:ring-2 focus:ring-blue-500 focus:outline-none"
          aria-label="Analyze current scene physics feel"
        >
          <Search className="w-3.5 h-3.5" /> Analyze Current Scene
        </button>
        {analysis && (
          <div className="mt-2 p-2 bg-zinc-800/50 rounded text-xs space-y-1">
            <div>
              <span className="text-zinc-500">Closest feel: </span>
              <span className="text-blue-300 font-medium">{analysis.currentFeel}</span>
            </div>
            <div>
              <span className="text-zinc-500">Similarity: </span>
              <span className="text-zinc-300">{Math.round(analysis.similarity * 100)}%</span>
            </div>
            {analysis.suggestions.length > 0 && (
              <div className="mt-1 space-y-1">
                {analysis.suggestions.map((s, i) => (
                  <p key={i} className="text-zinc-400 text-xs">{s}</p>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Custom Feel via AI */}
      <div className="border-t border-zinc-800 pt-3">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="w-3.5 h-3.5 text-yellow-400" />
          <label className="text-xs text-zinc-500">Custom Feel</label>
        </div>
        <div className="flex gap-1.5">
          <input
            type="text"
            value={customDescription}
            onChange={(e) => setCustomDescription(e.target.value)}
            placeholder="e.g. 'floaty moon gravity with tight controls'"
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-300 placeholder-zinc-600 focus:ring-2 focus:ring-blue-500 focus:outline-none"
            aria-label="Describe a custom physics feel"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCustomGenerate();
            }}
          />
          <button
            type="button"
            onClick={handleCustomGenerate}
            disabled={!customDescription.trim()}
            className="px-3 py-1.5 rounded text-xs font-medium bg-yellow-600/30 border border-yellow-500/50 text-yellow-300 hover:bg-yellow-600/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-150 focus:ring-2 focus:ring-yellow-500 focus:outline-none"
            aria-label="Generate custom physics feel from description"
          >
            Generate
          </button>
        </div>
      </div>
    </div>
  );
}
