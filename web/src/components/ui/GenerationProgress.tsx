'use client';

/**
 * GenerationProgress
 *
 * A reusable loading overlay/card shown during AI asset generation.
 * Handles three visual states:
 *
 *   - indeterminate: animated shimmer/pulse (no progress percentage known)
 *   - determinate:   progress bar with exact percentage
 *   - streaming:     animated dots with live stage name
 *
 * Accessibility: uses role="status" + aria-live="polite" so screen readers
 * announce progress updates without interrupting the user.
 *
 * Usage:
 *   <GenerationProgress
 *     operation="model"
 *     progress={42}
 *     stage="Refining geometry..."
 *     onCancel={handleCancel}
 *   />
 */

import { useEffect, useRef, useState } from 'react';
import { X, Sparkles } from 'lucide-react';
import type { GenerationType } from '@/stores/generationStore';
import {
  formatEstimatedTime,
  getCurrentStage,
  ESTIMATED_TIMES,
} from '@/lib/generation/estimatedTimes';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface GenerationProgressProps {
  /**
   * The generation operation type — used to pick label, stage names, and
   * estimated duration.
   */
  operation: GenerationType;

  /**
   * Current progress 0–100.
   * - Omit (or pass undefined) for indeterminate shimmer.
   * - Pass a number for the determinate progress-bar mode.
   */
  progress?: number;

  /**
   * Human-readable stage description shown beneath the progress bar.
   * If omitted, one is derived automatically from `operation` + `progress`.
   */
  stage?: string;

  /**
   * Called when the user presses the Cancel button.
   * If omitted, no cancel button is rendered.
   */
  onCancel?: () => void;
}

// ─── Visual mode derivation ───────────────────────────────────────────────────

type VisualMode = 'indeterminate' | 'determinate' | 'streaming';

function deriveMode(progress: number | undefined): VisualMode {
  if (progress === undefined) return 'indeterminate';
  if (progress === 0) return 'streaming';
  return 'determinate';
}

// ─── Animated dots (streaming mode) ──────────────────────────────────────────

function AnimatedDots() {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setFrame((f) => (f + 1) % 4), 450);
    return () => clearInterval(id);
  }, []);

  const dots = '.'.repeat(frame);
  return (
    <span aria-hidden="true" className="inline-block w-5 text-left text-purple-400">
      {dots}
    </span>
  );
}

// ─── Shimmer bar (indeterminate mode) ────────────────────────────────────────

function ShimmerBar() {
  return (
    <div
      aria-hidden="true"
      className="relative h-1.5 w-full overflow-hidden rounded-full bg-zinc-700"
    >
      <div className="absolute inset-y-0 left-0 w-1/3 animate-shimmer-sweep rounded-full bg-gradient-to-r from-transparent via-purple-500/70 to-transparent" />
    </div>
  );
}

// ─── Determinate progress bar ─────────────────────────────────────────────────

function ProgressBar({ value }: { value: number }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Generation progress"
      className="relative h-1.5 w-full overflow-hidden rounded-full bg-zinc-700"
    >
      <div
        className="h-full rounded-full bg-purple-500 transition-[width] duration-500 ease-out"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

// ─── Elapsed-time counter hook ────────────────────────────────────────────────

function useElapsedSeconds(): number {
  // startRef is initialised to 0; the real start time is captured in the effect
  // to avoid calling Date.now() during render (react-hooks/purity rule).
  const startRef = useRef(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    startRef.current = Date.now();
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  return elapsed;
}

// ─── Main component ───────────────────────────────────────────────────────────

/**
 * Loading overlay card for AI generation operations.
 *
 * @example
 * // Indeterminate — no progress info yet
 * <GenerationProgress operation="model" onCancel={handleCancel} />
 *
 * @example
 * // Determinate — progress percentage known
 * <GenerationProgress operation="texture" progress={64} onCancel={handleCancel} />
 *
 * @example
 * // Streaming with explicit stage label
 * <GenerationProgress operation="music" progress={0} stage="Composing melody..." />
 */
export function GenerationProgress({
  operation,
  progress,
  stage,
  onCancel,
}: GenerationProgressProps) {
  const elapsed = useElapsedSeconds();
  const mode = deriveMode(progress);

  const typeInfo = ESTIMATED_TIMES[operation];
  const operationLabel = typeInfo?.label ?? operation;

  const derivedStage =
    stage ?? (progress !== undefined ? getCurrentStage(operation, progress) : 'Starting...');

  const timeEstimate = formatEstimatedTime(operation, progress, elapsed);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`Generating ${operationLabel}`}
      className="flex flex-col gap-3 rounded-lg border border-zinc-700 bg-zinc-900 p-4 shadow-xl"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles
            size={14}
            className="shrink-0 text-purple-400"
            aria-hidden="true"
          />
          <span className="text-sm font-semibold text-zinc-100">
            Generating {operationLabel}
          </span>
        </div>

        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            aria-label={`Cancel ${operationLabel} generation`}
            className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-zinc-500"
          >
            <X size={14} aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Progress indicator */}
      {mode === 'indeterminate' && <ShimmerBar />}
      {mode === 'determinate' && progress !== undefined && (
        <ProgressBar value={progress} />
      )}
      {mode === 'streaming' && <ShimmerBar />}

      {/* Stage + time row */}
      <div className="flex items-center justify-between gap-2">
        {/* Stage label */}
        <span
          className="truncate text-xs text-zinc-400"
          aria-live="polite"
          aria-atomic="true"
        >
          {mode === 'streaming' ? (
            <>
              {derivedStage}
              <AnimatedDots />
            </>
          ) : (
            derivedStage
          )}
        </span>

        {/* Right side: percentage or time estimate */}
        <span className="shrink-0 text-xs tabular-nums text-zinc-500">
          {mode === 'determinate' && progress !== undefined
            ? `${Math.round(progress)}%`
            : timeEstimate}
        </span>
      </div>

      {/* Estimated time (only when determinate and we have a useful estimate) */}
      {mode === 'determinate' && timeEstimate && (
        <p className="text-[10px] text-zinc-500">{timeEstimate}</p>
      )}
    </div>
  );
}

// ─── Overlay wrapper ──────────────────────────────────────────────────────────

export interface GenerationProgressOverlayProps extends GenerationProgressProps {
  /** Whether the overlay is visible */
  isVisible: boolean;
}

/**
 * Full-screen modal overlay variant of GenerationProgress.
 * Renders centred over the viewport with a dark backdrop.
 *
 * @example
 * <GenerationProgressOverlay
 *   isVisible={isGenerating}
 *   operation="model"
 *   progress={progress}
 *   onCancel={handleCancel}
 * />
 */
export function GenerationProgressOverlay({
  isVisible,
  ...props
}: GenerationProgressOverlayProps) {
  if (!isVisible) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      aria-modal="true"
    >
      <div className="w-full max-w-sm px-4">
        <GenerationProgress {...props} />
      </div>
    </div>
  );
}
