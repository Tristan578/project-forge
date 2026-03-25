/**
 * Pacing Analyzer — extracts pacing signals from Zustand store state.
 *
 * Pure analysis: O(n) in entity count, never mutates store state.
 * Input: a snapshot of the relevant store slices.
 * Output: PacingReport ready to be enriched by AI or returned directly.
 */

import type {
  PacingSegment,
  PacingCurve,
  PacingReport,
  PacingSuggestion,
  PacingSignal,
  EmotionTag,
} from './pacingTypes';
import type { SceneGraph } from '@/stores/slices/types';

// ---------------------------------------------------------------------------
// Store snapshot shape — only the slices we actually read
// ---------------------------------------------------------------------------

export interface PacingStoreSnapshot {
  sceneGraph: SceneGraph;
  allGameComponents: Record<string, Array<{ type: string }>>;
  allScripts: Record<string, unknown>;
  audioBuses: Array<{ name: string; volume: number; muted: boolean }>;
}

// ---------------------------------------------------------------------------
// Game component types that contribute to combat / spawner signals
// ---------------------------------------------------------------------------

const COMBAT_COMPONENT_TYPES = new Set([
  'damageZone',
  'health',
  'projectile',
  'follower',
]);

const SPAWNER_COMPONENT_TYPES = new Set(['spawner']);

const COLLECTIBLE_COMPONENT_TYPES = new Set(['collectible']);

const CHECKPOINT_COMPONENT_TYPES = new Set(['checkpoint', 'teleporter', 'winCondition']);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function calcMean(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

function calcVariance(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = calcMean(values);
  let sum = 0;
  for (const v of values) sum += (v - avg) * (v - avg);
  return sum / values.length;
}

function emotionFromSignals(signals: PacingSignal[], intensity: number): EmotionTag {
  // Find the dominant signal type
  let maxVal = -1;
  let dominant: PacingSignal['type'] | null = null;
  for (const s of signals) {
    if (s.value > maxVal) {
      maxVal = s.value;
      dominant = s.type;
    }
  }

  if (intensity < 0.2) return 'calm';
  if (intensity > 0.75) return dominant === 'combat_density' ? 'peak' : 'excitement';

  switch (dominant) {
    case 'combat_density':
    case 'spawner_count':
      return intensity > 0.5 ? 'tension' : 'rising';
    case 'dialogue_density':
      return 'calm';
    case 'audio_intensity':
      return 'wonder';
    case 'camera_variety':
      return 'wonder';
    case 'collectible_density':
      return intensity > 0.5 ? 'excitement' : 'rising';
    default:
      return 'rising';
  }
}

// ---------------------------------------------------------------------------
// Signal extraction — single-pass over scene graph entities
// ---------------------------------------------------------------------------

interface SceneSignals {
  combatCount: number;
  spawnerCount: number;
  collectibleCount: number;
  checkpointCount: number;
  scriptCount: number;
  entityCount: number;
}

function extractSceneSignals(
  entityIds: string[],
  allGameComponents: Record<string, Array<{ type: string }>>,
  allScripts: Record<string, unknown>,
): SceneSignals {
  const signals: SceneSignals = {
    combatCount: 0,
    spawnerCount: 0,
    collectibleCount: 0,
    checkpointCount: 0,
    scriptCount: 0,
    entityCount: entityIds.length,
  };

  for (const eid of entityIds) {
    const components = allGameComponents[eid] ?? [];
    for (const comp of components) {
      if (COMBAT_COMPONENT_TYPES.has(comp.type)) signals.combatCount++;
      if (SPAWNER_COMPONENT_TYPES.has(comp.type)) signals.spawnerCount++;
      if (COLLECTIBLE_COMPONENT_TYPES.has(comp.type)) signals.collectibleCount++;
      if (CHECKPOINT_COMPONENT_TYPES.has(comp.type)) signals.checkpointCount++;
    }
    if (allScripts[eid]) signals.scriptCount++;
  }

  return signals;
}

function buildPacingSignals(
  raw: SceneSignals,
  audioBusCount: number,
): PacingSignal[] {
  const entityDenom = Math.max(raw.entityCount, 1);
  const pacingSignals: PacingSignal[] = [];

  if (raw.combatCount > 0) {
    pacingSignals.push({
      type: 'combat_density',
      value: clamp(raw.combatCount / entityDenom, 0, 1),
      description: `${raw.combatCount} combat components (damage zones, health, projectiles, followers)`,
    });
  }

  if (raw.spawnerCount > 0) {
    pacingSignals.push({
      type: 'spawner_count',
      value: clamp(raw.spawnerCount / entityDenom, 0, 1),
      description: `${raw.spawnerCount} spawner(s) add dynamic threat density`,
    });
  }

  if (raw.collectibleCount > 0) {
    pacingSignals.push({
      type: 'collectible_density',
      value: clamp(raw.collectibleCount / entityDenom, 0, 1),
      description: `${raw.collectibleCount} collectible(s) create reward moments`,
    });
  }

  if (raw.checkpointCount > 0) {
    pacingSignals.push({
      type: 'dialogue_density',
      value: clamp(raw.checkpointCount / entityDenom, 0, 1),
      description: `${raw.checkpointCount} checkpoint/teleporter/win-condition(s) provide relief moments`,
    });
  }

  if (raw.scriptCount > 0) {
    pacingSignals.push({
      type: 'script_count',
      value: clamp(raw.scriptCount / entityDenom, 0, 1),
      description: `${raw.scriptCount} scripted entities add unpredictability`,
    });
  }

  if (audioBusCount > 0) {
    pacingSignals.push({
      type: 'audio_intensity',
      value: clamp(audioBusCount / 8, 0, 1),
      description: `${audioBusCount} audio bus(es) configured`,
    });
  }

  return pacingSignals;
}

function computeIntensity(pacingSignals: PacingSignal[]): number {
  if (pacingSignals.length === 0) return 0;

  // Weighted combination — combat has highest weight
  const WEIGHTS: Record<PacingSignal['type'], number> = {
    combat_density: 0.40,
    spawner_count: 0.25,
    collectible_density: 0.10,
    dialogue_density: -0.10, // checkpoints reduce tension
    audio_intensity: 0.10,
    camera_variety: 0.05,
    script_count: 0.10,
  };

  let total = 0;
  let weightSum = 0;
  for (const s of pacingSignals) {
    const w = WEIGHTS[s.type] ?? 0.05;
    total += s.value * w;
    weightSum += Math.abs(w);
  }

  return clamp(weightSum > 0 ? total / weightSum : 0, 0, 1);
}

// ---------------------------------------------------------------------------
// Suggestion generation (local, no AI)
// ---------------------------------------------------------------------------

function generateLocalSuggestions(curve: PacingCurve): PacingSuggestion[] {
  const suggestions: PacingSuggestion[] = [];
  const segments = curve.segments;

  if (segments.length === 0) {
    suggestions.push({
      title: 'Add gameplay elements',
      description:
        'No scenes with gameplay components were found. Add game components like damage zones, collectibles, or checkpoints to create an emotional arc.',
      targetSceneIndex: null,
      priority: 'high',
    });
    return suggestions;
  }

  // Detect flat pacing
  if (curve.variance < 0.02 && segments.length > 1) {
    suggestions.push({
      title: 'Increase emotional variety',
      description:
        'The pacing curve is very flat — all scenes have similar intensity. Alternate high-action scenes with rest/reward scenes to create rhythm and prevent player fatigue.',
      targetSceneIndex: null,
      priority: 'high',
    });
  }

  // No climax
  const maxIntensity = segments.reduce((a, s) => Math.max(a, s.intensity), 0);
  if (maxIntensity < 0.5 && segments.length > 1) {
    const lastThirdStart = Math.floor(segments.length * 0.7);
    suggestions.push({
      title: 'Add a climax moment',
      description:
        'Peak intensity never exceeds 0.5. Great games have a high-stakes climax near the 70–90% mark. Consider adding a boss fight, damage zone gauntlet, or spawner cluster in the final scenes.',
      targetSceneIndex: lastThirdStart,
      priority: 'high',
    });
  }

  // All high — no rest
  const minIntensity = segments.reduce((a, s) => Math.min(a, s.intensity), Infinity);
  if (minIntensity > 0.4 && segments.length > 2) {
    suggestions.push({
      title: 'Add a rest beat',
      description:
        'Intensity never drops below 0.4. Players need breathing room — add a checkpoint, collectible area, or dialogue-only scene to let the tension release before the next peak.',
      targetSceneIndex: null,
      priority: 'medium',
    });
  }

  // Flat start
  if (segments.length > 0 && segments[0].intensity < 0.1) {
    suggestions.push({
      title: 'Strengthen the opening hook',
      description:
        'The first scene is very quiet (intensity < 0.1). Consider adding an early action beat or dramatic trigger zone to capture player attention immediately.',
      targetSceneIndex: 0,
      priority: 'medium',
    });
  }

  // High-intensity ending (no resolution)
  const lastSeg = segments[segments.length - 1];
  if (lastSeg && lastSeg.intensity > 0.7) {
    suggestions.push({
      title: 'Add a resolution scene',
      description:
        'The game ends at high intensity. A cool-down scene after the final climax gives players closure. Add a checkpoint or reward-focused final scene.',
      targetSceneIndex: lastSeg.sceneIndex,
      priority: 'low',
    });
  }

  return suggestions;
}

// ---------------------------------------------------------------------------
// Score calculation
// ---------------------------------------------------------------------------

function computeScore(curve: PacingCurve, suggestions: PacingSuggestion[]): number {
  let score = 100;
  for (const s of suggestions) {
    if (s.priority === 'high') score -= 20;
    else if (s.priority === 'medium') score -= 10;
    else score -= 5;
  }
  // Reward variance
  const varianceBonus = Math.round(curve.variance * 20);
  score += varianceBonus;
  return clamp(score, 0, 100);
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Extract pacing signals from store state and produce a PacingReport.
 * O(n) in total entity count across all scenes.
 * Does not call any AI API — call /api/generate/pacing to get AI suggestions.
 */
export function extractPacingReport(snapshot: PacingStoreSnapshot): PacingReport {
  const { sceneGraph, allGameComponents, allScripts, audioBuses } = snapshot;
  const audioBusCount = audioBuses.filter((b) => !b.muted).length;

  // Group entity IDs by scene name prefix or treat all as one scene
  // The scene graph is flat (no multi-scene concept in editor store) —
  // we group entities into logical "scenes" by their name prefix (e.g. "Scene1/")
  // or fall back to treating the whole graph as scene 0.
  const sceneGroups = groupEntitiesByScene(sceneGraph);

  const MAX_SEGMENTS = 100;
  const segmentEntries = sceneGroups.slice(0, MAX_SEGMENTS);

  const segments: PacingSegment[] = segmentEntries.map(({ sceneName, entityIds }, idx) => {
    const raw = extractSceneSignals(entityIds, allGameComponents, allScripts);
    const signals = buildPacingSignals(raw, audioBusCount);
    const intensity = computeIntensity(signals);
    const emotion = emotionFromSignals(signals, intensity);

    return {
      sceneIndex: idx,
      sceneName,
      intensity,
      emotion,
      signals,
    };
  });

  const intensities = segments.map((s) => s.intensity);
  const curve: PacingCurve = {
    segments,
    averageIntensity: calcMean(intensities),
    variance: calcVariance(intensities),
  };

  const suggestions = generateLocalSuggestions(curve);
  const score = computeScore(curve, suggestions);

  return {
    curve,
    suggestions,
    score,
    analyzedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Scene grouping — infers scene boundaries from entity name prefixes
// ---------------------------------------------------------------------------

interface SceneGroup {
  sceneName: string;
  entityIds: string[];
}

function groupEntitiesByScene(sceneGraph: SceneGraph): SceneGroup[] {
  const groups: Map<string, string[]> = new Map();

  for (const node of Object.values(sceneGraph.nodes)) {
    // Use slash-prefix (e.g. "Level1/Enemy") or fall back to "Scene 1"
    const slashIdx = node.name.indexOf('/');
    const groupKey = slashIdx > 0 ? node.name.slice(0, slashIdx) : 'Scene 1';
    const existing = groups.get(groupKey);
    if (existing) {
      existing.push(node.entityId);
    } else {
      groups.set(groupKey, [node.entityId]);
    }
  }

  if (groups.size === 0) {
    return [{ sceneName: 'Scene 1', entityIds: [] }];
  }

  return Array.from(groups.entries()).map(([sceneName, entityIds]) => ({
    sceneName,
    entityIds,
  }));
}
