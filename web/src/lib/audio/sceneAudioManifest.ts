/**
 * Carries the audio a scene declares from `load_scene` across to `SCENE_LOADED`.
 *
 * WHY THIS EXISTS. `entityAudio` is the store's map of which entity plays what,
 * and every audio consumer reads it: the inspector, the accessibility audit, the
 * onboarding checklist, the AI's scene context, and the gameplay/query chat
 * tools. Loading a scene clears the map — correctly, since the outgoing entity
 * ids are about to become meaningless — and nothing ever refilled it.
 *
 * Nothing could. The engine emits `AUDIO_CHANGED` only for the SELECTED entity
 * (`emit_audio_on_selection`, `engine/src/bridge/audio.rs`), so a loaded scene
 * reveals its audio one click at a time and never in bulk. `SCENE_LOADED`'s
 * payload is `{ name }` — it carries nothing to rebuild from. So a scene with
 * ten sounds in it loaded as a scene with none, and the AI was told the scene
 * was silent.
 *
 * The scene JSON is the one copy that does hold the answer, and JS already has
 * it: `sceneSlice.loadScene(json)` is the single funnel through which every
 * scene load passes. This module parses the audio out of that JSON on the way
 * past and holds it until the engine confirms the load.
 *
 * TAKE-ONCE, AND CLEARED BY `new_scene`. `apply_new_scene` emits `SCENE_LOADED`
 * too (`engine/src/bridge/scene_io.rs`), so a stash left behind by a load the
 * engine rejected would otherwise reappear on the next empty scene, attaching
 * audio to entity ids that no longer exist. Taking clears it, and `newScene`
 * clears it explicitly.
 *
 * EVERY FIELD IS READ BY NAME. A `.forge` file is untrusted input — it can come
 * from a user's disk or a shared project — so this never spreads the parsed
 * object into store state. Unknown keys are dropped and every value is checked
 * against its type, with the engine's own defaults as the fallback.
 */

import type { AudioData } from '@/stores/slices/types';
import { AUDIO_CLIP_DOCUMENT_VERSION, MIN_GAIN_DB, MAX_GAIN_DB, type AudioClipDocument } from './audioClipDocument';

/**
 * Mirrors `impl Default for AudioData` in `engine/src/core/audio.rs`.
 *
 * Only `bus` is `#[serde(default)]` on the Rust side, so a scene file missing
 * any other field fails engine deserialization and never reaches `SCENE_LOADED`
 * at all. These defaults are for the file that is malformed in a way the engine
 * tolerates, and for keeping a partial entry usable rather than dropping it.
 */
const ENGINE_AUDIO_DEFAULTS = {
  volume: 1.0,
  pitch: 1.0,
  loopAudio: false,
  spatial: false,
  maxDistance: 50.0,
  refDistance: 1.0,
  rolloffFactor: 1.0,
  autoplay: false,
  bus: 'sfx',
} as const;

const RESERVED_ENTITY_IDS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Engine entity ids are uuids (36 chars). The cap is generous enough that no
 * real id is ever near it, and exists because these keys are not only map keys:
 * an entity with no scene-graph node is rendered by its id in the AI's scene
 * context, so an unbounded string from a `.forge` file is a place that file can
 * write into the model's prompt.
 */
const MAX_ENTITY_ID_LENGTH = 128;

let staged: Record<string, AudioData> = {};

function readNumber(raw: unknown, fallback: number): number {
  // `Number.isFinite` and not a truthiness check: `0` is a legitimate volume,
  // and `NaN`/`Infinity` reach the Web Audio nodes as an exception.
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback;
}

function readBoolean(raw: unknown, fallback: boolean): boolean {
  return typeof raw === 'boolean' ? raw : fallback;
}

function readAudioData(raw: Record<string, unknown>): AudioData {
  return {
    assetId: typeof raw.assetId === 'string' ? raw.assetId : null,
    volume: readNumber(raw.volume, ENGINE_AUDIO_DEFAULTS.volume),
    pitch: readNumber(raw.pitch, ENGINE_AUDIO_DEFAULTS.pitch),
    loopAudio: readBoolean(raw.loopAudio, ENGINE_AUDIO_DEFAULTS.loopAudio),
    spatial: readBoolean(raw.spatial, ENGINE_AUDIO_DEFAULTS.spatial),
    maxDistance: readNumber(raw.maxDistance, ENGINE_AUDIO_DEFAULTS.maxDistance),
    refDistance: readNumber(raw.refDistance, ENGINE_AUDIO_DEFAULTS.refDistance),
    rolloffFactor: readNumber(raw.rolloffFactor, ENGINE_AUDIO_DEFAULTS.rolloffFactor),
    autoplay: readBoolean(raw.autoplay, ENGINE_AUDIO_DEFAULTS.autoplay),
    bus: typeof raw.bus === 'string' && raw.bus.length > 0 ? raw.bus : ENGINE_AUDIO_DEFAULTS.bus,
  };
}

/**
 * Pull `entityId → AudioData` out of a serialized scene.
 *
 * Never throws. A scene JSON this cannot read is a scene whose audio the user
 * simply does not see in the panel — the same place we were before — whereas a
 * throw here would abort `loadScene` before it dispatched and lose the scene.
 */
export function parseSceneAudio(json: string): Record<string, AudioData> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null) return {};

  const entities = (parsed as { entities?: unknown }).entities;
  if (!Array.isArray(entities)) return {};

  const audio: Record<string, AudioData> = {};
  for (const entity of entities) {
    if (typeof entity !== 'object' || entity === null) continue;
    const { entityId, audioData } = entity as { entityId?: unknown; audioData?: unknown };
    if (typeof entityId !== 'string' || entityId.length === 0) continue;
    if (entityId.length > MAX_ENTITY_ID_LENGTH) continue;
    // `audio['__proto__'] = x` on an object literal REPLACES the prototype
    // instead of adding a key, so a scene file naming an entity `__proto__`
    // would make every absent entity report that entity's sound through the
    // prototype chain. Engine entity ids are uuids, so none of these is ever a
    // real id — dropping them costs nothing.
    if (RESERVED_ENTITY_IDS.has(entityId)) continue;
    // `audioData` is `skip_serializing_if = "Option::is_none"`, so an entity
    // with no sound simply has no key — the common case, not an error.
    if (typeof audioData !== 'object' || audioData === null) continue;
    audio[entityId] = readAudioData(audioData as Record<string, unknown>);
  }
  return audio;
}

// ---------------------------------------------------------------------------
// Clip documents (trim/fade/gain/loop) — additive, backward-compatible.
//
// A scene entity MAY carry `audioData.clip`, the persisted `AudioClipDocument`
// describing how its source is trimmed/faded/gained/looped (#9903). It is read
// and written entirely separately from `AudioData` above, which keeps mirroring
// the Rust struct byte-for-byte. An old manifest has no `clip` key, so it reads
// back as "no clip edits" and round-trips unchanged — the same fallback the
// existing `loopAudio`/`readBoolean` pattern gives every other field.
// ---------------------------------------------------------------------------

/**
 * Read a persisted clip document defensively. Returns `null` — meaning "no clip
 * edits, play the source as-is" — for an absent, malformed, or degenerate clip,
 * so a scene file can never inject a corrupt window. A clip is adopted only when
 * it names a source and satisfies the supported version, trim, gain, fade and
 * loop invariants. Missing optional numeric fields retain their defaults.
 * @param raw Untrusted serialized clip value.
 * @returns A validated clip document, or null when the clip cannot be adopted.
 */
export function readClipDocument(raw: unknown): AudioClipDocument | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;

  if (typeof r.sourceAssetId !== 'string' || r.sourceAssetId.length === 0) return null;
  if (r.version !== undefined && r.version !== AUDIO_CLIP_DOCUMENT_VERSION) return null;

  const trimStartSec = readNumber(r.trimStartSec, 0);
  const trimEndSec = readNumber(r.trimEndSec, Number.NaN);
  // A window that is missing, reversed or empty is not a usable edit — drop it
  // rather than fabricate a duration we do not have.
  if (trimStartSec < 0 || !Number.isFinite(trimEndSec) || trimEndSec <= trimStartSec) return null;

  const loopStartSec = readNumber(r.loopStartSec, trimStartSec);
  const loopEndSec = readNumber(r.loopEndSec, trimEndSec);
  const gainDb = readNumber(r.gainDb, 0);
  const fadeInSec = readNumber(r.fadeInSec, 0);
  const fadeOutSec = readNumber(r.fadeOutSec, 0);
  if (gainDb < MIN_GAIN_DB || gainDb > MAX_GAIN_DB) return null;
  if (fadeInSec < 0 || fadeOutSec < 0 || fadeInSec + fadeOutSec > trimEndSec - trimStartSec + 1e-9) return null;
  if (loopStartSec < trimStartSec || loopEndSec > trimEndSec || loopEndSec <= loopStartSec) return null;

  return {
    version: AUDIO_CLIP_DOCUMENT_VERSION,
    sourceAssetId: r.sourceAssetId,
    sourceHash: typeof r.sourceHash === 'string' ? r.sourceHash : '',
    trimStartSec,
    trimEndSec,
    gainDb,
    fadeInSec,
    fadeOutSec,
    loopStartSec,
    loopEndSec,
  };
}

/**
 * The plain object to embed under `audioData.clip` when serializing a scene.
 * Round-trips exactly through {@link readClipDocument}.
 * @param doc A validated clip document in the supported schema version.
 * @returns A plain object containing only persisted clip fields.
 */
export function serializeClipDocument(doc: AudioClipDocument): Record<string, number | string> {
  return {
    version: doc.version,
    sourceAssetId: doc.sourceAssetId,
    sourceHash: doc.sourceHash,
    trimStartSec: doc.trimStartSec,
    trimEndSec: doc.trimEndSec,
    gainDb: doc.gainDb,
    fadeInSec: doc.fadeInSec,
    fadeOutSec: doc.fadeOutSec,
    loopStartSec: doc.loopStartSec,
    loopEndSec: doc.loopEndSec,
  };
}

/**
 * Pull `entityId → AudioClipDocument` out of a serialized scene, reading each
 * entity's `audioData.clip`. Never throws (same contract as `parseSceneAudio`);
 * a scene with no clips returns an empty map.
 * @param json Serialized scene JSON, potentially untrusted.
 * @returns Valid clip documents keyed by entity id; invalid entries are omitted.
 */
export function parseSceneClipDocuments(json: string): Record<string, AudioClipDocument> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null) return {};

  const entities = (parsed as { entities?: unknown }).entities;
  if (!Array.isArray(entities)) return {};

  const clips: Record<string, AudioClipDocument> = {};
  for (const entity of entities) {
    if (typeof entity !== 'object' || entity === null) continue;
    const { entityId, audioData } = entity as { entityId?: unknown; audioData?: unknown };
    if (typeof entityId !== 'string' || entityId.length === 0) continue;
    if (entityId.length > MAX_ENTITY_ID_LENGTH) continue;
    if (RESERVED_ENTITY_IDS.has(entityId)) continue;
    if (typeof audioData !== 'object' || audioData === null) continue;
    const clip = readClipDocument((audioData as Record<string, unknown>).clip);
    if (clip) clips[entityId] = clip;
  }
  return clips;
}

/** Hold a scene's audio until the engine confirms the load. */
export function stageSceneAudio(json: string): void {
  staged = parseSceneAudio(json);
}

/** Claim the staged audio, clearing it so the next load starts empty. */
export function takeStagedSceneAudio(): Record<string, AudioData> {
  const audio = staged;
  staged = {};
  return audio;
}

/**
 * Drop anything staged.
 *
 * For `new_scene`, which emits the same `SCENE_LOADED` a load does: without
 * this, a load the engine rejected leaves a stash that the next empty scene
 * would adopt.
 */
export function clearStagedSceneAudio(): void {
  staged = {};
}
