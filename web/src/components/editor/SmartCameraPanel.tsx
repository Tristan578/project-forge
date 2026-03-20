'use client';

import { useState, useCallback, useMemo } from 'react';
import { Camera, Sparkles, SlidersHorizontal } from 'lucide-react';
import { useEditorStore } from '@/stores/editorStore';
import type { GameCameraData } from '@/stores/slices/types';
import {
  CAMERA_PRESETS,
  PRESET_KEYS,
  detectOptimalCamera,
  smartModeToEngine,
  interpolatePresets,
  type CameraPreset,
  type SmartCameraSceneContext,
} from '@/lib/ai/smartCamera';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildSceneContext(): SmartCameraSceneContext {
  const state = useEditorStore.getState();
  const graph = state.sceneGraph;
  const entityNames: string[] = [];
  const componentTypes: string[] = [];

  for (const node of Object.values(graph.nodes)) {
    entityNames.push(node.name);
    for (const comp of node.components) {
      componentTypes.push(comp);
    }
  }

  const gameCameraModes: string[] = [];
  const cams = state.allGameCameras ?? {};
  for (const cam of Object.values(cams)) {
    gameCameraModes.push(cam.mode);
  }

  const gameComponentTypes: string[] = [];
  const allGC = state.allGameComponents ?? {};
  for (const comps of Object.values(allGC)) {
    for (const comp of comps) {
      gameComponentTypes.push(comp.type);
    }
  }

  const rawType = state.projectType;
  const projectType: '2d' | '3d' = rawType === '2d' ? '2d' : '3d';

  return { entityNames, componentTypes, gameCameraModes, gameComponentTypes, projectType };
}

const GENRE_DESCRIPTIONS: Record<string, string> = {
  platformer_2d: 'Side-scrolling with look-ahead and vertical dead zone. Great for 2D platformers.',
  platformer_3d: 'Third-person follow with medium distance. Ideal for 3D platformers.',
  fps_shooter: 'First-person with narrow FOV and recoil shake. Designed for shooters.',
  rpg_exploration: 'Orbital camera with long distance and slow follow. Perfect for RPGs.',
  top_down_strategy: 'Fixed overhead view with zoom. Built for strategy and RTS games.',
  racing: 'Behind-vehicle follow with speed-based FOV widening. Made for racing.',
  puzzle: 'Fixed isometric view with click-to-pan. Clean view for puzzle games.',
  horror: 'Close follow with narrow FOV and heavy shake. Tense atmosphere for horror.',
};

// ---------------------------------------------------------------------------
// Preset card
// ---------------------------------------------------------------------------

function PresetCard({
  presetKey,
  preset,
  isSelected,
  isRecommended,
  onSelect,
}: {
  presetKey: string;
  preset: CameraPreset;
  isSelected: boolean;
  isRecommended: boolean;
  onSelect: (key: string) => void;
}) {
  return (
    <button
      onClick={() => onSelect(presetKey)}
      className={`w-full rounded border p-2 text-left transition-colors ${
        isSelected
          ? 'border-blue-500 bg-blue-500/10'
          : 'border-zinc-700 bg-zinc-800 hover:border-zinc-600'
      }`}
      aria-label={`Select ${preset.name} camera preset`}
      aria-pressed={isSelected}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-zinc-200">{preset.name}</span>
        <div className="flex items-center gap-1">
          {isRecommended && (
            <span className="rounded bg-green-500/20 px-1.5 py-0.5 text-[10px] text-green-400">
              Recommended
            </span>
          )}
          <span className="rounded bg-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-400">
            {preset.mode.replace('_', ' ')}
          </span>
        </div>
      </div>
      <p className="mt-1 text-[10px] text-zinc-500">
        {GENRE_DESCRIPTIONS[presetKey] ?? ''}
      </p>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Slider row
// ---------------------------------------------------------------------------

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="w-24 shrink-0 text-[10px] text-zinc-400">{label}</label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="flex-1 accent-blue-500"
        aria-label={label}
      />
      <span className="w-10 text-right text-[10px] text-zinc-400">{value.toFixed(1)}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

/** Convert a CameraPreset to a GameCameraData object. */
function presetToGameCameraData(preset: CameraPreset): GameCameraData {
  const engineMode = smartModeToEngine(preset.mode);
  const data: GameCameraData = { mode: engineMode, targetEntity: null };

  switch (engineMode) {
    case 'thirdPersonFollow':
      data.followDistance = preset.followDistance;
      data.followHeight = preset.followHeight;
      data.followLookAhead = preset.lookAhead;
      data.followSmoothing = preset.followSmoothing;
      break;
    case 'firstPerson':
      data.firstPersonHeight = preset.followHeight;
      data.firstPersonMouseSensitivity = 2;
      break;
    case 'sideScroller':
      data.sideScrollerDistance = preset.followDistance;
      data.sideScrollerHeight = preset.followHeight;
      break;
    case 'topDown':
      data.topDownHeight = preset.followHeight;
      data.topDownAngle = 60;
      break;
    case 'orbital':
      data.orbitalDistance = preset.followDistance;
      data.orbitalAutoRotateSpeed = 0;
      break;
    case 'fixed':
      break;
  }

  return data;
}

export function SmartCameraPanel() {
  const primaryId = useEditorStore((s) => s.primaryId);
  const setGameCamera = useEditorStore((s) => s.setGameCamera);
  const setActiveGameCamera = useEditorStore((s) => s.setActiveGameCamera);
  const sceneGraph = useEditorStore((s) => s.sceneGraph);

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [customPreset, setCustomPreset] = useState<CameraPreset | null>(null);
  const [showSliders, setShowSliders] = useState(false);
  const [blendFactor, setBlendFactor] = useState(0);
  const [blendTargetKey, setBlendTargetKey] = useState<string | null>(null);

  // Re-detect recommended preset when scene changes
  const recommended = useMemo(() => {
    const entityNames: string[] = [];
    const componentTypes: string[] = [];
    for (const node of Object.values(sceneGraph.nodes)) {
      entityNames.push(node.name);
      for (const comp of node.components) {
        componentTypes.push(comp);
      }
    }
    const state = useEditorStore.getState();
    const gameCameraModes: string[] = [];
    for (const cam of Object.values(state.allGameCameras ?? {})) {
      gameCameraModes.push(cam.mode);
    }
    const gameComponentTypes: string[] = [];
    for (const comps of Object.values(state.allGameComponents ?? {})) {
      for (const comp of comps) {
        gameComponentTypes.push(comp.type);
      }
    }
    const rawType = state.projectType;
    const projectType: '2d' | '3d' = rawType === '2d' ? '2d' : '3d';
    const ctx: SmartCameraSceneContext = { entityNames, componentTypes, gameCameraModes, gameComponentTypes, projectType };
    return detectOptimalCamera(ctx);
  }, [sceneGraph]);

  const activePreset = customPreset ?? (selectedKey ? CAMERA_PRESETS[selectedKey] : null);

  const handleSelectPreset = useCallback((key: string) => {
    setSelectedKey(key);
    setCustomPreset(null);
    setBlendFactor(0);
    setBlendTargetKey(null);
  }, []);

  const handleApply = useCallback(() => {
    if (!primaryId || !activePreset) return;
    const gameCameraData = presetToGameCameraData(activePreset);
    setGameCamera(primaryId, gameCameraData);
    setActiveGameCamera(primaryId);
  }, [primaryId, activePreset, setGameCamera, setActiveGameCamera]);

  const handleAutoDetect = useCallback(() => {
    const ctx = buildSceneContext();
    const detected = detectOptimalCamera(ctx);
    const matchKey = PRESET_KEYS.find((k) => CAMERA_PRESETS[k].genre === detected.genre) ?? null;
    setSelectedKey(matchKey);
    setCustomPreset(null);
  }, []);

  const handleSliderChange = useCallback(
    (field: keyof CameraPreset, value: number) => {
      const base = activePreset ?? recommended;
      setCustomPreset({ ...base, [field]: value });
    },
    [activePreset, recommended],
  );

  const handleDeadZoneChange = useCallback(
    (axis: 'x' | 'y', value: number) => {
      const base = activePreset ?? recommended;
      setCustomPreset({ ...base, deadZone: { ...base.deadZone, [axis]: value } });
    },
    [activePreset, recommended],
  );

  const handleBlend = useCallback(() => {
    if (!selectedKey || !blendTargetKey) return;
    const a = CAMERA_PRESETS[selectedKey];
    const b = CAMERA_PRESETS[blendTargetKey];
    const blended = interpolatePresets(a, b, blendFactor);
    setCustomPreset(blended);
  }, [selectedKey, blendTargetKey, blendFactor]);

  const current = activePreset ?? recommended;

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-zinc-900 text-zinc-200">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
        <div className="flex items-center gap-1.5">
          <Camera className="h-3.5 w-3.5 text-blue-400" />
          <span className="text-xs font-semibold">Smart Camera</span>
        </div>
        <button
          onClick={handleAutoDetect}
          className="flex items-center gap-1 rounded bg-green-600/20 px-2 py-0.5 text-[10px] text-green-400 hover:bg-green-600/30 transition-colors"
          aria-label="Auto-detect optimal camera preset"
        >
          <Sparkles className="h-3 w-3" />
          Auto-Detect
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {/* Preset gallery */}
        <div>
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Genre Presets
          </h3>
          <div className="space-y-1.5">
            {PRESET_KEYS.map((key) => (
              <PresetCard
                key={key}
                presetKey={key}
                preset={CAMERA_PRESETS[key]}
                isSelected={selectedKey === key}
                isRecommended={CAMERA_PRESETS[key].genre === recommended.genre}
                onSelect={handleSelectPreset}
              />
            ))}
          </div>
        </div>

        {/* Parameter sliders (collapsible) */}
        <div>
          <button
            onClick={() => setShowSliders((s) => !s)}
            className="flex w-full items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 hover:text-zinc-400 transition-colors"
            aria-expanded={showSliders}
          >
            <SlidersHorizontal className="h-3 w-3" />
            Parameters
            <span className="ml-auto text-zinc-600">{showSliders ? '−' : '+'}</span>
          </button>

          {showSliders && (
            <div className="mt-2 space-y-1.5">
              <SliderRow label="FOV" value={current.fov} min={30} max={120} step={1} onChange={(v) => handleSliderChange('fov', v)} />
              <SliderRow label="Follow Dist" value={current.followDistance} min={0} max={30} step={0.5} onChange={(v) => handleSliderChange('followDistance', v)} />
              <SliderRow label="Follow Height" value={current.followHeight} min={0} max={25} step={0.5} onChange={(v) => handleSliderChange('followHeight', v)} />
              <SliderRow label="Smoothing" value={current.followSmoothing} min={0} max={15} step={0.5} onChange={(v) => handleSliderChange('followSmoothing', v)} />
              <SliderRow label="Look Ahead" value={current.lookAhead} min={0} max={5} step={0.1} onChange={(v) => handleSliderChange('lookAhead', v)} />
              <SliderRow label="Dead Zone X" value={current.deadZone.x} min={0} max={1} step={0.05} onChange={(v) => handleDeadZoneChange('x', v)} />
              <SliderRow label="Dead Zone Y" value={current.deadZone.y} min={0} max={1} step={0.05} onChange={(v) => handleDeadZoneChange('y', v)} />
            </div>
          )}
        </div>

        {/* Blend section */}
        {selectedKey && (
          <div>
            <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Blend Presets
            </h3>
            <div className="space-y-1.5">
              <select
                value={blendTargetKey ?? ''}
                onChange={(e) => setBlendTargetKey(e.target.value || null)}
                className="w-full rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none focus:ring-1 focus:ring-blue-500"
                aria-label="Select blend target preset"
              >
                <option value="">Select target...</option>
                {PRESET_KEYS.filter((k) => k !== selectedKey).map((k) => (
                  <option key={k} value={k}>{CAMERA_PRESETS[k].name}</option>
                ))}
              </select>

              {blendTargetKey && (
                <>
                  <SliderRow
                    label="Blend"
                    value={blendFactor}
                    min={0}
                    max={1}
                    step={0.05}
                    onChange={(v) => setBlendFactor(v)}
                  />
                  <button
                    onClick={handleBlend}
                    className="w-full rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-300 transition-colors"
                  >
                    Apply Blend
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Live preview description */}
        {current && (
          <div className="rounded border border-zinc-800 bg-zinc-800/50 p-2">
            <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Preview
            </h3>
            <div className="space-y-0.5 text-[10px] text-zinc-400">
              <p><span className="text-zinc-300">Mode:</span> {current.mode.replace('_', ' ')}</p>
              <p><span className="text-zinc-300">FOV:</span> {current.fov.toFixed(0)}</p>
              <p><span className="text-zinc-300">Distance:</span> {current.followDistance.toFixed(1)}</p>
              <p><span className="text-zinc-300">Height:</span> {current.followHeight.toFixed(1)}</p>
              <p><span className="text-zinc-300">Smoothing:</span> {current.followSmoothing.toFixed(1)}</p>
              <p><span className="text-zinc-300">Look Ahead:</span> {current.lookAhead.toFixed(1)}</p>
              <p><span className="text-zinc-300">Dead Zone:</span> {current.deadZone.x.toFixed(2)} x {current.deadZone.y.toFixed(2)}</p>
              <p><span className="text-zinc-300">Shake:</span> {current.shake.enabled ? `trauma ${current.shake.trauma.toFixed(2)}, decay ${current.shake.decay.toFixed(1)}` : 'off'}</p>
            </div>
          </div>
        )}
      </div>

      {/* Apply button */}
      <div className="border-t border-zinc-800 p-3">
        <button
          onClick={handleApply}
          disabled={!primaryId || !activePreset}
          className="w-full rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus:ring-2 focus:ring-blue-500"
          aria-label="Apply camera preset to selected entity"
        >
          Apply to Selected Entity
        </button>
        {!primaryId && (
          <p className="mt-1 text-center text-[10px] text-zinc-600">
            Select an entity to apply a camera preset
          </p>
        )}
      </div>
    </div>
  );
}
