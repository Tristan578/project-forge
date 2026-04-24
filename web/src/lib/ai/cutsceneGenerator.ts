/**
 * Cinematic cutscene generator — converts a natural-language prompt and scene
 * context into a timeline-based Cutscene data structure.
 *
 * Uses fetchAI from client.ts for AI generation and returns validated
 * Cutscene data ready for the cutsceneStore.
 */

import { fetchAI } from './client';
import { getDeepGenerationModel } from './deepTier';
import type { Cutscene, CutsceneTrack, CutsceneKeyframe, CutsceneTrackType, EasingMode } from '@/stores/cutsceneStore';

// ============================================================================
// Generation input types
// ============================================================================

export interface SceneEntityRef {
  id: string;
  name: string;
  type: string;
}

export interface CutsceneGenerationOptions {
  /** Natural language description of the cutscene. */
  prompt: string;
  /** List of entities available in the current scene for context. */
  sceneEntities: SceneEntityRef[];
  /** Desired total duration in seconds. Clamped to max 60. */
  duration?: number;
}

// ============================================================================
// Prompt construction
// ============================================================================

/** Build the AI prompt for cutscene generation. Exported for testing. */
export function buildCutscenePrompt(options: CutsceneGenerationOptions): string {
  const duration = Math.min(options.duration ?? 10, 60);
  const entityList = options.sceneEntities
    .map((e) => `  - id: "${e.id}", name: "${e.name}", type: "${e.type}"`)
    .join('\n');

  return `You are a cinematic director for a video game. Generate a cutscene timeline as valid JSON.

Cutscene description: "${options.prompt}"
Total duration: ${duration} seconds
Maximum duration: 60 seconds

Available scene entities:
${entityList || '  (no entities — use null for entityId)'}

Return a JSON object matching this EXACT schema:
{
  "name": "string — descriptive cutscene name",
  "duration": number,
  "tracks": [
    {
      "id": "track_1",
      "type": "camera|animation|dialogue|audio|wait",
      "entityId": "string or null",
      "muted": false,
      "keyframes": [
        {
          "timestamp": number,
          "duration": number,
          "easing": "linear|ease_in|ease_out|ease_in_out",
          "payload": { ...type-specific fields }
        }
      ]
    }
  ]
}

Track type payload schemas:
- camera: { "mode": "ThirdPerson|FirstPerson|SideScroller|TopDown|Fixed|Orbital", "targetEntityId": "string|null", "offset": [x,y,z] }
- animation: { "clipName": "string", "crossfadeSecs": number }
- dialogue: { "treeId": "string", "text": "string" }
- audio: { "volume": number, "pitch": number }
- wait: {} (empty payload — use for timed pauses)

Rules:
- Track IDs must be unique (use track_1, track_2, etc.)
- Keyframe timestamps must be within [0, duration]
- At least one track must be present
- Camera tracks should have entityId: null
- Timestamps should be in chronological order within each track
- Duration of each keyframe should not cause it to exceed the cutscene total duration
- Return ONLY the JSON, no markdown fences or explanation`;
}

// ============================================================================
// Response validation
// ============================================================================

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const VALID_TRACK_TYPES = new Set<string>(['camera', 'animation', 'dialogue', 'audio', 'wait']);
const VALID_EASING = new Set<string>(['linear', 'ease_in', 'ease_out', 'ease_in_out']);

function validateKeyframe(data: unknown, trackIndex: number, kfIndex: number): CutsceneKeyframe {
  if (!isObject(data)) {
    throw new Error(`Track[${trackIndex}] keyframe[${kfIndex}] must be an object`);
  }
  if (typeof data.timestamp !== 'number' || !Number.isFinite(data.timestamp)) {
    throw new Error(`Track[${trackIndex}] keyframe[${kfIndex}] must have a finite timestamp`);
  }
  if (typeof data.duration !== 'number' || !Number.isFinite(data.duration) || data.duration < 0) {
    throw new Error(`Track[${trackIndex}] keyframe[${kfIndex}] must have a non-negative duration`);
  }
  const easing = typeof data.easing === 'string' && VALID_EASING.has(data.easing)
    ? (data.easing as EasingMode)
    : 'linear';
  const payload = isObject(data.payload) ? (data.payload as Record<string, unknown>) : {};

  return {
    timestamp: data.timestamp as number,
    duration: data.duration as number,
    easing,
    payload,
  };
}

function validateTrack(data: unknown, index: number): CutsceneTrack {
  if (!isObject(data)) {
    throw new Error(`Track[${index}] must be an object`);
  }
  if (typeof data.id !== 'string' || data.id.length === 0) {
    throw new Error(`Track[${index}] must have a non-empty id`);
  }
  if (typeof data.type !== 'string' || !VALID_TRACK_TYPES.has(data.type)) {
    throw new Error(`Track[${index}] type must be one of: ${[...VALID_TRACK_TYPES].join(', ')}`);
  }
  if (!Array.isArray(data.keyframes)) {
    throw new Error(`Track[${index}] must have a keyframes array`);
  }

  const keyframes = (data.keyframes as unknown[]).map((kf, kfIdx) =>
    validateKeyframe(kf, index, kfIdx),
  );
  const entityId = typeof data.entityId === 'string' ? data.entityId : null;
  const muted = data.muted === true;

  return {
    id: data.id as string,
    type: data.type as CutsceneTrackType,
    entityId,
    keyframes,
    muted,
  };
}

/** Parse and validate a raw AI response into a partial Cutscene (without id/timestamps). */
export function parseCutsceneResponse(
  raw: string,
): Omit<Cutscene, 'id' | 'createdAt' | 'updatedAt'> {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    const firstNewline = cleaned.indexOf('\n');
    cleaned = cleaned.slice(firstNewline + 1);
    const lastFence = cleaned.lastIndexOf('```');
    if (lastFence !== -1) {
      cleaned = cleaned.slice(0, lastFence);
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned.trim());
  } catch {
    throw new Error('Failed to parse cutscene response as JSON');
  }

  if (!isObject(parsed)) {
    throw new Error('Cutscene response must be a JSON object');
  }
  if (typeof parsed.name !== 'string' || parsed.name.length === 0) {
    throw new Error('Cutscene must have a non-empty name');
  }
  if (typeof parsed.duration !== 'number' || !Number.isFinite(parsed.duration) || parsed.duration <= 0) {
    throw new Error('Cutscene must have a positive duration');
  }
  if (!Array.isArray(parsed.tracks) || parsed.tracks.length === 0) {
    throw new Error('Cutscene must have at least one track');
  }

  const duration = Math.min(parsed.duration as number, 60);
  const tracks = (parsed.tracks as unknown[]).map((t, i) => validateTrack(t, i));

  return {
    name: parsed.name as string,
    duration,
    tracks,
  };
}

// ============================================================================
// Main generation function
// ============================================================================

/**
 * Generate a cutscene timeline from a natural-language prompt.
 * Returns a complete Cutscene ready to add to the cutsceneStore.
 */
export async function generateCutscene(
  options: CutsceneGenerationOptions,
): Promise<Cutscene> {
  const prompt = buildCutscenePrompt(options);
  const raw = await fetchAI(prompt, {
    model: getDeepGenerationModel('cutscene'),
    systemOverride: 'You are a cinematic director AI for a game engine. Always return valid JSON.',
    priority: 1,
  });

  const partial = parseCutsceneResponse(raw);
  const now = Date.now();
  const id = `cutscene_${now}_${Math.random().toString(36).slice(2, 8)}`;

  return {
    id,
    ...partial,
    createdAt: now,
    updatedAt: now,
  };
}
