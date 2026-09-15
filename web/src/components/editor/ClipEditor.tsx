'use client';

/**
 * Standalone prototype for a native audio clip (#9903, operation
 * `audio.FR-1.OP-02`): trim window, gain, fade in/out and loop bounds, with
 * undo/redo. Every control is a keyboard-reachable numeric input backed by the
 * SAME validated, pure commands the AI parity slice will call, so manual and AI
 * edits share identical validation and errors. This component is deliberately
 * not mounted in AudioInspector until #9936 connects entity persistence,
 * playback and export. Its local document is discarded on unmount.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Undo2, Redo2 } from 'lucide-react';
import type { AssetMetadata } from '@/stores/slices/types';
import {
  AudioClipHistory,
  createAudioClipDocument,
  effectiveDurationSec,
  setFade,
  setGain,
  setLoop,
  setTrim,
  MIN_GAIN_DB,
  MAX_GAIN_DB,
  type AudioClipDocument,
  type ClipBounds,
  type CommandResult,
  type ValidationError,
} from '@/lib/audio/audioClipDocument';
import { extractWaveformFromUrl } from '@/lib/audio/waveformExtractor';

const DEFAULT_SAMPLE_RATE = 48000;
/** Fallback clip length used until the real source is decoded. */
const DEFAULT_DURATION_SEC = 1;
const WAVEFORM_BUCKETS = 80;

interface ClipNumberFieldProps {
  id: string;
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  invalid?: boolean;
  onCommit: (v: number) => void;
}

function ClipNumberField({ id, label, value, min, max, step = 0.01, unit, invalid, onCommit }: ClipNumberFieldProps) {
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="w-24 shrink-0 text-xs text-zinc-400">
        {label}
      </label>
      <input
        id={id}
        type="number"
        value={Number.isFinite(value) ? Number(value.toFixed(4)) : ''}
        min={min}
        max={max}
        step={step}
        aria-invalid={invalid ? true : undefined}
        onChange={(e) => onCommit(parseFloat(e.target.value))}
        className={`flex-1 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none focus:ring-1 ${
          invalid ? 'ring-1 ring-red-500' : 'focus:ring-blue-500'
        }`}
      />
      {unit && <span className="w-6 text-right text-[10px] text-zinc-500">{unit}</span>}
    </div>
  );
}

export function ClipEditor({ assetId, asset }: { assetId: string; asset?: AssetMetadata }) {
  const [bounds, setBounds] = useState<ClipBounds>({
    durationSec: DEFAULT_DURATION_SEC,
    sampleRate: DEFAULT_SAMPLE_RATE,
  });
  const [doc, setDoc] = useState<AudioClipDocument>(() =>
    createAudioClipDocument({
      sourceAssetId: assetId,
      sourceHash: '',
      durationSec: DEFAULT_DURATION_SEC,
      sampleRate: DEFAULT_SAMPLE_RATE,
    }),
  );
  const [peaks, setPeaks] = useState<number[]>([]);
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const historyRef = useRef(new AudioClipHistory());
  // Once the creator has changed anything, a late-arriving decode must not
  // stomp their edits — it only widens the bounds so a longer clip becomes
  // reachable.
  const userEditedRef = useRef(false);

  // Best-effort waveform + true duration from a URL-backed source. Fully
  // guarded: absent Web Audio (jsdom, SSR) or a non-URL asset simply leaves the
  // panel with its numeric controls and no waveform. Never throws to the user.
  useEffect(() => {
    if (!asset || asset.source.type !== 'url') return;
    const url = asset.source.url;
    if (typeof window === 'undefined') return;
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx || typeof fetch === 'undefined') return;

    let cancelled = false;
    const ctx = new Ctx();
    void (async () => {
      try {
        const response = await fetch(url);
        if (!response.ok) return;
        const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
        if (cancelled) return;
        const nextPeaks = await extractWaveformFromUrl(url, ctx, WAVEFORM_BUCKETS).catch(() => []);
        if (cancelled) return;
        setPeaks(nextPeaks);
        setBounds({ durationSec: buffer.duration, sampleRate: buffer.sampleRate });
        if (!userEditedRef.current) {
          setDoc(
            createAudioClipDocument({
              sourceAssetId: assetId,
              sourceHash: '',
              durationSec: buffer.duration,
              sampleRate: buffer.sampleRate,
            }),
          );
        }
      } catch {
        // Decode/network failure: keep the numeric editor usable.
      } finally {
        void ctx.close?.();
      }
    })();
    return () => {
      cancelled = true;
      void ctx.close?.();
    };
  }, [asset, assetId]);

  const apply = useCallback((result: CommandResult) => {
    if (result.ok) {
      historyRef.current.push(doc, result.data);
      setDoc(result.data);
      setErrors([]);
      userEditedRef.current = true;
      setCanUndo(historyRef.current.canUndo());
      setCanRedo(historyRef.current.canRedo());
    } else {
      setErrors(result.errors);
    }
  }, [doc]);

  const onUndo = useCallback(() => {
    const restored = historyRef.current.undo();
    if (restored) {
      setDoc(restored);
      setErrors([]);
      setCanUndo(historyRef.current.canUndo());
      setCanRedo(historyRef.current.canRedo());
    }
  }, []);

  const onRedo = useCallback(() => {
    const restored = historyRef.current.redo();
    if (restored) {
      setDoc(restored);
      setErrors([]);
      setCanUndo(historyRef.current.canUndo());
      setCanRedo(historyRef.current.canRedo());
    }
  }, []);

  const fieldInvalid = useCallback(
    (field: ValidationError['field']) => errors.some((e) => e.field === field),
    [errors],
  );

  const windowLen = effectiveDurationSec(doc);
  const pct = useCallback(
    (sec: number) => `${Math.min(100, Math.max(0, (sec / Math.max(bounds.durationSec, 1e-6)) * 100))}%`,
    [bounds.durationSec],
  );

  // Bars for the waveform track. Absent decoded peaks, a flat baseline keeps the
  // region labelled and the markers meaningful without inventing amplitude data.
  const bars = useMemo(() => {
    if (peaks.length === 0) return new Array(WAVEFORM_BUCKETS).fill(0.04) as number[];
    return peaks;
  }, [peaks]);

  const trimLabel = `Waveform, trim ${doc.trimStartSec.toFixed(2)} to ${doc.trimEndSec.toFixed(2)} seconds of ${bounds.durationSec.toFixed(2)} second source`;

  return (
    <div className="space-y-2 rounded border border-zinc-800 bg-zinc-900/40 p-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Clip Editing</span>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            aria-label="Undo clip edit"
            className="rounded p-1 text-zinc-400 enabled:hover:bg-zinc-800 disabled:cursor-not-allowed disabled:text-zinc-600"
          >
            <Undo2 size={12} />
          </button>
          <button
            type="button"
            onClick={onRedo}
            disabled={!canRedo}
            aria-label="Redo clip edit"
            className="rounded p-1 text-zinc-400 enabled:hover:bg-zinc-800 disabled:cursor-not-allowed disabled:text-zinc-600"
          >
            <Redo2 size={12} />
          </button>
        </div>
      </div>

      {/* Waveform with trim + loop overlays. role=img with a descriptive name so
          a screen reader gets the same trim state the sighted markers show. */}
      <div
        role="img"
        aria-label={trimLabel}
        className="relative flex h-10 items-center gap-px overflow-hidden rounded bg-zinc-950/60"
      >
        {bars.map((v, i) => (
          <span
            key={i}
            style={{ '--h': `${Math.round(Math.min(1, v) * 100)}%` } as React.CSSProperties}
            className="h-[var(--h)] min-h-px flex-1 rounded-sm bg-zinc-600"
          />
        ))}
        {/* Trimmed-away regions dimmed. */}
        <span
          style={{ '--w': pct(doc.trimStartSec) } as React.CSSProperties}
          className="absolute inset-y-0 left-0 w-[var(--w)] bg-zinc-950/70"
        />
        <span
          style={{ '--w': pct(bounds.durationSec - doc.trimEndSec) } as React.CSSProperties}
          className="absolute inset-y-0 right-0 w-[var(--w)] bg-zinc-950/70"
        />
        {/* Loop region marker. */}
        <span
          style={{ '--l': pct(doc.loopStartSec), '--r': pct(bounds.durationSec - doc.loopEndSec) } as React.CSSProperties}
          className="pointer-events-none absolute inset-y-0 left-[var(--l)] right-[var(--r)] border-x border-blue-500/60"
        />
      </div>

      <ClipNumberField
        id="clip-trim-start"
        label="Trim start"
        unit="s"
        value={doc.trimStartSec}
        min={0}
        max={bounds.durationSec}
        invalid={fieldInvalid('trimStartSec')}
        onCommit={(v) => apply(setTrim(doc, { startSec: v, endSec: doc.trimEndSec }, bounds))}
      />
      <ClipNumberField
        id="clip-trim-end"
        label="Trim end"
        unit="s"
        value={doc.trimEndSec}
        min={0}
        max={bounds.durationSec}
        invalid={fieldInvalid('trimEndSec')}
        onCommit={(v) => apply(setTrim(doc, { startSec: doc.trimStartSec, endSec: v }, bounds))}
      />
      <ClipNumberField
        id="clip-gain"
        label="Gain"
        unit="dB"
        step={0.5}
        value={doc.gainDb}
        min={MIN_GAIN_DB}
        max={MAX_GAIN_DB}
        invalid={fieldInvalid('gainDb')}
        onCommit={(v) => apply(setGain(doc, { gainDb: v }))}
      />
      <ClipNumberField
        id="clip-fade-in"
        label="Fade in"
        unit="s"
        value={doc.fadeInSec}
        min={0}
        max={windowLen}
        invalid={fieldInvalid('fadeInSec')}
        onCommit={(v) => apply(setFade(doc, { fadeInSec: v, fadeOutSec: doc.fadeOutSec }, bounds))}
      />
      <ClipNumberField
        id="clip-fade-out"
        label="Fade out"
        unit="s"
        value={doc.fadeOutSec}
        min={0}
        max={windowLen}
        invalid={fieldInvalid('fadeOutSec')}
        onCommit={(v) => apply(setFade(doc, { fadeInSec: doc.fadeInSec, fadeOutSec: v }, bounds))}
      />
      <ClipNumberField
        id="clip-loop-start"
        label="Loop start"
        unit="s"
        value={doc.loopStartSec}
        min={doc.trimStartSec}
        max={doc.trimEndSec}
        invalid={fieldInvalid('loopStartSec')}
        onCommit={(v) => apply(setLoop(doc, { loopStartSec: v, loopEndSec: doc.loopEndSec }, bounds))}
      />
      <ClipNumberField
        id="clip-loop-end"
        label="Loop end"
        unit="s"
        value={doc.loopEndSec}
        min={doc.trimStartSec}
        max={doc.trimEndSec}
        invalid={fieldInvalid('loopEndSec')}
        onCommit={(v) => apply(setLoop(doc, { loopStartSec: doc.loopStartSec, loopEndSec: v }, bounds))}
      />

      {errors.length > 0 && (
        <div role="alert" className="rounded bg-red-950/40 px-2 py-1 text-[11px] text-red-300">
          {errors.map((e, i) => (
            <div key={i}>{e.message}</div>
          ))}
        </div>
      )}
    </div>
  );
}
