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
import { Button, Input, cn } from '@spawnforge/ui';
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
import { extractWaveform } from '@/lib/audio/waveformExtractor';

const DEFAULT_SAMPLE_RATE = 48000;
/** Internal placeholder only; unknown source bounds never enable editing. */
const DEFAULT_DURATION_SEC = 1;
const WAVEFORM_BUCKETS = 80;

/** A labelled numeric edit control with field validation and availability state. */
interface ClipNumberFieldProps {
  id: string;
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  invalid?: boolean;
  disabled?: boolean;
  onCommit: (v: number) => void;
}

function ClipNumberField({ id, label, value, min, max, step = 0.01, unit, invalid, disabled, onCommit }: ClipNumberFieldProps) {
  const format = useCallback(
    (v: number) => (!disabled && Number.isFinite(v) ? String(Number(v.toFixed(4))) : ''),
    [disabled],
  );
  // The visible text is uncommitted local state: typing updates only the text,
  // never the clip document. A committed value — an accepted edit, undo/redo, or
  // a late decode — flows back through `value` and refreshes the field. This
  // keeps every intermediate keystroke, including transiently invalid ones like a
  // lone "-" while starting a negative gain, out of the undo history and away
  // from the assertive validation alert until the edit is deliberately committed
  // on blur or Enter.
  const [text, setText] = useState(() => format(value));
  const committedRef = useRef(value);
  useEffect(() => {
    if (!Object.is(committedRef.current, value)) {
      committedRef.current = value;
      setText(format(value));
    }
  }, [value, format]);

  const commit = useCallback(() => {
    onCommit(parseFloat(text));
    // On reject the committed `value` is unchanged and the effect above does not
    // fire, so drop the rejected intermediate text back to the last committed
    // value here; on accept the effect refreshes it to the new value.
    setText(format(value));
  }, [onCommit, text, value, format]);

  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="w-24 shrink-0 text-xs text-[var(--sf-text-secondary)]">
        {label}
      </label>
      <Input
        id={id}
        type="number"
        value={text}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        error={invalid}
        aria-invalid={invalid ? true : undefined}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
        }}
        className={cn('min-w-0 flex-1 px-2 text-xs', invalid && 'ring-1 ring-[var(--sf-destructive)]')}
      />
      {unit && <span className="w-6 text-right text-[10px] text-[var(--sf-text-secondary)]">{unit}</span>}
    </div>
  );
}

/** Source identity and optional measured bounds for the standalone clip prototype. */
export interface ClipEditorProps {
  assetId: string;
  asset?: AssetMetadata;
  /** Decoded bounds supplied by a host that already owns the source buffer. */
  sourceBounds?: ClipBounds;
}

/**
 * Render local clip edits once source bounds are known; edits are discarded on unmount.
 * @param props Source asset and optional bounds measured by its host.
 * @returns Clip controls, waveform metadata and source availability feedback.
 */
export function ClipEditor({ assetId, asset, sourceBounds }: ClipEditorProps) {
  const initialBounds = sourceBounds && Number.isFinite(sourceBounds.durationSec) && sourceBounds.durationSec > 0
    && Number.isFinite(sourceBounds.sampleRate) && sourceBounds.sampleRate > 0 ? sourceBounds : undefined;
  const [boundsKnown, setBoundsKnown] = useState(Boolean(initialBounds));
  const [decodeState, setDecodeState] = useState<'loading' | 'ready' | 'unavailable'>(
    asset?.source.type === 'url' ? 'loading' : initialBounds ? 'ready' : 'unavailable',
  );
  const [bounds, setBounds] = useState<ClipBounds>(initialBounds ?? {
    durationSec: DEFAULT_DURATION_SEC,
    sampleRate: DEFAULT_SAMPLE_RATE,
  });
  const [doc, setDoc] = useState<AudioClipDocument>(() =>
    createAudioClipDocument({
      sourceAssetId: assetId,
      sourceHash: '',
      durationSec: initialBounds?.durationSec ?? DEFAULT_DURATION_SEC,
      sampleRate: initialBounds?.sampleRate ?? DEFAULT_SAMPLE_RATE,
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

  // Decode URL sources once. Until measured bounds exist, controls remain
  // disabled and the waveform describes its unavailable state explicitly.
  useEffect(() => {
    if (!asset || asset.source.type !== 'url') return;
    const url = asset.source.url;
    let cancelled = false;
    const controller = new AbortController();
    let ctx: AudioContext | undefined;
    let closed = false;
    const close = () => {
      if (ctx && !closed) {
        closed = true;
        void ctx.close().catch(() => { /* Context may already be closed by the browser. */ });
      }
    };
    void (async () => {
      try {
        const Ctx = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctx) throw new Error('Audio decoding unavailable');
        ctx = new Ctx();
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error('Audio source unavailable');
        const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
        if (cancelled) return;
        if (!Number.isFinite(buffer.duration) || buffer.duration <= 0 || !Number.isFinite(buffer.sampleRate) || buffer.sampleRate <= 0) {
          throw new Error('Audio source has invalid bounds');
        }
        setPeaks(extractWaveform(buffer, WAVEFORM_BUCKETS));
        setBounds({ durationSec: buffer.duration, sampleRate: buffer.sampleRate });
        setBoundsKnown(true);
        setDecodeState('ready');
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
        if (!cancelled) setDecodeState('unavailable');
      } finally {
        close();
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
      close();
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

  const trimLabel = boundsKnown
    ? `Waveform, trim ${doc.trimStartSec.toFixed(2)} to ${doc.trimEndSec.toFixed(2)} seconds of ${bounds.durationSec.toFixed(2)} second source`
    : 'Waveform unavailable: source duration unknown';

  return (
    <div className="space-y-2 rounded border border-[var(--sf-border)] bg-[var(--sf-bg-surface)] p-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--sf-text-secondary)]">Clip Editing</span>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            aria-label="Undo clip edit"
            className="w-8 px-1"
          >
            <Undo2 size={12} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={onRedo}
            disabled={!canRedo}
            aria-label="Redo clip edit"
            className="w-8 px-1"
          >
            <Redo2 size={12} />
          </Button>
        </div>
      </div>

      {decodeState !== 'ready' && (
        <p role="status" className="text-xs text-[var(--sf-text-secondary)]">
          {decodeState === 'loading' ? 'Loading audio source…' : boundsKnown
            ? 'Waveform unavailable. Supplied source bounds remain available.'
            : 'Audio source unavailable. Clip editing requires a decoded source.'}
        </p>
      )}

      {/* Waveform with trim + loop overlays. role=img with a descriptive name so
          a screen reader gets the same trim state the sighted markers show. */}
      <div
        role="img"
        aria-label={trimLabel}
        className="relative flex h-10 items-center gap-px overflow-hidden rounded bg-[var(--sf-bg-app)]"
      >
        {bars.map((v, i) => (
          <span
            key={i}
            style={{ '--h': `${Math.round(Math.min(1, v) * 100)}%` } as React.CSSProperties}
            className="h-[var(--h)] min-h-px flex-1 rounded-sm bg-[var(--sf-text-muted)]"
          />
        ))}
        {/* Trimmed-away regions dimmed. */}
        <span
          style={{ '--w': pct(doc.trimStartSec) } as React.CSSProperties}
          className="absolute inset-y-0 left-0 w-[var(--w)] bg-[var(--sf-bg-app)]/70"
        />
        <span
          style={{ '--w': pct(bounds.durationSec - doc.trimEndSec) } as React.CSSProperties}
          className="absolute inset-y-0 right-0 w-[var(--w)] bg-[var(--sf-bg-app)]/70"
        />
        {/* Loop region marker. */}
        <span
          style={{ '--l': pct(doc.loopStartSec), '--r': pct(bounds.durationSec - doc.loopEndSec) } as React.CSSProperties}
          className="pointer-events-none absolute inset-y-0 left-[var(--l)] right-[var(--r)] border-x border-[var(--sf-accent)]"
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
        disabled={!boundsKnown}
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
        disabled={!boundsKnown}
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
        disabled={!boundsKnown}
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
        disabled={!boundsKnown}
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
        disabled={!boundsKnown}
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
        disabled={!boundsKnown}
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
        disabled={!boundsKnown}
        onCommit={(v) => apply(setLoop(doc, { loopStartSec: doc.loopStartSec, loopEndSec: v }, bounds))}
      />

      {errors.length > 0 && (
        <div role="alert" className="rounded border border-[var(--sf-destructive)] px-2 py-1 text-[11px] text-[var(--sf-text)]">
          {errors.map((e, i) => (
            <div key={i}>{e.message}</div>
          ))}
        </div>
      )}
    </div>
  );
}
