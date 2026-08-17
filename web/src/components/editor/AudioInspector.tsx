'use client';

import { useCallback, useState } from 'react';
import { useEditorStore, type AudioData } from '@/stores/editorStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { Play, StopCircle, Sparkles, HelpCircle, Lock } from 'lucide-react';
import { GenerateSoundDialog } from './GenerateSoundDialog';
import { GenerateMusicDialog } from './GenerateMusicDialog';
import { InfoTooltip } from '@/components/ui/InfoTooltip';
import { useUserStore } from '@/stores/userStore';
import { canAccessPanel, getRequiredTier, TIER_LABELS } from '@/lib/ai/tierAccess';
import { resolveAudioAssetId } from '@/lib/audio/entityAudioGraph';

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
      <span className="w-12 text-right text-xs tabular-nums text-zinc-400">
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

  const tier = useUserStore((s) => s.tier);
  const canGenerateSound = canAccessPanel('generate-sound', tier);
  const canGenerateMusic = canAccessPanel('generate-music', tier);
  // These stay focusable when locked (aria-disabled, not disabled): they are
  // upgrade prompts, and a control removed from the tab order can never tell
  // anyone what it wants. But `title` alone is not that telling — it is
  // unreachable by keyboard and inconsistently announced — so the requirement
  // goes in the accessible name too.
  const soundButtonLabel = canGenerateSound
    ? 'Generate sound with AI'
    : `Generate sound with AI — requires ${TIER_LABELS[getRequiredTier('generate-sound') ?? 'hobbyist']} tier`;
  const musicButtonLabel = canGenerateMusic
    ? 'Generate music with AI'
    : `Generate music with AI — requires ${TIER_LABELS[getRequiredTier('generate-music') ?? 'hobbyist']} tier`;

  const primaryId = useEditorStore((s) => s.primaryId);
  // Read the selected entity's audio out of the per-entity map. This used to be
  // a single `primaryAudio` holding whichever entity's AUDIO_CHANGED arrived
  // last, so a scene with two sound sources showed the wrong one.
  const primaryAudio = useEditorStore((s) => (primaryId ? s.entityAudio[primaryId] ?? null : null));
  const assetRegistry = useEditorStore((s) => s.assetRegistry);
  const audioBuses = useEditorStore((s) => s.audioBuses);
  const setAudio = useEditorStore((s) => s.setAudio);
  const removeAudio = useEditorStore((s) => s.removeAudio);
  const playAudio = useEditorStore((s) => s.playAudio);
  const stopAudio = useEditorStore((s) => s.stopAudio);
  const navigateDocs = useWorkspaceStore((s) => s.navigateDocs);

  const audioAssets = Object.values(assetRegistry).filter((a) => a.kind === 'audio');

  // An entity's `assetId` is not always an asset id: a generated clip carries
  // the import NAME, because the engine mints the id itself and never lets JS
  // supply one (see the header of `lib/audio/entityAudioGraph.ts`). The options
  // below are keyed by id, so without resolving the alias every AI-attached
  // sound displayed as "None" — and picking any option to see what was there
  // overwrote it.
  const selectedAssetId = primaryAudio?.assetId ? resolveAudioAssetId(primaryAudio.assetId) : '';
  // Still unknown means the asset is genuinely gone (deleted, or a scene saved
  // against assets this session never imported). Name it rather than silently
  // showing "None", which reads as "no sound attached".
  const selectedAssetMissing =
    selectedAssetId !== '' && !audioAssets.some((a) => a.id === selectedAssetId);

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
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
            Audio
          </h3>
          <InfoTooltip text="Sound attached to this object" />
          <button onClick={() => navigateDocs('features/audio')} className="rounded p-0.5 text-zinc-400 hover:text-zinc-400" title="Documentation">
            <HelpCircle size={12} />
          </button>
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => canGenerateSound && setGenerateSoundOpen(true)}
            aria-disabled={!canGenerateSound || undefined}
            aria-label={soundButtonLabel}
            className={`flex items-center gap-1 rounded px-2 py-0.5 text-[10px] ${
              canGenerateSound
                ? 'bg-purple-900/30 text-purple-400 hover:bg-purple-900/50'
                : 'cursor-not-allowed bg-zinc-800 text-zinc-500'
            }`}
            title={soundButtonLabel}
          >
            {canGenerateSound ? <Sparkles size={10} /> : <Lock size={10} />}
            Sound
          </button>
          <button
            onClick={() => canGenerateMusic && setGenerateMusicOpen(true)}
            aria-disabled={!canGenerateMusic || undefined}
            aria-label={musicButtonLabel}
            className={`flex items-center gap-1 rounded px-2 py-0.5 text-[10px] ${
              canGenerateMusic
                ? 'bg-purple-900/30 text-purple-400 hover:bg-purple-900/50'
                : 'cursor-not-allowed bg-zinc-800 text-zinc-500'
            }`}
            title={musicButtonLabel}
          >
            {canGenerateMusic ? <Sparkles size={10} /> : <Lock size={10} />}
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
            <label
              htmlFor="audio-asset-select"
              className="w-20 shrink-0 text-xs text-zinc-400 flex items-center gap-1"
            >
              Asset
              <InfoTooltip term="audioAsset" />
            </label>
            <select
              id="audio-asset-select"
              value={selectedAssetId}
              onChange={(e) => handleUpdate({ assetId: e.target.value || null })}
              className="flex-1 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none
                focus:ring-1 focus:ring-blue-500"
            >
              <option value="">None</option>
              {selectedAssetMissing && (
                <option value={selectedAssetId}>{selectedAssetId} (missing)</option>
              )}
              {audioAssets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.name}
                </option>
              ))}
            </select>
          </div>

          {/* Bus Assignment */}
          <div className="flex items-center gap-2">
            <label
              htmlFor="audio-bus-select"
              className="w-20 shrink-0 text-xs text-zinc-400 flex items-center gap-1"
            >
              Bus
              <InfoTooltip term="audioBus" />
            </label>
            <select
              id="audio-bus-select"
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
