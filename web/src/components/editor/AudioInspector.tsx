'use client';

import { useCallback, useState } from 'react';
import { useEditorStore, type AudioData } from '@/stores/editorStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { Play, StopCircle, Sparkles, HelpCircle } from 'lucide-react';
import { GenerateSoundDialog } from './GenerateSoundDialog';
import { GenerateMusicDialog } from './GenerateMusicDialog';
import { InfoTooltip } from '@/components/ui/InfoTooltip';

interface SliderRowProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  precision?: number;
  onChange: (v: number) => void;
}

function SliderRow({ label, value, min = 0, max = 1, step = 0.01, precision = 2, onChange, term }: SliderRowProps & { term?: string }) {
  return (
    <div className="flex items-center gap-2">
      <label className="w-20 shrink-0 text-xs text-zinc-400 flex items-center gap-1">
        {label}
        {term && <InfoTooltip term={term} />}
      </label>
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

function CheckboxRow({ label, checked, onChange, term }: CheckboxRowProps & { term?: string }) {
  return (
    <div className="flex items-center gap-2">
      <label className="w-20 shrink-0 text-xs text-zinc-400 flex items-center gap-1">
        {label}
        {term && <InfoTooltip term={term} />}
      </label>
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

function NumberInputRow({ label, value, min, max, step = 0.1, onChange, term }: NumberInputRowProps & { term?: string }) {
  return (
    <div className="flex items-center gap-2">
      <label className="w-20 shrink-0 text-xs text-zinc-400 flex items-center gap-1">
        {label}
        {term && <InfoTooltip term={term} />}
      </label>
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
  const [generateSoundOpen, setGenerateSoundOpen] = useState(false);
  const [generateMusicOpen, setGenerateMusicOpen] = useState(false);

  const primaryId = useEditorStore((s) => s.primaryId);
  const primaryAudio = useEditorStore((s) => s.primaryAudio);
  const assetRegistry = useEditorStore((s) => s.assetRegistry);
  const audioBuses = useEditorStore((s) => s.audioBuses);
  const setAudio = useEditorStore((s) => s.setAudio);
  const removeAudio = useEditorStore((s) => s.removeAudio);
  const playAudio = useEditorStore((s) => s.playAudio);
  const stopAudio = useEditorStore((s) => s.stopAudio);
  const navigateDocs = useWorkspaceStore((s) => s.navigateDocs);

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
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-1">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Audio
          </h3>
          <InfoTooltip text="Sound attached to this object" />
          <button onClick={() => navigateDocs('features/audio')} className="rounded p-0.5 text-zinc-600 hover:text-zinc-400" title="Documentation">
            <HelpCircle size={12} />
          </button>
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => setGenerateSoundOpen(true)}
            className="flex items-center gap-1 rounded bg-purple-900/30 px-2 py-0.5 text-[10px] text-purple-400 hover:bg-purple-900/50"
            title="Generate sound with AI"
          >
            <Sparkles size={10} />
            Sound
          </button>
          <button
            onClick={() => setGenerateMusicOpen(true)}
            className="flex items-center gap-1 rounded bg-purple-900/30 px-2 py-0.5 text-[10px] text-purple-400 hover:bg-purple-900/50"
            title="Generate music with AI"
          >
            <Sparkles size={10} />
            Music
          </button>
        </div>
      </div>

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
            <label className="w-20 shrink-0 text-xs text-zinc-400 flex items-center gap-1">
              Asset
              <InfoTooltip term="audioAsset" />
            </label>
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
            <label className="w-20 shrink-0 text-xs text-zinc-400 flex items-center gap-1">
              Bus
              <InfoTooltip term="audioBus" />
            </label>
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
            term="audioVolume"
          />

          {/* Pitch */}
          <SliderRow
            label="Pitch"
            value={primaryAudio.pitch}
            min={0.25}
            max={4}
            step={0.05}
            onChange={(v) => handleUpdate({ pitch: v })}
            term="audioPitch"
          />

          {/* Loop */}
          <CheckboxRow
            label="Loop"
            checked={primaryAudio.loopAudio}
            onChange={(v) => handleUpdate({ loopAudio: v })}
            term="audioLoop"
          />

          {/* Spatial */}
          <CheckboxRow
            label="Spatial"
            checked={primaryAudio.spatial}
            onChange={(v) => handleUpdate({ spatial: v })}
            term="audioSpatial"
          />

          {/* Spatial Settings (conditional) */}
          {primaryAudio.spatial && (
            <>
              <NumberInputRow
                label="Max Distance"
                value={primaryAudio.maxDistance}
                min={1}
                onChange={(v) => handleUpdate({ maxDistance: v })}
                term="audioMaxDistance"
              />
              <NumberInputRow
                label="Ref Distance"
                value={primaryAudio.refDistance}
                min={0.1}
                onChange={(v) => handleUpdate({ refDistance: v })}
                term="audioRefDistance"
              />
              <NumberInputRow
                label="Rolloff"
                value={primaryAudio.rolloffFactor}
                min={0}
                max={10}
                step={0.1}
                onChange={(v) => handleUpdate({ rolloffFactor: v })}
                term="audioRolloff"
              />
            </>
          )}

          {/* Autoplay */}
          <CheckboxRow
            label="Autoplay"
            checked={primaryAudio.autoplay}
            onChange={(v) => handleUpdate({ autoplay: v })}
            term="audioAutoplay"
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

      {/* Generation dialogs */}
      {primaryId && (
        <>
          <GenerateSoundDialog
            isOpen={generateSoundOpen}
            onClose={() => setGenerateSoundOpen(false)}
            entityId={primaryId}
          />
          <GenerateMusicDialog
            isOpen={generateMusicOpen}
            onClose={() => setGenerateMusicOpen(false)}
            entityId={primaryId}
          />
        </>
      )}
    </div>
  );
}
