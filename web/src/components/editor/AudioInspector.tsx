'use client';

import { useCallback } from 'react';
import { useEditorStore, type AudioData } from '@/stores/editorStore';
import { Play, StopCircle } from 'lucide-react';

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

interface NumberInputRowProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
}

function NumberInputRow({ label, value, min, max, step = 0.1, onChange }: NumberInputRowProps) {
  return (
    <div className="flex items-center gap-2">
      <label className="w-24 shrink-0 text-xs text-zinc-400">{label}</label>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="flex-1 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none
          focus:ring-1 focus:ring-blue-500"
      />
    </div>
  );
}

export function AudioInspector() {
  const primaryId = useEditorStore((s) => s.primaryId);
  const primaryAudio = useEditorStore((s) => s.primaryAudio);
  const assetRegistry = useEditorStore((s) => s.assetRegistry);
  const audioBuses = useEditorStore((s) => s.audioBuses);
  const setAudio = useEditorStore((s) => s.setAudio);
  const removeAudio = useEditorStore((s) => s.removeAudio);
  const playAudio = useEditorStore((s) => s.playAudio);
  const stopAudio = useEditorStore((s) => s.stopAudio);

  const audioAssets = Object.values(assetRegistry).filter((a) => a.kind === 'audio');

  const handleUpdate = useCallback(
    (partial: Partial<AudioData>) => {
      if (primaryId) {
        setAudio(primaryId, partial);
      }
    },
    [primaryId, setAudio]
  );

  const handleAddAudio = useCallback(() => {
    if (primaryId) {
      setAudio(primaryId, {
        assetId: null,
        volume: 1.0,
        pitch: 1.0,
        loopAudio: false,
        spatial: false,
        maxDistance: 50,
        refDistance: 1,
        rolloffFactor: 1,
        autoplay: false,
      });
    }
  }, [primaryId, setAudio]);

  const handleRemoveAudio = useCallback(() => {
    if (primaryId) {
      removeAudio(primaryId);
    }
  }, [primaryId, removeAudio]);

  const handlePlay = useCallback(() => {
    if (primaryId) {
      playAudio(primaryId);
    }
  }, [primaryId, playAudio]);

  const handleStop = useCallback(() => {
    if (primaryId) {
      stopAudio(primaryId);
    }
  }, [primaryId, stopAudio]);

  return (
    <div className="border-t border-zinc-800 pt-4 mt-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        Audio
      </h3>

      {!primaryAudio ? (
        <button
          onClick={handleAddAudio}
          className="w-full rounded bg-zinc-800 px-2 py-1.5 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-300"
        >
          Add Audio
        </button>
      ) : (
        <div className="space-y-3">
          {/* Asset Dropdown */}
          <div className="flex items-center gap-2">
            <label className="w-24 shrink-0 text-xs text-zinc-400">Asset</label>
            <select
              value={primaryAudio.assetId ?? ''}
              onChange={(e) => handleUpdate({ assetId: e.target.value || null })}
              className="flex-1 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none
                focus:ring-1 focus:ring-blue-500"
            >
              <option value="">None</option>
              {audioAssets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.name}
                </option>
              ))}
            </select>
          </div>

          {/* Bus Assignment */}
          <div className="flex items-center gap-2">
            <label className="w-24 shrink-0 text-xs text-zinc-400">Bus</label>
            <select
              value={primaryAudio.bus ?? 'sfx'}
              onChange={(e) => handleUpdate({ bus: e.target.value })}
              className="flex-1 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none
                focus:ring-1 focus:ring-blue-500"
            >
              {audioBuses.filter((b) => b.name !== 'master').map((bus) => (
                <option key={bus.name} value={bus.name}>
                  {bus.name}
                </option>
              ))}
            </select>
          </div>

          {/* Volume */}
          <SliderRow
            label="Volume"
            value={primaryAudio.volume}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => handleUpdate({ volume: v })}
          />

          {/* Pitch */}
          <SliderRow
            label="Pitch"
            value={primaryAudio.pitch}
            min={0.25}
            max={4}
            step={0.05}
            onChange={(v) => handleUpdate({ pitch: v })}
          />

          {/* Loop */}
          <CheckboxRow
            label="Loop"
            checked={primaryAudio.loopAudio}
            onChange={(v) => handleUpdate({ loopAudio: v })}
          />

          {/* Spatial */}
          <CheckboxRow
            label="Spatial"
            checked={primaryAudio.spatial}
            onChange={(v) => handleUpdate({ spatial: v })}
          />

          {/* Spatial Settings (conditional) */}
          {primaryAudio.spatial && (
            <>
              <NumberInputRow
                label="Max Distance"
                value={primaryAudio.maxDistance}
                min={1}
                onChange={(v) => handleUpdate({ maxDistance: v })}
              />
              <NumberInputRow
                label="Ref Distance"
                value={primaryAudio.refDistance}
                min={0.1}
                onChange={(v) => handleUpdate({ refDistance: v })}
              />
              <NumberInputRow
                label="Rolloff"
                value={primaryAudio.rolloffFactor}
                min={0}
                max={10}
                step={0.1}
                onChange={(v) => handleUpdate({ rolloffFactor: v })}
              />
            </>
          )}

          {/* Autoplay */}
          <CheckboxRow
            label="Autoplay"
            checked={primaryAudio.autoplay}
            onChange={(v) => handleUpdate({ autoplay: v })}
          />

          {/* Preview Buttons */}
          <div className="flex gap-2 pt-2">
            <button
              onClick={handlePlay}
              className="flex flex-1 items-center justify-center gap-1.5 rounded bg-green-900/30 px-2 py-1.5 text-xs text-green-400 hover:bg-green-900/50"
            >
              <Play size={12} />
              Preview
            </button>
            <button
              onClick={handleStop}
              className="flex flex-1 items-center justify-center gap-1.5 rounded bg-zinc-800 px-2 py-1.5 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-300"
            >
              <StopCircle size={12} />
              Stop
            </button>
          </div>

          {/* Remove Audio */}
          <button
            onClick={handleRemoveAudio}
            className="w-full rounded bg-zinc-800 px-2 py-1.5 text-xs text-red-400 hover:bg-zinc-700"
          >
            Remove Audio
          </button>
        </div>
      )}
    </div>
  );
}
