/**
 * Validate persisted scene data with the running engine's SceneFile decoder.
 * The browser checks the envelope first; Rust owns every component schema.
 */
import { CURRENT_FORMAT_VERSION } from '@/lib/sceneFile';

/**
 * The engine decoder's verdict. `reason` is the engine's own error text
 * (e.g. `Invalid scene file: missing field … at line 1 column 2`), or `null`
 * when the engine refused without saying why, was unavailable, or threw —
 * so a caller can show the person WHAT was wrong instead of a constant.
 */
export type SceneValidation = { valid: true } | { valid: false; reason: string | null };

/** Longest engine error text the editor will store or relay. */
export const MAX_ENGINE_ERROR_CHARS = 512;
/** Appended when an engine error is cut, so a reader knows text is missing. */
export const ENGINE_ERROR_TRUNCATED = ' … [truncated]';

/**
 * Cap an engine refusal before it is stored or shown.
 *
 * serde_json embeds the ENTIRE offending value in `invalid type: string "…"`,
 * and `sceneData` crosses the remix trust boundary unvalidated (only scripts
 * are quarantined), so a stranger's scene could otherwise dictate the size of
 * the non-dismissible `SceneLoadErrorNotice`, a toast, or the tool-error text
 * fed back to the model. The head of the text — where `Invalid scene file:`
 * and the field name live — is what survives.
 *
 * @param error The engine's error text, verbatim.
 * @param max Maximum length of the RETURNED string, marker included.
 * @returns `error` unchanged when it fits, else its head plus the marker. A
 *   `max` too small to hold the marker and one character of head gets a bare
 *   cut instead, because the bound is the promise; a `max` that is not a
 *   positive number returns the empty string.
 */
export function boundEngineError(error: string, max = MAX_ENGINE_ERROR_CHARS): string {
  if (error.length <= max) return error;
  const marker = max > ENGINE_ERROR_TRUNCATED.length ? ENGINE_ERROR_TRUNCATED : '';
  const keep = max - marker.length;
  let head = error.slice(0, keep > 0 ? keep : 0);
  // Never end on the high half of a surrogate pair: that is not a character.
  const last = head.charCodeAt(head.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) head = head.slice(0, -1);
  return head + marker;
}

type SceneValidator = (json: string) => SceneValidation;
let engineValidator: SceneValidator | null = null;

/** Attach the non-mutating validate_scene command; null disables validation.
 *
 * @param validator Synchronous Rust validation callback, or null while the engine is unavailable.
 * @returns Nothing; replaces the module's validator without applying a scene.
 */
export function setSceneValidator(validator: SceneValidator | null): void {
  engineValidator = validator;
}

/** Check persisted data without depending on engine readiness or browser state.
 *
 * @param value Untrusted parsed scene data.
 * @returns Whether required scene/entity envelope fields have supported shapes; component decoding is deferred.
 */
export function isSceneFileEnvelope(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const scene = value as Record<string, unknown>;
  const record = (item: unknown): item is Record<string, unknown> =>
    !!item && typeof item === 'object' && !Array.isArray(item);
  const vector = (item: unknown, length: number) =>
    Array.isArray(item) && item.length === length && item.every((n) => typeof n === 'number' && Number.isFinite(n));
  if (!Number.isInteger(scene.formatVersion) || (scene.formatVersion as number) < 1 ||
      (scene.formatVersion as number) > CURRENT_FORMAT_VERSION) return false;
  if (!record(scene.metadata) || typeof scene.metadata.name !== 'string') return false;
  if (!record(scene.environment) || !record(scene.ambientLight) ||
      !vector(scene.ambientLight.color, 3) || typeof scene.ambientLight.brightness !== 'number') return false;
  if (!Array.isArray(scene.entities)) return false;
  return scene.entities.every((entity) => record(entity) &&
    typeof entity.entityId === 'string' && entity.entityId.length > 0 &&
    typeof entity.entityType === 'string' && typeof entity.name === 'string' &&
    typeof entity.visible === 'boolean' && record(entity.transform) &&
    vector(entity.transform.position, 3) && vector(entity.transform.rotation, 4) &&
    vector(entity.transform.scale, 3) &&
    (entity.parentId === null || typeof entity.parentId === 'string'));
}

/** Validate every component with Rust before saving or applying a scene.
 *
 * @param value Untrusted parsed scene data to check without mutation.
 * @returns True only when the envelope and attached Rust decoder accept it; false when validation is unavailable or throws.
 */
export function isValidSceneFile(value: unknown): boolean {
  return validateSceneFile(value).valid;
}

/** Validate like [`isValidSceneFile`], keeping the engine's own reason for a refusal.
 *
 * @param value Untrusted parsed scene data to check without mutation.
 * @returns `{ valid: true }`, or `{ valid: false, reason }` where `reason` is the engine's error text (or `ENVELOPE_REFUSAL` when the browser-side envelope check failed first), and `null` only when no decoder is attached or it threw.
 */
export function validateSceneFile(value: unknown): SceneValidation {
  // A failed envelope check is a real refusal with a real reason — never
  // confuse it with "no decoder attached or it threw", which is all `null`
  // means here (the attached validator itself may also answer `null` when
  // the engine refused without saying why).
  if (!isSceneFileEnvelope(value)) return { valid: false, reason: ENVELOPE_REFUSAL };
  if (!engineValidator) return { valid: false, reason: null };
  try {
    return engineValidator(JSON.stringify(value));
  } catch {
    return { valid: false, reason: null };
  }
}

/**
 * The browser-side check's reason when a scene's required top-level parts are
 * missing or malformed; the engine's own decoder never ran. Raw text, kept as
 * is for the AI `validate_scene` tool; a creator reads
 * {@link describeSceneRefusal}'s rendering of it instead.
 */
export const ENVELOPE_REFUSAL =
  'Invalid scene file: a required part (formatVersion, metadata, environment, ambientLight, or entities with finite transforms) is missing or malformed';

/** What a creator reads in place of {@link ENVELOPE_REFUSAL}. */
export const ENVELOPE_REFUSAL_FOR_CREATORS = 'The scene file is incomplete or damaged.';

/** The engine's own prefix; the sentence a creator reads already says the scene failed. */
const ENGINE_REFUSAL_PREFIX = /^(?:Invalid scene file:\s*)+/;
/** serde_json's position suffix, which points into JSON nobody edits by hand. */
const SERDE_POSITION_SUFFIX = /\s+at line \d+ column \d+$/;

/**
 * Turn an engine or envelope refusal into the text a creator reads.
 *
 * Drops the `Invalid scene file:` prefix (the surrounding sentence already
 * says the scene could not be opened, so keeping it repeats that) and serde's
 * trailing `at line N column M`, replaces the browser-side envelope refusal
 * with plain words, and returns one sentence that starts with a capital and
 * ends with punctuation, so callers can append a next step after it. Only for
 * text shown to a person: the AI `validate_scene` tool relays the raw reason,
 * which is what it needs to repair the scene.
 *
 * @param reason Raw refusal text, already bounded by {@link boundEngineError}.
 * @returns Creator-facing text for the same refusal.
 */
export function describeSceneRefusal(reason: string): string {
  if (reason === ENVELOPE_REFUSAL) return ENVELOPE_REFUSAL_FOR_CREATORS;
  const text = reason.replace(ENGINE_REFUSAL_PREFIX, '').replace(SERDE_POSITION_SUFFIX, '').trim();
  if (!text) return 'The engine gave no further detail.';
  const sentence = text.charAt(0).toUpperCase() + text.slice(1);
  return /[.!?\]]$/.test(sentence) ? sentence : `${sentence}.`;
}

/** Produce an empty scene using the same required fields as the engine.
 *
 * @param name Name to place in scene metadata.
 * @returns A new empty current-format scene with required environment and ambient-light defaults.
 */
export function emptySceneFile(name: string) {
  return {
    formatVersion: CURRENT_FORMAT_VERSION,
    metadata: { name, createdAt: '', modifiedAt: '' },
    environment: {
      skyboxBrightness: 1000, iblIntensity: 900, iblRotationDegrees: 0,
      clearColor: [0.1, 0.1, 0.12], fogEnabled: false, fogColor: [0.5, 0.5, 0.55],
      fogStart: 30, fogEnd: 100, skyboxPreset: null, skyboxAssetId: null,
    },
    ambientLight: { color: [1, 1, 1], brightness: 300 },
    entities: [],
  };
}
