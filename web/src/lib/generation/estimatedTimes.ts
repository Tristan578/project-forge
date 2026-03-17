/**
 * Estimated completion times (in seconds) for AI generation operations.
 *
 * Ranges are [min, max] seconds based on observed provider behaviour.
 * These are shown to the user as a rough estimate ("~45s") during generation.
 */

import type { GenerationType } from '@/stores/generationStore';

export interface EstimatedTimeRange {
  /** Minimum expected duration in seconds */
  min: number;
  /** Maximum expected duration in seconds */
  max: number;
  /** Friendly human-readable label for the operation */
  label: string;
}

/**
 * Estimated generation times by operation type.
 * Based on provider SLA documentation and empirical observation.
 */
export const ESTIMATED_TIMES: Record<GenerationType, EstimatedTimeRange> = {
  model: { min: 60, max: 120, label: '3D model' },
  texture: { min: 20, max: 45, label: 'texture' },
  sfx: { min: 5, max: 15, label: 'sound effect' },
  voice: { min: 5, max: 15, label: 'voice clip' },
  music: { min: 30, max: 90, label: 'music track' },
  skybox: { min: 30, max: 60, label: 'skybox' },
  sprite: { min: 15, max: 30, label: 'sprite' },
  sprite_sheet: { min: 20, max: 45, label: 'sprite sheet' },
  tileset: { min: 20, max: 45, label: 'tileset' },
  'pixel-art': { min: 10, max: 25, label: 'pixel art' },
};

/**
 * Returns the midpoint estimated duration in seconds for an operation type.
 * Falls back to 60s for unknown types.
 */
export function getEstimatedSeconds(type: GenerationType): number {
  const range = ESTIMATED_TIMES[type];
  if (!range) return 60;
  return Math.round((range.min + range.max) / 2);
}

/**
 * Returns a human-readable estimated time string.
 *
 * Given progress, calculates remaining time from a linear interpolation
 * of the estimated range. When no progress is available, returns the
 * midpoint estimate.
 *
 * @param type - Generation operation type
 * @param progress - Current progress 0-100, or undefined if indeterminate
 * @param elapsedSeconds - Seconds since the job started, or undefined
 * @returns e.g. "~45s remaining", "~1-2 min", "Almost done"
 */
export function formatEstimatedTime(
  type: GenerationType,
  progress?: number,
  elapsedSeconds?: number,
): string {
  const range = ESTIMATED_TIMES[type];
  if (!range) return '';

  // At 90%+ show "almost done" regardless of elapsed time
  if (progress !== undefined && progress >= 90) {
    return 'Almost done...';
  }

  // If we have both progress and elapsed time, calculate remaining from velocity
  if (progress !== undefined && progress > 0 && elapsedSeconds !== undefined && elapsedSeconds > 0) {
    const secondsPerPercent = elapsedSeconds / progress;
    const remainingPercent = 100 - progress;
    const estimatedRemaining = Math.round(secondsPerPercent * remainingPercent);

    if (estimatedRemaining < 10) return 'Almost done...';
    if (estimatedRemaining < 60) return `~${estimatedRemaining}s remaining`;
    const mins = Math.round(estimatedRemaining / 60);
    return `~${mins} min remaining`;
  }

  // No progress info — use range estimate
  const { min, max } = range;
  if (min < 60 && max < 60) {
    return `~${min}-${max}s`;
  }
  const minMins = Math.floor(min / 60);
  const maxMins = Math.ceil(max / 60);
  if (minMins === maxMins) {
    return `~${minMins} min`;
  }
  return `~${minMins}-${maxMins} min`;
}

/**
 * Returns stage description labels for each operation type.
 * Used during streaming/staged progress display.
 */
export const GENERATION_STAGES: Record<GenerationType, string[]> = {
  model: [
    'Analyzing prompt...',
    'Generating base mesh...',
    'Refining geometry...',
    'Applying textures...',
    'Finalizing model...',
  ],
  texture: [
    'Analyzing prompt...',
    'Generating albedo map...',
    'Creating normal map...',
    'Building PBR maps...',
    'Finalizing textures...',
  ],
  sfx: [
    'Analyzing description...',
    'Synthesizing audio...',
    'Post-processing...',
  ],
  voice: [
    'Analyzing script...',
    'Synthesizing voice...',
    'Post-processing...',
  ],
  music: [
    'Composing melody...',
    'Arranging instruments...',
    'Mixing tracks...',
    'Mastering audio...',
  ],
  skybox: [
    'Generating environment...',
    'Applying lighting...',
    'Finalizing panorama...',
  ],
  sprite: [
    'Analyzing style...',
    'Generating image...',
    'Finalizing sprite...',
  ],
  sprite_sheet: [
    'Analyzing animation...',
    'Generating frames...',
    'Slicing sheet...',
  ],
  tileset: [
    'Analyzing style...',
    'Generating tiles...',
    'Finalizing tileset...',
  ],
  'pixel-art': [
    'Analyzing description...',
    'Generating pixel art...',
    'Finalizing...',
  ],
};

/**
 * Returns the current stage label for an operation given its progress (0-100).
 */
export function getCurrentStage(type: GenerationType, progress: number): string {
  const stages = GENERATION_STAGES[type];
  if (!stages || stages.length === 0) return 'Processing...';

  const stageIndex = Math.min(
    Math.floor((progress / 100) * stages.length),
    stages.length - 1,
  );
  return stages[stageIndex];
}
