/**
 * Type definitions for the emotional pacing analyzer.
 *
 * PacingSegment — one scene's worth of pacing data
 * PacingCurve — ordered list of segments across the whole project
 * PacingReport — AI-enriched result with curve + suggestions
 */

// ---------------------------------------------------------------------------
// Emotion tag used on each segment
// ---------------------------------------------------------------------------

export type EmotionTag =
  | 'calm'
  | 'rising'
  | 'peak'
  | 'resolution'
  | 'tension'
  | 'excitement'
  | 'fear'
  | 'wonder';

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

/** One scene's contribution to the pacing curve. */
export interface PacingSegment {
  /** Index of the scene within the project (0-based). */
  sceneIndex: number;
  /** Human-readable scene name. */
  sceneName: string;
  /** Emotional intensity 0–1 derived from scene signals. */
  intensity: number;
  /** Dominant emotion tag for this segment. */
  emotion: EmotionTag;
  /** Signals that contributed to the intensity calculation. */
  signals: PacingSignal[];
}

/** A single extracted signal that feeds into intensity. */
export interface PacingSignal {
  type:
    | 'combat_density'
    | 'collectible_density'
    | 'dialogue_density'
    | 'audio_intensity'
    | 'camera_variety'
    | 'spawner_count'
    | 'script_count';
  /** Normalised contribution 0–1 */
  value: number;
  /** Human-readable note */
  description: string;
}

/** Full pacing curve across all scenes. */
export interface PacingCurve {
  segments: PacingSegment[];
  /** Average intensity across all segments. */
  averageIntensity: number;
  /** Variance in intensity — 0 = completely flat, higher = dynamic. */
  variance: number;
}

/** An AI-generated improvement suggestion. */
export interface PacingSuggestion {
  /** Short actionable title. */
  title: string;
  /** Detailed explanation and recommended action. */
  description: string;
  /** Scene index this suggestion targets (null = whole project). */
  targetSceneIndex: number | null;
  priority: 'low' | 'medium' | 'high';
}

/** Full report returned to the AI / MCP caller. */
export interface PacingReport {
  curve: PacingCurve;
  suggestions: PacingSuggestion[];
  /** Overall pacing score 0–100. Higher = better variety. */
  score: number;
  /** ISO timestamp of when analysis was run. */
  analyzedAt: string;
}
