/**
 * Per-track-type allowlist for cutscene keyframe payloads.
 *
 * `CutsceneKeyframe.payload` is typed `Record<string, unknown>` — a shape that
 * promises nothing — and it is filled by the model: `cutsceneGenerator` copies
 * whatever the response put there straight onto the keyframe. Every sibling
 * field on that keyframe is checked (`timestamp` finite, `duration` non-negative,
 * `easing` allowlisted, the track's `type` allowlisted); the payload, which is
 * the part that reaches the engine, was the one field copied through whole.
 *
 * Downstream, `lib/cutscene/player.ts` turns that payload into an engine
 * command. So an invented key is not inert: the audio track used to spread the
 * payload directly into `play_audio`, which is the documented
 * "never spread LLM objects into engine commands" gotcha with a model on the
 * other end of it.
 *
 * The schema lives here rather than in either consumer because there are two
 * boundaries, not one, and they answer different questions:
 *
 *   - the PARSE boundary (`cutsceneGenerator`) decides what gets persisted into
 *     the store, exported with the project, and drawn in the timeline UI;
 *   - the DISPATCH boundary (`player.buildCommand`) decides what reaches the
 *     engine, and it cannot assume the generator produced its input — the store
 *     also accepts `addKeyframe` from the timeline editor and cutscenes loaded
 *     from a saved project.
 *
 * Both call this, so there is one spelling of the vocabulary rather than two
 * that can drift.
 */

import {
  isCameraMode,
  NUMERIC_CAMERA_FIELDS,
  readCameraFieldValue,
} from '@/lib/game/gameCameraPayload';
import type { CutsceneTrackType } from '@/stores/cutsceneStore';

/**
 * Reads one payload field, returning `undefined` for a value the field cannot
 * hold.
 *
 * `undefined` is an unambiguous "drop this": no field in any track's vocabulary
 * legitimately carries it, and `JSON.parse` cannot produce it.
 */
type FieldReader = (value: unknown) => unknown;

const readFiniteNumber: FieldReader = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const readNonNegativeNumber: FieldReader = (value) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;

/**
 * Bound a value to a closed range, dropping anything outside it.
 *
 * Out of range is DROPPED rather than clamped. These payloads are model output,
 * and a `volume` of `1e308` is not an author asking for maximum loudness — it is
 * a field the generator got wrong. Dropping it leaves the engine on its own
 * default, which is the documented way to say "no opinion" (PF-1126); silently
 * clamping to `1` would invent an opinion the keyframe never expressed and hide
 * the generator bug from anyone reading the saved cutscene.
 */
const readNumberInRange =
  (min: number, max: number): FieldReader =>
  (value) =>
    typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
      ? value
      : undefined;

/** Empty is dropped: a clip or tree named `""` addresses nothing. */
const readNonEmptyString: FieldReader = (value) =>
  typeof value === 'string' && value !== '' ? value : undefined;

/** Display text, unlike an identifier, is legitimately empty. */
const readString: FieldReader = (value) => (typeof value === 'string' ? value : undefined);

const readCameraMode: FieldReader = (value) => (isCameraMode(value) ? value : undefined);

/**
 * `targetEntity` is `string | null` on `GameCameraData`, where `null` is the
 * meaningful "no target" rather than an absent field, so it is kept.
 */
const readTargetEntity: FieldReader = (value) => {
  if (value === null) return null;
  return typeof value === 'string' && value !== '' ? value : undefined;
};

/**
 * Camera parameters are derived from `NUMERIC_CAMERA_FIELDS` rather than
 * re-typed: `gameCameraPayload` owns which of its authoring fields hold a
 * number, and a list copied here would go stale the next time one is added —
 * silently, since a missing entry is a dropped parameter, not a type error.
 *
 * Their READER comes from the same module for the same reason. Mapping every
 * field to `readFiniteNumber` was uniform and wrong: seven of the nine cannot
 * hold a negative (a negative `followSmoothing` makes the follow diverge rather
 * than converge), and two legitimately can (`followHeight` frames from below,
 * `orbitalAutoRotateSpeed` orbits the other way). Only `gameCameraPayload`,
 * which owns the engine mapping, can say which is which.
 */
const CAMERA_FIELDS: Record<string, FieldReader> = {
  mode: readCameraMode,
  targetEntity: readTargetEntity,
  ...Object.fromEntries(
    NUMERIC_CAMERA_FIELDS.map((field) => [
      field,
      ((value: unknown) => readCameraFieldValue(field, value)) satisfies FieldReader,
    ]),
  ),
};

/**
 * The complete payload vocabulary, one entry per track type.
 *
 * The `Record<CutsceneTrackType, …>` annotation is load-bearing in both
 * directions: a new track type on the store's union fails the build until its
 * payload schema is decided here, and a key that is not a track type fails
 * excess-property checking. `wait` is deliberately empty — a timed pause
 * carries nothing, so anything the model attaches to one is invented.
 *
 * These names mirror the schemas the generator's own prompt documents. A field
 * the prompt asks for but this table omits is a field the model is told to
 * produce and this code silently discards, so the two are edited together.
 */
const TRACK_PAYLOAD_FIELDS: Record<CutsceneTrackType, Record<string, FieldReader>> = {
  camera: CAMERA_FIELDS,
  animation: {
    clipName: readNonEmptyString,
    crossfadeSecs: readNonNegativeNumber,
  },
  dialogue: {
    treeId: readNonEmptyString,
    text: readString,
  },
  // Ranges are the audio graph's own, read off `audioManager`: it clamps volume
  // to 0–1 (`audioManager.ts:387`) and pitch — a `playbackRate` — to 0.25–4
  // (`:397`). Neither the engine's `AudioData` nor `handle_set_audio` bounds
  // either field, so this is the only place they are checked. Nothing dispatches
  // these two yet (see the audio arm of `buildCommand` for why); they are
  // authored onto the keyframe and consumed when PF-1155 wires entity audio
  // through to the graph, and bounding them here is what keeps that wiring from
  // inheriting an unbounded field.
  audio: {
    volume: readNumberInRange(0, 1),
    pitch: readNumberInRange(0.25, 4),
  },
  wait: {},
};

/*
 * There is deliberately no `CUTSCENE_TRACK_TYPES` here. The store owns that
 * array and derives `CutsceneTrackType` from it, and `TRACK_PAYLOAD_FIELDS` is a
 * `Record` over that union — so a track type with no payload vocabulary is
 * already a compile error, and a second exported copy of the list under the same
 * name would be the drift it was meant to prevent.
 */

/**
 * The field names a track type accepts. Exported for the test that holds the
 * generator's prompt and this table to each other — the prompt tells the model
 * which fields to write, and a name that appears in one and not the other is
 * either a field asked for and discarded, or a field accepted and never asked
 * for. Neither shows up as a type error.
 */
export function getKeyframePayloadFields(trackType: CutsceneTrackType): string[] {
  return Object.hasOwn(TRACK_PAYLOAD_FIELDS, trackType)
    ? Object.keys(TRACK_PAYLOAD_FIELDS[trackType])
    : [];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Build a keyframe payload containing only fields this track type accepts, each
 * holding a value of the kind that field is for.
 *
 * Picking rather than filtering-in-place is the point: the returned object's own
 * keys are exactly the ones written here, so nothing the model invented can ride
 * along into a caller.
 *
 * That is a guarantee about INVENTED keys, and only that. It is NOT a licence to
 * spread the result into an engine command: every surviving key is one this track
 * type accepts, not necessarily one the receiving command reads. The audio
 * vocabulary is the live example — `volume` and `pitch` are legitimate authored
 * fields that `handle_play_audio` does not read, so spreading a sanitized audio
 * payload into `play_audio` reintroduces exactly the PF-1123 "fields the receiver
 * never reads" defect. Callers pick per command; see `buildCommand`.
 *
 * An unusable payload yields `{}` rather than a throw. A keyframe whose payload
 * the model got wrong is one dud beat in a timeline; failing the parse would
 * discard a whole generated cutscene over it, and every consumer already treats
 * a payload that names nothing actionable as a no-op — `buildCommand` returns
 * null for a camera keyframe with no mode, and now for an animation with no clip
 * and a dialogue with no tree.
 */
export function sanitizeKeyframePayload(
  trackType: CutsceneTrackType,
  raw: unknown,
): Record<string, unknown> {
  // `Object.hasOwn`, not a bare index. `trackType` is typed, but the value
  // arrives from `JSON.parse` on the generator side and from a saved project on
  // the player side, so at runtime it is whatever a string can be.
  //
  // What this guard actually buys is the unknown-track-type case: a bare index
  // gives `undefined`, and `Object.keys(undefined)` throws, so one corrupted
  // track would take down playback rather than yielding an empty payload. The
  // prototype-named cases (`constructor`, `toString`) are handled too, but they
  // are not the reason — `Object.keys(Object)` is `[]`, since every own property
  // of a built-in constructor is non-enumerable, so the loop below would come
  // back empty with or without this line.
  if (!Object.hasOwn(TRACK_PAYLOAD_FIELDS, trackType)) return {};
  const fields = TRACK_PAYLOAD_FIELDS[trackType];
  if (!isObject(raw)) return {};

  const payload: Record<string, unknown> = {};
  for (const key of Object.keys(fields)) {
    // Own keys only, for the same reason: a model-authored payload can carry a
    // `__proto__` entry, and a bare read would pick up a value the author never
    // set and write it here as an own property — indistinguishable, downstream,
    // from one that was really in the response.
    if (!Object.hasOwn(raw, key)) continue;
    const value = fields[key](raw[key]);
    if (value !== undefined) payload[key] = value;
  }
  return payload;
}
