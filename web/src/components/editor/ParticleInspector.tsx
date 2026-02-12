'use client';

import { useCallback } from 'react';
import { useEditorStore, type ParticleData, type ParticlePreset, type EmissionShape, type GradientStop } from '@/stores/editorStore';
import { Play, StopCircle, Zap, Trash2, Plus, Minus } from 'lucide-react';

interface SliderRowProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  precision?: number;
  onChange: (v: number) => void;
}

function SliderRow({ label, value, min = 0, max = 1, step = 0.01, precision = 2, onChange }: SliderRowProps) {
  return (
    <div className="flex items-center gap-2">
      <label className="w-24 shrink-0 text-xs text-zinc-400">{label}</label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="h-1 flex-1 cursor-pointer appearance-none rounded bg-zinc-700
          [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3
          [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full
          [&::-webkit-slider-thumb]:bg-zinc-300"
      />
      <span className="w-12 text-right text-xs tabular-nums text-zinc-500">
        {value.toFixed(precision)}
      </span>
    </div>
  );
}

interface CheckboxRowProps {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}

function CheckboxRow({ label, checked, onChange }: CheckboxRowProps) {
  return (
    <div className="flex items-center gap-2">
      <label className="w-24 shrink-0 text-xs text-zinc-400">{label}</label>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 rounded border-zinc-600 bg-zinc-800 text-blue-500
          focus:ring-1 focus:ring-blue-500 focus:ring-offset-0"
      />
    </div>
  );
}

interface Vec3InputRowProps {
  label: string;
  value: [number, number, number];
  onChange: (v: [number, number, number]) => void;
  step?: number;
}

function Vec3InputRow({ label, value, onChange, step = 0.1 }: Vec3InputRowProps) {
  return (
    <div className="space-y-1">
      <label className="block text-xs text-zinc-400">{label}</label>
      <div className="grid grid-cols-3 gap-2">
        <input
          type="number"
          value={value[0]}
          step={step}
          onChange={(e) => onChange([parseFloat(e.target.value), value[1], value[2]])}
          className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none
            focus:ring-1 focus:ring-blue-500"
        />
        <input
          type="number"
          value={value[1]}
          step={step}
          onChange={(e) => onChange([value[0], parseFloat(e.target.value), value[2]])}
          className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none
            focus:ring-1 focus:ring-blue-500"
        />
        <input
          type="number"
          value={value[2]}
          step={step}
          onChange={(e) => onChange([value[0], value[1], parseFloat(e.target.value)])}
          className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none
            focus:ring-1 focus:ring-blue-500"
        />
      </div>
    </div>
  );
}

export function ParticleInspector() {
  const primaryId = useEditorStore((s) => s.primaryId);
  const primaryParticle = useEditorStore((s) => s.primaryParticle);
  const particleEnabled = useEditorStore((s) => s.particleEnabled);
  const setParticle = useEditorStore((s) => s.setParticle);
  const removeParticle = useEditorStore((s) => s.removeParticle);
  const toggleParticle = useEditorStore((s) => s.toggleParticle);
  const setParticlePreset = useEditorStore((s) => s.setParticlePreset);
  const playParticle = useEditorStore((s) => s.playParticle);
  const stopParticle = useEditorStore((s) => s.stopParticle);
  const burstParticle = useEditorStore((s) => s.burstParticle);

  const handleUpdate = useCallback(
    (partial: Partial<ParticleData>) => {
      if (primaryId) {
        setParticle(primaryId, partial);
      }
    },
    [primaryId, setParticle]
  );

  const handleAddParticles = useCallback(() => {
    if (primaryId) {
      setParticlePreset(primaryId, 'fire');
    }
  }, [primaryId, setParticlePreset]);

  const handleRemoveParticles = useCallback(() => {
    if (primaryId) {
      removeParticle(primaryId);
    }
  }, [primaryId, removeParticle]);

  const handlePresetChange = useCallback(
    (preset: ParticlePreset) => {
      if (primaryId) {
        setParticlePreset(primaryId, preset);
      }
    },
    [primaryId, setParticlePreset]
  );

  const handleToggle = useCallback(() => {
    if (primaryId) {
      toggleParticle(primaryId, !particleEnabled);
    }
  }, [primaryId, particleEnabled, toggleParticle]);

  const handlePlay = useCallback(() => {
    if (primaryId) {
      playParticle(primaryId);
    }
  }, [primaryId, playParticle]);

  const handleStop = useCallback(() => {
    if (primaryId) {
      stopParticle(primaryId);
    }
  }, [primaryId, stopParticle]);

  const handleBurst = useCallback(() => {
    if (primaryId) {
      burstParticle(primaryId, 100);
    }
  }, [primaryId, burstParticle]);

  const handleSpawnerModeChange = useCallback(
    (type: 'continuous' | 'burst' | 'once') => {
      if (type === 'continuous') {
        handleUpdate({ spawnerMode: { type, rate: 50 } });
      } else {
        handleUpdate({ spawnerMode: { type, count: 100 } });
      }
    },
    [handleUpdate]
  );

  const handleSpawnerValueChange = useCallback(
    (value: number) => {
      if (!primaryParticle?.spawnerMode) return;
      const mode = primaryParticle.spawnerMode;
      if (mode.type === 'continuous') {
        handleUpdate({ spawnerMode: { type: 'continuous', rate: value } });
      } else {
        handleUpdate({ spawnerMode: { ...mode, count: value } });
      }
    },
    [primaryParticle, handleUpdate]
  );

  const handleEmissionShapeChange = useCallback(
    (type: EmissionShape['type']) => {
      switch (type) {
        case 'point':
          handleUpdate({ emissionShape: { type } });
          break;
        case 'sphere':
          handleUpdate({ emissionShape: { type, radius: 0.5 } });
          break;
        case 'cone':
          handleUpdate({ emissionShape: { type, radius: 0.5, height: 1.0 } });
          break;
        case 'box':
          handleUpdate({ emissionShape: { type, halfExtents: [0.5, 0.5, 0.5] } });
          break;
        case 'circle':
          handleUpdate({ emissionShape: { type, radius: 0.5 } });
          break;
      }
    },
    [handleUpdate]
  );

  const handleAddGradientStop = useCallback(() => {
    if (!primaryParticle) return;
    const newStop: GradientStop = {
      position: 0.5,
      color: [1, 1, 1, 1],
    };
    const newGradient = [...primaryParticle.colorGradient, newStop].sort((a, b) => a.position - b.position);
    handleUpdate({ colorGradient: newGradient });
  }, [primaryParticle, handleUpdate]);

  const handleRemoveGradientStop = useCallback(
    (index: number) => {
      if (!primaryParticle || primaryParticle.colorGradient.length <= 2) return;
      const newGradient = primaryParticle.colorGradient.filter((_, i) => i !== index);
      handleUpdate({ colorGradient: newGradient });
    },
    [primaryParticle, handleUpdate]
  );

  const handleUpdateGradientStop = useCallback(
    (index: number, updates: Partial<GradientStop>) => {
      if (!primaryParticle) return;
      const newGradient = primaryParticle.colorGradient.map((stop, i) =>
        i === index ? { ...stop, ...updates } : stop
      );
      handleUpdate({ colorGradient: newGradient });
    },
    [primaryParticle, handleUpdate]
  );

  return (
    <div className="border-t border-zinc-800 pt-4 mt-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        Particles
      </h3>

      {!primaryParticle ? (
        <button
          onClick={handleAddParticles}
          className="w-full rounded bg-zinc-800 px-2 py-1.5 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-300"
        >
          Add Particles
        </button>
      ) : (
        <div className="space-y-3">
          {/* Preset Dropdown */}
          <div className="flex items-center gap-2">
            <label className="w-24 shrink-0 text-xs text-zinc-400">Preset</label>
            <select
              value={primaryParticle.preset}
              onChange={(e) => handlePresetChange(e.target.value as ParticlePreset)}
              className="flex-1 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none
                focus:ring-1 focus:ring-blue-500"
            >
              <option value="fire">Fire</option>
              <option value="smoke">Smoke</option>
              <option value="sparks">Sparks</option>
              <option value="rain">Rain</option>
              <option value="snow">Snow</option>
              <option value="explosion">Explosion</option>
              <option value="magic_sparkle">Magic Sparkle</option>
              <option value="dust">Dust</option>
              <option value="trail">Trail</option>
              <option value="custom">Custom</option>
            </select>
          </div>

          {/* Enable/Disable Toggle */}
          <CheckboxRow label="Enabled" checked={particleEnabled} onChange={handleToggle} />

          {/* Spawner Section */}
          <div className="border-t border-zinc-700 pt-3 space-y-2">
            <h4 className="text-[10px] font-semibold uppercase tracking-wide text-zinc-600">Spawner</h4>
            <div className="flex items-center gap-2">
              <label className="w-24 shrink-0 text-xs text-zinc-400">Mode</label>
              <select
                value={primaryParticle.spawnerMode.type}
                onChange={(e) => handleSpawnerModeChange(e.target.value as 'continuous' | 'burst' | 'once')}
                className="flex-1 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none
                  focus:ring-1 focus:ring-blue-500"
              >
                <option value="continuous">Continuous</option>
                <option value="burst">Burst</option>
                <option value="once">Once</option>
              </select>
            </div>
            {primaryParticle.spawnerMode.type === 'continuous' ? (
              <SliderRow
                label="Rate"
                value={primaryParticle.spawnerMode.rate}
                min={1}
                max={500}
                step={1}
                precision={0}
                onChange={handleSpawnerValueChange}
              />
            ) : (
              <SliderRow
                label="Count"
                value={primaryParticle.spawnerMode.count}
                min={1}
                max={500}
                step={1}
                precision={0}
                onChange={handleSpawnerValueChange}
              />
            )}
            <SliderRow
              label="Max Particles"
              value={primaryParticle.maxParticles}
              min={100}
              max={50000}
              step={100}
              precision={0}
              onChange={(v) => handleUpdate({ maxParticles: v })}
            />
          </div>

          {/* Lifetime Section */}
          <div className="border-t border-zinc-700 pt-3 space-y-2">
            <h4 className="text-[10px] font-semibold uppercase tracking-wide text-zinc-600">Lifetime</h4>
            <SliderRow
              label="Min (s)"
              value={primaryParticle.lifetimeMin}
              min={0.1}
              max={30}
              step={0.1}
              precision={1}
              onChange={(v) => handleUpdate({ lifetimeMin: v })}
            />
            <SliderRow
              label="Max (s)"
              value={primaryParticle.lifetimeMax}
              min={0.1}
              max={30}
              step={0.1}
              precision={1}
              onChange={(v) => handleUpdate({ lifetimeMax: v })}
            />
          </div>

          {/* Emission Shape Section */}
          <div className="border-t border-zinc-700 pt-3 space-y-2">
            <h4 className="text-[10px] font-semibold uppercase tracking-wide text-zinc-600">Emission Shape</h4>
            <div className="flex items-center gap-2">
              <label className="w-24 shrink-0 text-xs text-zinc-400">Shape</label>
              <select
                value={primaryParticle.emissionShape.type}
                onChange={(e) => handleEmissionShapeChange(e.target.value as EmissionShape['type'])}
                className="flex-1 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none
                  focus:ring-1 focus:ring-blue-500"
              >
                <option value="point">Point</option>
                <option value="sphere">Sphere</option>
                <option value="cone">Cone</option>
                <option value="box">Box</option>
                <option value="circle">Circle</option>
              </select>
            </div>
            {primaryParticle.emissionShape.type === 'sphere' && (
              <SliderRow
                label="Radius"
                value={primaryParticle.emissionShape.radius}
                min={0.1}
                max={10}
                step={0.1}
                precision={1}
                onChange={(v) => handleUpdate({ emissionShape: { type: 'sphere', radius: v } })}
              />
            )}
            {primaryParticle.emissionShape.type === 'cone' && (
              <>
                <SliderRow
                  label="Radius"
                  value={primaryParticle.emissionShape.radius}
                  min={0.1}
                  max={10}
                  step={0.1}
                  precision={1}
                  onChange={(v) =>
                    handleUpdate({
                      emissionShape: {
                        type: 'cone',
                        radius: v,
                        height: primaryParticle.emissionShape.type === 'cone' ? primaryParticle.emissionShape.height : 1,
                      },
                    })
                  }
                />
                <SliderRow
                  label="Height"
                  value={primaryParticle.emissionShape.height}
                  min={0.1}
                  max={10}
                  step={0.1}
                  precision={1}
                  onChange={(v) =>
                    handleUpdate({
                      emissionShape: {
                        type: 'cone',
                        radius: primaryParticle.emissionShape.type === 'cone' ? primaryParticle.emissionShape.radius : 0.5,
                        height: v,
                      },
                    })
                  }
                />
              </>
            )}
            {primaryParticle.emissionShape.type === 'box' && (
              <Vec3InputRow
                label="Half Extents"
                value={primaryParticle.emissionShape.halfExtents}
                onChange={(v) => handleUpdate({ emissionShape: { type: 'box', halfExtents: v } })}
                step={0.1}
              />
            )}
            {primaryParticle.emissionShape.type === 'circle' && (
              <SliderRow
                label="Radius"
                value={primaryParticle.emissionShape.radius}
                min={0.1}
                max={10}
                step={0.1}
                precision={1}
                onChange={(v) => handleUpdate({ emissionShape: { type: 'circle', radius: v } })}
              />
            )}
          </div>

          {/* Velocity Section */}
          <div className="border-t border-zinc-700 pt-3 space-y-2">
            <h4 className="text-[10px] font-semibold uppercase tracking-wide text-zinc-600">Velocity</h4>
            <Vec3InputRow
              label="Min"
              value={primaryParticle.velocityMin}
              onChange={(v) => handleUpdate({ velocityMin: v })}
              step={0.1}
            />
            <Vec3InputRow
              label="Max"
              value={primaryParticle.velocityMax}
              onChange={(v) => handleUpdate({ velocityMax: v })}
              step={0.1}
            />
          </div>

          {/* Forces Section */}
          <div className="border-t border-zinc-700 pt-3 space-y-2">
            <h4 className="text-[10px] font-semibold uppercase tracking-wide text-zinc-600">Forces</h4>
            <Vec3InputRow
              label="Acceleration"
              value={primaryParticle.acceleration}
              onChange={(v) => handleUpdate({ acceleration: v })}
              step={0.1}
            />
            <SliderRow
              label="Linear Drag"
              value={primaryParticle.linearDrag}
              min={0}
              max={10}
              step={0.1}
              precision={1}
              onChange={(v) => handleUpdate({ linearDrag: v })}
            />
          </div>

          {/* Size Section */}
          <div className="border-t border-zinc-700 pt-3 space-y-2">
            <h4 className="text-[10px] font-semibold uppercase tracking-wide text-zinc-600">Size</h4>
            <SliderRow
              label="Start Size"
              value={primaryParticle.sizeStart}
              min={0.001}
              max={5}
              step={0.01}
              precision={2}
              onChange={(v) => handleUpdate({ sizeStart: v })}
            />
            <SliderRow
              label="End Size"
              value={primaryParticle.sizeEnd}
              min={0}
              max={5}
              step={0.01}
              precision={2}
              onChange={(v) => handleUpdate({ sizeEnd: v })}
            />
          </div>

          {/* Color Gradient Section */}
          <div className="border-t border-zinc-700 pt-3 space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-[10px] font-semibold uppercase tracking-wide text-zinc-600">Color Gradient</h4>
              <button
                onClick={handleAddGradientStop}
                className="rounded bg-zinc-700 p-1 text-zinc-400 hover:bg-zinc-600 hover:text-zinc-200"
                title="Add stop"
              >
                <Plus className="h-3 w-3" />
              </button>
            </div>
            {primaryParticle.colorGradient.map((stop, index) => (
              <div key={index} className="space-y-1 rounded bg-zinc-800/50 p-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-zinc-500">Stop {index + 1}</span>
                  {primaryParticle.colorGradient.length > 2 && (
                    <button
                      onClick={() => handleRemoveGradientStop(index)}
                      className="rounded p-0.5 text-zinc-500 hover:bg-zinc-700 hover:text-red-400"
                      title="Remove stop"
                    >
                      <Minus className="h-3 w-3" />
                    </button>
                  )}
                </div>
                <SliderRow
                  label="Position"
                  value={stop.position}
                  min={0}
                  max={1}
                  step={0.01}
                  precision={2}
                  onChange={(v) => handleUpdateGradientStop(index, { position: v })}
                />
                <div className="space-y-1">
                  <label className="block text-[10px] text-zinc-500">Color (RGBA)</label>
                  <div className="grid grid-cols-4 gap-1">
                    {[0, 1, 2, 3].map((i) => (
                      <input
                        key={i}
                        type="number"
                        value={stop.color[i]}
                        min={0}
                        max={1}
                        step={0.01}
                        onChange={(e) => {
                          const newColor: [number, number, number, number] = [...stop.color];
                          newColor[i] = parseFloat(e.target.value);
                          handleUpdateGradientStop(index, { color: newColor });
                        }}
                        className="rounded bg-zinc-800 px-1 py-0.5 text-[10px] text-zinc-200 outline-none
                          focus:ring-1 focus:ring-blue-500"
                      />
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Rendering Section */}
          <div className="border-t border-zinc-700 pt-3 space-y-2">
            <h4 className="text-[10px] font-semibold uppercase tracking-wide text-zinc-600">Rendering</h4>
            <div className="flex items-center gap-2">
              <label className="w-24 shrink-0 text-xs text-zinc-400">Blend Mode</label>
              <select
                value={primaryParticle.blendMode}
                onChange={(e) => handleUpdate({ blendMode: e.target.value as 'additive' | 'alpha_blend' | 'premultiply' })}
                className="flex-1 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none
                  focus:ring-1 focus:ring-blue-500"
              >
                <option value="additive">Additive</option>
                <option value="alpha_blend">Alpha Blend</option>
                <option value="premultiply">Premultiply</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="w-24 shrink-0 text-xs text-zinc-400">Orientation</label>
              <select
                value={primaryParticle.orientation}
                onChange={(e) => handleUpdate({ orientation: e.target.value as 'billboard' | 'velocity_aligned' | 'fixed' })}
                className="flex-1 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none
                  focus:ring-1 focus:ring-blue-500"
              >
                <option value="billboard">Billboard</option>
                <option value="velocity_aligned">Velocity Aligned</option>
                <option value="fixed">Fixed</option>
              </select>
            </div>
            <CheckboxRow label="World Space" checked={primaryParticle.worldSpace} onChange={(v) => handleUpdate({ worldSpace: v })} />
          </div>

          {/* Playback Controls */}
          <div className="flex gap-2 pt-2">
            <button
              onClick={handlePlay}
              className="flex flex-1 items-center justify-center gap-1.5 rounded bg-green-900/30 px-2 py-1.5 text-xs text-green-400 hover:bg-green-900/50"
            >
              <Play size={12} />
              Play
            </button>
            <button
              onClick={handleStop}
              className="flex flex-1 items-center justify-center gap-1.5 rounded bg-zinc-800 px-2 py-1.5 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-300"
            >
              <StopCircle size={12} />
              Stop
            </button>
            <button
              onClick={handleBurst}
              className="flex flex-1 items-center justify-center gap-1.5 rounded bg-amber-900/30 px-2 py-1.5 text-xs text-amber-400 hover:bg-amber-900/50"
            >
              <Zap size={12} />
              Burst
            </button>
          </div>

          {/* Remove Particles */}
          <button
            onClick={handleRemoveParticles}
            className="w-full rounded bg-zinc-800 px-2 py-1.5 text-xs text-red-400 hover:bg-zinc-700"
          >
            <Trash2 className="inline h-3 w-3 mr-1" />
            Remove Particles
          </button>
        </div>
      )}
    </div>
  );
}
