/**
 * Shared camera resolution for the game-creation pipeline.
 *
 * Three helpers that were each written twice or more:
 *
 *  - `normalizeCameraMode` — two copies of an eight-pair alias map plus a third
 *    hand-typed copy of the mode list lived in `sceneCreateExecutor`.
 *  - `resolveCameraEntityId` — the name heuristic was inline in
 *    `autoPolishExecutor` and needed a second copy for `camera_setup`.
 *  - `filterCameraNumerics` — the allowlist loop was inline twice in
 *    `sceneCreateExecutor`.
 *
 * Every consumer here is reachable from `/api/game/decompose` through the
 * executor barrel, so this module must never take a VALUE import on `@/stores`
 * or `@/hooks/useEngine` — that edge is traced by Turbopack and breaks the RSC
 * build (see `__tests__/serverSafeImports.test.ts`). Hence the
 * type-only import below and the structural node parameter: callers pass the
 * nodes in, this module never reaches for the store itself.
 */

import { isCameraMode, NUMERIC_CAMERA_FIELDS } from '@/lib/game/gameCameraPayload';
import type { NumericCameraField } from '@/lib/game/gameCameraPayload';
import type { GameCameraMode } from '@/stores/slices/types';

/**
 * Hyphenated/underscored spellings the GDD generator produces, mapped onto the
 * engine's camelCase mode names.
 *
 * This table must cover what the PRODUCERS actually emit, not what reads like a
 * plausible spelling. `systemDecomposer.ts` picks its camera `defaultType` from
 * a fixed list — `side-scroll`, `top-down`, `first-person`, `third-person`,
 * `orbit` — and the GDD fixtures add `follow` and `fixed`. Three of those
 * (`side-scroll`, `orbit`, `follow`) were missing here, so they fell through to
 * the default: every 2D side-scroller the decomposer produced was normalized to
 * `thirdPersonFollow`, which is the exact case PF-1125 was filed to fix. The
 * fallback made that invisible — an unmapped mode does not throw, it silently
 * becomes a third-person camera.
 *
 * `cameraModeVocabulary.test.ts` reads the producer's own list out of
 * `systemDecomposer.ts` and fails when a spelling appears there without an entry
 * here, so the next mode added to the decomposer cannot repeat this.
 */
const CAMERA_MODE_ALIASES: Record<string, GameCameraMode> = {
  'side-scroll': 'sideScroller',
  'side_scroll': 'sideScroller',
  'sidescroll': 'sideScroller',
  'side-scroller': 'sideScroller',
  'side_scroller': 'sideScroller',
  'sidescroller': 'sideScroller',
  'third-person': 'thirdPersonFollow',
  'third_person': 'thirdPersonFollow',
  // The GDD's most common spelling by far — 5 of the 11 fixtures. It resolved
  // correctly before only by accident, because the unknown-mode fallback happens
  // to be the mode it means.
  'follow': 'thirdPersonFollow',
  'first-person': 'firstPerson',
  'first_person': 'firstPerson',
  'top-down': 'topDown',
  'top_down': 'topDown',
  'orbit': 'orbital',
};

/**
 * Resolve a model-authored camera mode to one the engine recognizes.
 *
 * Falls back rather than passing the string through: the engine's `from_flat`
 * rejects any mode it does not know, and a rejected `set_game_camera` is a
 * silent no-op (PF-1126).
 *
 * The fallback is project-type aware. A 2D game given an unrecognized mode wants
 * `sideScroller`, not a third-person follow camera pointed at a flat scene —
 * `autoPolishExecutor` already branches this way when it repairs a missing
 * camera, and the two disagreeing meant the repair path and the authoring path
 * produced different cameras for the same game.
 */
export function normalizeCameraMode(
  raw: unknown,
  projectType?: '2d' | '3d',
): GameCameraMode {
  const fallback: GameCameraMode = projectType === '2d' ? 'sideScroller' : 'thirdPersonFollow';
  if (typeof raw !== 'string') return fallback;
  // Exact match first, on the ORIGINAL string. The engine's mode names are
  // camelCase, so testing the lowercased form against them would reject
  // `sideScroller` — the alias lookup is lowercased, the mode check must not be.
  if (isCameraMode(raw)) return raw;
  // Own-key read, though `isCameraMode` would catch the fallout either way: a GDD
  // mode string of `constructor` makes a bare `CAMERA_MODE_ALIASES[key]` return
  // `Object.prototype.constructor`, which is not nullish, so `??` does not fall
  // back and a FUNCTION reaches the narrowing check. It fails there and the
  // default is returned, so the bare form is not exploitable — but it gets there
  // by accident, and the guard says what was meant.
  const key = raw.toLowerCase();
  const aliased = Object.hasOwn(CAMERA_MODE_ALIASES, key) ? CAMERA_MODE_ALIASES[key] : raw;
  return isCameraMode(aliased) ? aliased : fallback;
}

/**
 * The camera modes that do NOTHING without a target entity.
 *
 * This is not a style preference — it is the engine's control flow. In
 * `engine/src/core/game_camera.rs`, `target_transform` is `None` whenever
 * `target_entity` is `None`, and the ThirdPersonFollow, FirstPerson,
 * SideScroller, TopDown and Orbital arms are each wrapped in
 * `if let Some(target_t) = target_transform`. So a targetless camera in any of
 * those modes never has its transform touched: it sits motionless for the whole
 * game while `set_game_camera` reports success and the store shows the mode the
 * GDD asked for. That is the same "looks applied, does nothing" symptom PF-1125
 * was filed to fix, one layer further down.
 *
 * `fixed` is the sole mode that works targetless — it reads `look_at`, a Vec3,
 * which is not a numeric field and so cannot arrive through `cameraConfig`.
 */
const CAMERA_MODES_REQUIRING_TARGET: ReadonlySet<GameCameraMode> = new Set<GameCameraMode>([
  'thirdPersonFollow',
  'firstPerson',
  'sideScroller',
  'topDown',
  'orbital',
]);

/** Whether `mode` is inert unless `targetEntity` names a live entity. */
export function cameraModeNeedsTarget(mode: GameCameraMode): boolean {
  return CAMERA_MODES_REQUIRING_TARGET.has(mode);
}

/** The minimum a scene-graph node must expose for camera resolution. */
export interface CameraCandidateNode {
  name: string;
  entityId: string;
}

/**
 * Whether an entity name reads as the scene's camera.
 *
 * Exported so `verify_all_scenes` decides "this scene has no camera" by the same
 * rule `camera_setup` and `auto_polish` use to FIND one. Three copies of this
 * heuristic drifting apart is how verification comes to report a missing camera
 * that the next step then configures — or worse, passes a scene whose camera
 * neither of the other two can see.
 *
 * No exact-`camera` disjunct: `'camera'.endsWith('camera')` is already true, so
 * it would read as a third rule that never decides anything.
 */
export function looksLikeCameraName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith('camera') || lower.endsWith('_cam');
}

/**
 * Find the scene's camera entity by name.
 *
 * Callers MUST pass nodes read live at the moment of dispatch, never a snapshot
 * taken at pipeline start: the orchestrator builds the executor context once and
 * every step reuses it, so a snapshot cannot see entities the pipeline itself
 * spawned, and `set_game_camera` against an id that does not exist is a silent
 * no-op (PF-1118).
 */
export function resolveCameraEntityId(nodes: readonly CameraCandidateNode[]): string | null {
  const match = nodes.find((n) => looksLikeCameraName(n.name));
  if (!match) return null;
  return typeof match.entityId === 'string' && match.entityId.trim().length > 0
    ? match.entityId
    : null;
}

/**
 * A finite number that the engine still cannot use for a particular field.
 *
 * Almost every camera parameter is coherent across the whole real line, and this
 * module has no business refusing an unusual framing an author chose on purpose:
 * a negative `followDistance` frames from in front (the engine writes
 * `offset[2] = -distance`), a negative `firstPersonMouseSensitivity` is inverted
 * look, a negative `orbitalDistance` is a 180-degree phase shift, and a negative
 * `orbitalAutoRotateSpeed` orbits the other way. Refusing those would substitute
 * this module's taste for the author's, which is the same silent substitution
 * the range policy exists to prevent.
 *
 * `followSmoothing` is the one field where a sign is not a preference. The
 * engine follows with `t = follow_lerp_factor(damping, delta)`, which clamps
 * `damping * delta` to [0, 1], and then `translation.lerp(target, t)`. Before
 * that floor `t` was `(damping * delta).min(1.0)`, capped above but not below,
 * so a negative damping extrapolated AWAY from the target and compounded — at
 * 60fps with damping -3 the gap grew about 16x per second (PF-1166). With the
 * floor a negative damping is a camera frozen where it is. Neither is a framing
 * anyone authors, and the engine's `flat_damping` now refuses a negative rate
 * outright — taking the whole full-replace `set_game_camera` command with it,
 * which is why it must be dropped here rather than sent.
 *
 * Exactly 0.0 stays legal: it is a frozen follow, the engine has a test pinning
 * that it survives `from_flat`, and it is reachable by other means.
 *
 * No upper bound is needed: the clamp's 1.0 ceiling already saturates a
 * too-large damping into "snap to the target", which is a coherent outcome. The
 * asymmetry is the engine's, not an omission here.
 */
interface CameraValuePolicy {
  accepts: (value: number) => boolean;
  /** Reported verbatim to the author, so it must read as a sentence fragment. */
  reason: string;
}

const CAMERA_VALUE_POLICIES: Partial<Record<NumericCameraField, CameraValuePolicy>> = {
  followSmoothing: {
    accepts: (value) => value >= 0,
    reason: 'must not be negative',
  },
};

const NOT_A_FINITE_NUMBER = 'not a finite number';

/**
 * Why this value cannot be sent for this field, or `null` if it can.
 *
 * The single predicate behind both {@link filterCameraNumerics} and
 * {@link classifyCameraConfigKeys}. They used to duplicate the finite/alias
 * logic, which meant a value one of them started refusing was reported by
 * NEITHER: the filter dropped it and the reporter, seeing a finite number under
 * a real field name, called it applied.
 */
function cameraValueRejection(field: NumericCameraField, value: unknown): string | null {
  // `Number.isFinite`, not a truthiness check: `0` is a legitimate value for
  // several of these, and `NaN`/`Infinity` would deserialize into the engine as
  // a f32 the transform step then propagates through the whole scene.
  if (typeof value !== 'number' || !Number.isFinite(value)) return NOT_A_FINITE_NUMBER;
  const policy = CAMERA_VALUE_POLICIES[field];
  return policy && !policy.accepts(value) ? policy.reason : null;
}

/**
 * Narrowing view of {@link cameraValueRejection}, for the write path.
 *
 * A type predicate rather than `out[key] = val as number` after the check: the
 * cast asserts the very thing the check just proved, so it keeps type-checking if
 * the check is ever reordered, weakened or dropped — which is how a value the
 * policy refuses reaches the engine anyway. Same shape as `usableOverride` in
 * `physicsProfileResolution.ts`, the house pattern for this.
 */
function isSendableCameraValue(
  field: NumericCameraField,
  value: unknown,
): value is number {
  return cameraValueRejection(field, value) === null;
}

function asCameraField(key: string): NumericCameraField | undefined {
  const fields: readonly string[] = NUMERIC_CAMERA_FIELDS;
  return fields.includes(key) ? (key as NumericCameraField) : undefined;
}

/**
 * Project a GDD-authored camera config onto the numeric fields the engine can
 * actually receive.
 *
 * The allowlist is derived from the translator's own field list rather than
 * re-typed, so a parameter cannot be accepted here without an engine mapping.
 * The hand-written lists this replaces carried two names no engine variant has
 * (`sideScrollerHeight`, `topDownAngle`) and one of them omitted
 * `firstPersonMouseSensitivity`, which a variant does have.
 *
 * Everything this drops is reported by {@link classifyCameraConfigKeys} — the
 * drop being silent is the PF-1125/PF-1166 defect itself.
 */
export function filterCameraNumerics(
  raw: unknown,
): Partial<Record<NumericCameraField, number>> {
  const out: Partial<Record<NumericCameraField, number>> = {};
  if (!raw || typeof raw !== 'object') return out;
  const obj = raw as Record<string, unknown>;
  for (const key of NUMERIC_CAMERA_FIELDS) {
    // Own keys only. This object is GDD-derived, so the model controls its keys
    // and a bare read walks the prototype chain.
    if (!Object.hasOwn(obj, key)) continue;
    const val = obj[key];
    if (isSendableCameraValue(key, val)) out[key] = val;
  }
  // A GDD-spelled key only fills a field the translator's own names left unset,
  // so an explicit `topDownHeight` always beats an aliased `altitude`.
  for (const [alias, entry] of Object.entries(GDD_CONFIG_KEY_ALIASES)) {
    const { field, convert } = entry;
    if (out[field] !== undefined) continue;
    if (!Object.hasOwn(obj, alias)) continue;
    // Domain first, in the GDD's unit, then the engine's policy on the
    // converted value — the same two checks in the same order as
    // `classifyCameraConfigKeys`, so what one drops the other names.
    if (aliasDomainRejection(entry, obj[alias]) !== null) continue;
    const val = convertAliasedValue(obj[alias], convert);
    if (isSendableCameraValue(field, val)) out[field] = val;
  }
  return out;
}

/**
 * Apply a {@link GddConfigAlias.convert} only to a value it can actually take.
 *
 * `convert` is typed `(value: number) => number` — it has no obligation to
 * handle a string, an array, or `NaN` sensibly, and calling it on one would
 * make the conversion function responsible for a check this module already
 * owns. A non-finite-number input is passed through UNCONVERTED instead, so
 * {@link cameraValueRejection}'s own `typeof`/`Number.isFinite` guard is what
 * rejects it — with the same `"not a finite number"` reason a direct field
 * gets, rather than a conversion-specific one that would say the wrong thing.
 */
function convertAliasedValue(raw: unknown, convert: (value: number) => number): unknown {
  return typeof raw === 'number' && Number.isFinite(raw) ? convert(raw) : raw;
}

/**
 * A GDD spelling that reaches an engine field, plus how to get its VALUE from
 * the GDD's unit into the engine's.
 *
 * Split out from a bare `Record<string, NumericCameraField>` because that shape
 * cannot express `smoothing`: the GDD and engine units disagree there, and a
 * rename is not a conversion. `convert` is required rather than optional so a
 * new entry cannot forget to say which — `identityConversion` names the "no,
 * really, the units already match" case rather than leaving it implicit.
 */
interface GddConfigAlias {
  field: NumericCameraField;
  /** GDD unit -> engine unit. The identity function where the two agree. */
  convert: (value: number) => number;
  /**
   * The range a value must lie in IN THE GDD's UNIT, checked before `convert`.
   *
   * The engine-side policy on `field` judges the CONVERTED value, and a
   * conversion can carry a nonsensical input into a range the engine accepts:
   * `smoothing: 5` — five times "close the whole gap this frame" — converts to
   * damping 300, which the engine reads as a legal, very snappy rate, so the
   * step reported `applied: true` for a value that had no meaning where it was
   * written. `null` states, rather than leaves implicit, that every finite
   * number is meaningful in the GDD unit and the engine-side policy is the
   * whole check.
   */
  domain: CameraValuePolicy | null;
}

/**
 * Why this GDD-unit value is outside its alias's domain, or `null` if it is not.
 *
 * Only a finite number can be out of range; anything else passes through to
 * {@link cameraValueRejection}'s own `typeof`/`Number.isFinite` guard so it is
 * reported with the ordinary "not a finite number" reason rather than a
 * range one. Shared by {@link filterCameraNumerics} and
 * {@link classifyCameraConfigKeys} for the same reason `cameraValueRejection`
 * is: a value one drops must be a value the other names.
 */
function aliasDomainRejection(alias: GddConfigAlias, raw: unknown): string | null {
  if (!alias.domain) return null;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  return alias.domain.accepts(raw) ? null : alias.domain.reason;
}

function identityConversion(value: number): number {
  return value;
}

/**
 * The frame time `smoothing` is anchored to, for {@link convertGddSmoothingToDamping}.
 *
 * Not a claim about the engine's actual step size, which is whatever `delta`
 * a given frame took — this is a fixed reference point, chosen because it is
 * the SAME one `game_camera.rs`'s own tests use throughout
 * (`follow_lerp_factor(5.0, 1.0 / 60.0)` and every `update_*` test call site):
 * 60fps is this codebase's baseline assumption for "a frame", not a number
 * invented for this conversion.
 */
const GDD_SMOOTHING_REFERENCE_DELTA_SECONDS = 1 / 60;

/**
 * Convert the GDD's authored `smoothing` into the engine's `followSmoothing`
 * (wire name `damping`).
 *
 * The GDD's `smoothing` is read as the fraction of the remaining
 * camera-to-target gap that should close on ONE rendered frame (inferred from
 * this module's fixtures; the producer does not pin it — see the last
 * paragraph) — the familiar
 * `Vector3.Lerp(current, target, smoothing)`-per-frame authoring convention,
 * where the value is called "smoothing" despite bigger meaning SNAPPIER, not
 * more smoothed. The engine instead stores a rate and multiplies by whatever
 * `delta` the frame actually took: `t = damping * delta`, clamped to [0, 1]
 * (`follow_lerp_factor` in `game_camera.rs`). Both
 * quantities move the SAME direction — bigger closes more of the gap per
 * frame — so this is a pure rescale, not a sign flip or an inversion, and
 * inverting `t = damping * delta` at the reference frame time above gives
 * `damping = smoothing / delta`.
 *
 * That the reference point is right, not just self-consistent, is checkable
 * against this module's own fixtures (`__fixtures__/*.json`): GDD-authored
 * `smoothing` values of 0.05/0.08/0.1 land at damping 3/4.8/6 — all close to
 * the engine's OWN default follow damping of 5 (`ENGINE_CAMERA_DEFAULTS.followSmoothing`
 * in `gameCameraPayload.ts`). A wrong reference delta would have scattered
 * these into a wildly different regime instead of clustering near the value
 * the engine already treats as "normal".
 *
 * Sign and magnitude are otherwise untouched — a negative `smoothing` yields a
 * negative `damping`, which `cameraValueRejection` still refuses for the exact
 * same reason a hand-authored negative `followSmoothing` is refused (PF-1166).
 *
 * The UPPER end is not left to the engine. A per-frame fraction above 1 has
 * no meaning — there is no "close 500% of the gap" — but converted it becomes
 * damping 300, a rate the engine's 1.0 ceiling saturates into an exact snap
 * and accepts without complaint, so the step would report `applied: true` for
 * a value that was nonsense where it was written. That is what the alias's
 * `domain` (see {@link GDD_CONFIG_KEY_ALIASES}) refuses BEFORE this runs.
 *
 * Exactly 0 is refused there too. Under the per-frame convention it means
 * "close none of the gap" and converts to damping 0, which the engine runs as
 * a frozen follow: a camera that never moves while the step reports
 * `applied: true`. But no contract tells the producer that convention, and
 * read as plain English `smoothing: 0` means "no smoothing" — a rigid, instant
 * follow, the opposite extreme. A generated design never wants a following
 * camera that does not follow (that is the `fixed` mode), so the value with
 * the worst failure under a misreading is reported and the engine keeps its
 * default instead.
 *
 * Nothing on the producer side pins this unit. The GDD decomposer types every
 * system's `config` as `z.record(z.string(), z.unknown())` and its prompt
 * shows only a `{ "gravity": 20 }` example (`decomposer.ts`), so no schema
 * or prompt tells the model what `smoothing` means — the 0..1 convention is
 * inferred from this module's own fixtures. The domain check is the
 * consumer-side stand-in for that missing contract; a per-category config
 * schema on the producer is the real one.
 */
function convertGddSmoothingToDamping(smoothing: number): number {
  return smoothing / GDD_SMOOTHING_REFERENCE_DELTA_SECONDS;
}

/**
 * GDD config spellings that map onto an engine parameter — verbatim where the
 * units already agree, and through {@link GddConfigAlias.convert} where they
 * do not.
 *
 * Deliberately short relative to the GDD's real vocabulary. The GDD's camera
 * `config` vocabulary and the engine's parameter list were written
 * independently: the keys the generator actually emits are `altitude`, `tilt`,
 * `smoothing`, `offset`, `perspective`, `followX`, `followY`, `leadAhead`,
 * `zoomMin`, `zoomMax`, `canOrbit` and `locked`, while the translator accepts
 * `followDistance`, `followHeight`, `topDownHeight` and friends. Before any
 * entry existed here, `filterCameraNumerics` returned `{}` for 100% of real GDD
 * input while the step still reported `applied: true` (PF-1125).
 *
 * `smoothing` -> `followSmoothing` needs {@link convertGddSmoothingToDamping}
 * rather than a bare rename, because the GDD's unit (a 0..1 per-frame lerp
 * fraction) and the engine's unit (a per-second rate) disagree — forwarding
 * `smoothing: 0.1` unconverted would have run the follow ~50x slower than
 * default, a camera that visibly lags the player. See that function for the
 * derivation (PF-1134).
 *
 * Four more of the generator's keys have NO engine parameter under any
 * spelling — confirmed here rather than merely assumed, so the next reader
 * does not go looking for one:
 *   - `tilt` — no camera mode exposes an authored tilt/pitch angle. `topDown`
 *     is height/damping/followRotation; `firstPerson`'s only angular control
 *     is `pitchClamp`, a *limit* on player-driven look, not a value to author.
 *   - `perspective` — a categorical label (e.g. `"over-shoulder"`), not a
 *     magnitude, so there is no numeric field it could become.
 *   - `locked` / `canOrbit` — booleans with no engine-side counterpart. The
 *     nearest control, `orbital`'s `autoRotate`, is DERIVED from
 *     `orbitalAutoRotateSpeed` (see `buildSetGameCameraPayload`) rather than
 *     authored directly, so there is nothing for `canOrbit` to alias either.
 * All four already land in {@link classifyCameraConfigKeys}'s `unknown`
 * bucket with no code change required — this comment is the acceptance
 * criterion that PF-1134 asked for, not a promise of future work.
 *
 * The rest of the generator's vocabulary — `followX`, `followY`, `offset`,
 * `leadAhead`, `zoomMin`, `zoomMax` — are candidates for the `offset` vector
 * and the side-scroller/orbital parameters, but are NOT settled: each needs
 * its own check against the specific engine arm it would target, the same way
 * `smoothing` needed a derived conversion rather than a rename. Guessing here
 * would repeat the exact mistake this module exists to avoid — a wrong number
 * is worse than a reported omission — so they stay unmapped and REPORTED
 * (never silently dropped) by {@link classifyCameraConfigKeys} until that work
 * happens.
 */
const GDD_CONFIG_KEY_ALIASES: Record<string, GddConfigAlias> = {
  altitude: { field: 'topDownHeight', convert: identityConversion, domain: null },
  smoothing: {
    field: 'followSmoothing',
    convert: convertGddSmoothingToDamping,
    // A per-frame lerp fraction lives in (0, 1]. A negative one is left to
    // `followSmoothing`'s own policy, which refuses the negative rate it
    // converts to with the reason that names the actual hazard (divergence).
    // Exactly 0 (and -0, which `!==` treats the same) is refused HERE: it
    // converts to a frozen follow, the opposite of what "no smoothing" means
    // in plain English — see `convertGddSmoothingToDamping`.
    domain: {
      accepts: (value) => value !== 0 && value <= 1,
      // Read inside the executor's own "key (reason)" parentheses, by an
      // author who may not know the word "lerp" — so no nested parens and no
      // jargon. ONE reason covers every refused value (0, -0 and anything
      // above 1), so it names the domain and what happens next rather than one
      // cause: a 1.5 is not refused for freezing anything. Why 0 in particular
      // is refused (it converts to a frozen follow) lives in the comment above
      // and in the test names, not in text shown for a 5. "Unless
      // followSmoothing is set" because an explicit engine spelling in the same
      // config is still sent, and then it, not the default, applies.
      reason:
        'must be above 0 and at most 1 — the share of the gap closed each frame; the engine default is kept unless followSmoothing is set',
    },
  },
};

/**
 * The config keys that reached the engine as nothing, sorted by WHY.
 *
 * These were one list under one sentence — "camera settings the engine has no
 * parameter for were ignored" — which is true only of {@link unknown}. It was
 * already false for a real field carrying a bad value (`topDownHeight: '25'`
 * names a parameter the engine very much has), and it would be false again for
 * an out-of-range value, which is a number the engine understands and refuses.
 * An author told the wrong reason looks for the wrong fix.
 */
export interface CameraConfigReport {
  /** Keys the engine has no parameter for under any spelling. */
  unknown: string[];
  /** Keys naming a real parameter, carrying a value it cannot take. */
  unusable: { key: string; reason: string }[];
  /** Aliases that lost to an explicit spelling of the same field. */
  overridden: { key: string; field: NumericCameraField }[];
}

/**
 * Explain every config key that did not reach the engine.
 *
 * Shares {@link cameraValueRejection} with {@link filterCameraNumerics}, so the
 * two cannot disagree about what "sendable" means — a value dropped there is
 * always named here.
 */
export function classifyCameraConfigKeys(raw: unknown): CameraConfigReport {
  const report: CameraConfigReport = { unknown: [], unusable: [], overridden: [] };
  if (!raw || typeof raw !== 'object') return report;
  const obj = raw as Record<string, unknown>;

  // The author's own key order, so the report reads back in the order they wrote.
  for (const key of Object.keys(obj)) {
    const alias = Object.hasOwn(GDD_CONFIG_KEY_ALIASES, key)
      ? GDD_CONFIG_KEY_ALIASES[key]
      : undefined;
    const field = alias ? alias.field : asCameraField(key);
    if (field === undefined) {
      report.unknown.push(key);
      continue;
    }
    // Convert BEFORE judging sendability, matching `filterCameraNumerics`: a
    // rejection on the raw GDD unit (e.g. refusing `smoothing: -3` for being
    // "too small" against `followSmoothing`'s policy) would use the wrong
    // scale, and the two helpers sharing `cameraValueRejection` is what keeps
    // them from disagreeing about what "sendable" means.
    const value = alias ? convertAliasedValue(obj[key], alias.convert) : obj[key];
    // The alias's GDD-unit domain is judged on the RAW value and takes
    // precedence: a `smoothing: 5` is wrong where it was written, and reporting
    // the converted 300 as fine (which the engine would accept) tells the
    // author nothing was wrong.
    const reason =
      (alias ? aliasDomainRejection(alias, obj[key]) : null) ?? cameraValueRejection(field, value);
    if (reason !== null) {
      report.unusable.push({ key, reason });
      continue;
    }
    // An alias loses to an explicit spelling of the same field, so it was
    // accepted-then-overridden — still "this key did nothing". It only loses to
    // a SENDABLE value, matching `filterCameraNumerics`: an explicit
    // `topDownHeight: NaN` is dropped, and then the alias is what applies.
    if (
      alias &&
      Object.hasOwn(obj, field) &&
      cameraValueRejection(field, obj[field]) === null
    ) {
      report.overridden.push({ key, field });
    }
  }
  return report;
}
