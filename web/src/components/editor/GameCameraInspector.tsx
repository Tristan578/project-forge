'use client';

import { memo, useCallback, useId } from 'react';
import { Camera, Zap } from 'lucide-react';
import { useEditorStore, type GameCameraData, type GameCameraMode } from '@/stores/editorStore';
import { InfoTooltip } from '@/components/ui/InfoTooltip';
// The field-shape types are imported, not re-derived. This file used to spell
// its own `Exclude<keyof GameCameraData, 'mode' | 'targetEntity'>`, and the day
// `GameCameraData` grew a non-numeric field the local copy swept it into the
// numeric row type while the shared one did not — a divergence that only
// surfaced as an index error against `ENGINE_CAMERA_DEFAULTS`. All three unions
// now come from the one shape table in `gameCameraPayload`, so a field can only
// ever be rendered by the row component matching the shape the translator uses.
import {
  ENGINE_CAMERA_DEFAULTS,
  ENGINE_CAMERA_BOOL_DEFAULTS,
  type NumericCameraField,
  type BooleanCameraField,
  type PairCameraField,
} from '@/lib/game/gameCameraPayload';

/**
 * Which parameters each mode starts with. Every VALUE is read from
 * `ENGINE_CAMERA_DEFAULTS` rather than re-typed, because a number that merely
 * looks right here is invisible when wrong: `dispatchCommand` returns `void`,
 * and the engine accepts an in-range-but-wrong value without complaint. These
 * are explicit non-undefined entries, so they are dispatched, and they then
 * become what the inputs display — a drifted literal is both the value in
 * effect and the value shown, which is why nothing surfaces it.
 *
 * It shipped drifted twice over. Orbital read distance 5 / auto-rotate 0
 * against the engine's 8 / 15, and `firstPersonMouseSensitivity` read 2 against
 * the engine's 0.1 — that field is DEGREES of yaw per pixel of mouse delta
 * (`fp_state.yaw -= delta.dx * sensitivity`), so 0.1 turns a 900-pixel sweep
 * through 90° and 2 turns it through 1800°: five full rotations, unusable.
 */
const MODE_DEFAULTS: Record<GameCameraMode, Partial<GameCameraData>> = {
  thirdPersonFollow: {
    followDistance: ENGINE_CAMERA_DEFAULTS.followDistance,
    followHeight: ENGINE_CAMERA_DEFAULTS.followHeight,
    followSmoothing: ENGINE_CAMERA_DEFAULTS.followSmoothing,
  },
  firstPerson: {
    firstPersonHeight: ENGINE_CAMERA_DEFAULTS.firstPersonHeight,
    firstPersonMouseSensitivity: ENGINE_CAMERA_DEFAULTS.firstPersonMouseSensitivity,
  },
  sideScroller: {
    sideScrollerDistance: ENGINE_CAMERA_DEFAULTS.sideScrollerDistance,
    sideScrollerSmoothing: ENGINE_CAMERA_DEFAULTS.sideScrollerSmoothing,
    sideScrollerFollowY: ENGINE_CAMERA_BOOL_DEFAULTS.sideScrollerFollowY,
    // No `sideScrollerYBounds`. Its absence is the engine's own state — a
    // camera with no Y clamp — and there is no pair that expresses "unbounded",
    // so seeding one here would silently impose a clamp nobody asked for.
  },
  topDown: {
    topDownHeight: ENGINE_CAMERA_DEFAULTS.topDownHeight,
    topDownSmoothing: ENGINE_CAMERA_DEFAULTS.topDownSmoothing,
    topDownFollowRotation: ENGINE_CAMERA_BOOL_DEFAULTS.topDownFollowRotation,
  },
  fixed: {},
  orbital: {
    orbitalDistance: ENGINE_CAMERA_DEFAULTS.orbitalDistance,
    orbitalAutoRotateSpeed: ENGINE_CAMERA_DEFAULTS.orbitalAutoRotateSpeed,
  },
};

/**
 * Parse a number input, keeping the previous value when the field is not a
 * finite number.
 *
 * `parseFloat(v) || 0` — the shape this panel used everywhere — collapses both
 * an empty field and a typo to `0`, silently dispatching a real 0 to the engine
 * (a 0 follow distance puts the camera inside the player).
 */
function parseNumberInput(raw: string, fallback: number): number {
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * The window a range parameter opens with when it is switched on.
 *
 * Deliberately NOT read from `ENGINE_CAMERA_DEFAULTS`: the engine has no
 * default for a range, because absence is how it says "unbounded". This is a
 * starting window for the user to adjust, chosen non-degenerate — `[0, 0]`
 * would be a valid clamp meaning "pin the camera's height", which is a real
 * instruction and a startling thing to apply the instant a box is ticked.
 */
const DEFAULT_RANGE: [number, number] = [0, 10];


/**
 * One labelled numeric parameter row.
 *
 * Extracted because eight rows differed only by label, field and step, and the
 * duplication was hiding two things: none of the eleven controls in this panel
 * was associated with its label (no `htmlFor`, no `id`, no `aria-label`), and
 * each row re-typed its own `?? default` twice. Both are structural here — a
 * new parameter cannot be added without an association or with a stray default.
 *
 * The labels are not unique across modes ("Distance", "Height" each appear in
 * three), so `useId` per row rather than a slug: only one mode renders at a
 * time today, but a duplicate `id` would silently point two labels at one input.
 */
function NumberParamRow({
  label,
  term,
  field,
  step = '0.1',
  camera,
  onChange,
}: {
  label: string;
  term: string;
  field: NumericCameraField;
  step?: string;
  camera: GameCameraData;
  onChange: (patch: Partial<GameCameraData>) => void;
}) {
  const id = useId();
  // An unset field means the engine is applying its own default, so that is
  // what the input must show — see ENGINE_CAMERA_DEFAULTS.
  const current = camera[field] ?? ENGINE_CAMERA_DEFAULTS[field];

  return (
    <div className="flex items-center gap-2">
      <div className="flex w-20 shrink-0 items-center gap-1">
        <label htmlFor={id} className="text-xs text-zinc-400">{label}</label>
        <InfoTooltip term={term} />
      </div>
      <input
        id={id}
        type="number"
        step={step}
        value={current}
        onChange={(e) =>
          // A computed key widens to `{ [x: string]: number }`, which is why
          // this needs the assertion; `field` is constrained above.
          onChange({ [field]: parseNumberInput(e.target.value, current) } as Partial<GameCameraData>)
        }
        className="flex-1 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none
          focus:ring-1 focus:ring-blue-500"
      />
    </div>
  );
}

/**
 * One labelled boolean parameter row.
 *
 * Reads its unset value from `ENGINE_CAMERA_BOOL_DEFAULTS` for the same reason
 * `NumberParamRow` reads `ENGINE_CAMERA_DEFAULTS`: an unset field means the
 * engine is applying its own default, so showing anything else would display a
 * state the engine is not in. The two default tables are separate so the
 * numeric one can keep its `Record<NumericCameraField, number>` constraint.
 */
function BooleanParamRow({
  label,
  term,
  field,
  camera,
  onChange,
}: {
  label: string;
  term: string;
  field: BooleanCameraField;
  camera: GameCameraData;
  onChange: (patch: Partial<GameCameraData>) => void;
}) {
  const id = useId();
  const current = camera[field] ?? ENGINE_CAMERA_BOOL_DEFAULTS[field];

  return (
    <div className="flex items-center gap-2">
      <div className="flex w-20 shrink-0 items-center gap-1">
        <label htmlFor={id} className="text-xs text-zinc-400">{label}</label>
        <InfoTooltip term={term} />
      </div>
      <input
        id={id}
        type="checkbox"
        checked={current}
        onChange={(e) => onChange({ [field]: e.target.checked } as Partial<GameCameraData>)}
        className="h-3.5 w-3.5 rounded border-zinc-600 bg-zinc-800 text-blue-500
          focus:ring-1 focus:ring-blue-500 focus:ring-offset-0"
      />
    </div>
  );
}

/**
 * A `[min, max]` clamp whose ABSENCE is a meaningful third state.
 *
 * The engine holds `y_bounds` as an `Option` with no default, so there is no
 * pair that means "unbounded" — the only way to say it is to send no key at
 * all. That is why this row carries an explicit enable checkbox rather than
 * two inputs with a placeholder: clearing both numbers would otherwise be
 * indistinguishable from clamping to `[0, 0]`, which is a real (and very
 * different) instruction to pin the camera's height.
 *
 * The two numbers are NOT sorted here. Ordering happens once, in the payload
 * builder, so a transient inversion while typing a range backwards (max first)
 * cannot be committed to the wire — the engine REJECTS an inverted pair, and a
 * rejected command is silent, so it would drop the whole camera update.
 */
function RangeParamRow({
  label,
  term,
  field,
  camera,
  onChange,
}: {
  label: string;
  term: string;
  field: PairCameraField;
  camera: GameCameraData;
  onChange: (patch: Partial<GameCameraData>) => void;
}) {
  const id = useId();
  const current = camera[field];
  const [min, max] = current ?? DEFAULT_RANGE;

  const setRange = (next: [number, number] | undefined) =>
    onChange({ [field]: next } as Partial<GameCameraData>);

  return (
    <div className="flex items-center gap-2" role="group" aria-label={label}>
      <div className="flex w-20 shrink-0 items-center gap-1">
        <label htmlFor={`${id}-on`} className="text-xs text-zinc-400">{label}</label>
        <InfoTooltip term={term} />
      </div>
      <input
        id={`${id}-on`}
        type="checkbox"
        // Named distinctly from the enclosing group, which is also called
        // `label`. Without this the checkbox and its own group resolve to the
        // same accessible name, so "Y Bounds" is ambiguous to anyone — or any
        // test — asking for the control by name. The visible text is still a
        // prefix of this name, so WCAG 2.5.3 Label in Name holds.
        aria-label={`${label} enabled`}
        checked={current !== undefined}
        onChange={(e) => setRange(e.target.checked ? DEFAULT_RANGE : undefined)}
        className="h-3.5 w-3.5 shrink-0 rounded border-zinc-600 bg-zinc-800 text-blue-500
          focus:ring-1 focus:ring-blue-500 focus:ring-offset-0"
      />
      <label htmlFor={`${id}-min`} className="sr-only">{`${label} minimum`}</label>
      <input
        id={`${id}-min`}
        type="number"
        step="0.1"
        value={min}
        disabled={current === undefined}
        onChange={(e) => setRange([parseNumberInput(e.target.value, min), max])}
        className="w-full min-w-0 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none
          focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
      />
      <label htmlFor={`${id}-max`} className="sr-only">{`${label} maximum`}</label>
      <input
        id={`${id}-max`}
        type="number"
        step="0.1"
        value={max}
        disabled={current === undefined}
        onChange={(e) => setRange([min, parseNumberInput(e.target.value, max)])}
        className="w-full min-w-0 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none
          focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
      />
    </div>
  );
}

const MODE_LABELS: Record<GameCameraMode, string> = {
  thirdPersonFollow: '3rd Person Follow',
  firstPerson: 'First Person',
  sideScroller: 'Side Scroller',
  topDown: 'Top Down',
  fixed: 'Fixed',
  orbital: 'Orbital',
};

export const GameCameraInspector = memo(function GameCameraInspector() {
  const primaryId = useEditorStore((s) => s.primaryId);
  // Derived from the per-entity record rather than a parallel `primaryGameCamera`
  // field. That field could only ever be written by the inbound engine event, and
  // `set_game_camera` never reached the engine (PF-1126), so it was permanently
  // null and this inspector rendered its empty state no matter what was configured.
  // Reading the record instead reflects both local edits and engine echoes.
  const primaryGameCamera = useEditorStore((s) => (s.primaryId ? s.allGameCameras[s.primaryId] ?? null : null));
  const activeGameCameraId = useEditorStore((s) => s.activeGameCameraId);
  const setGameCamera = useEditorStore((s) => s.setGameCamera);
  const setActiveGameCamera = useEditorStore((s) => s.setActiveGameCamera);
  const removeGameCamera = useEditorStore((s) => s.removeGameCamera);
  const cameraShake = useEditorStore((s) => s.cameraShake);
  // One base per instance, suffixed per control. The numeric rows mint their own
  // (see `NumberParamRow`); these three are one-offs and share this prefix.
  const baseId = useId();

  const handleModeChange = useCallback(
    (mode: GameCameraMode) => {
      if (!primaryId) return;
      const defaults = MODE_DEFAULTS[mode];
      const newData: GameCameraData = {
        mode,
        // Keep whatever the camera already follows. Switching mode is a framing
        // change, not a retargeting one, and nulling this silently detached the
        // camera from the player every time the user tried another mode.
        targetEntity: primaryGameCamera?.targetEntity ?? null,
        ...defaults,
      };
      setGameCamera(primaryId, newData);
    },
    [primaryId, primaryGameCamera, setGameCamera]
  );

  const handleParamChange = useCallback(
    (updates: Partial<GameCameraData>) => {
      if (!primaryId || !primaryGameCamera) return;
      setGameCamera(primaryId, { ...primaryGameCamera, ...updates });
    },
    [primaryId, primaryGameCamera, setGameCamera]
  );

  const handleRemove = useCallback(() => {
    if (!primaryId) return;
    removeGameCamera(primaryId);
  }, [primaryId, removeGameCamera]);

  const handleShakeTest = useCallback(() => {
    if (!primaryId) return;
    cameraShake(primaryId, 0.3, 0.5);
  }, [primaryId, cameraShake]);

  const handleToggleActive = useCallback(
    (checked: boolean) => {
      setActiveGameCamera(checked ? primaryId : null);
    },
    [primaryId, setActiveGameCamera]
  );

  if (!primaryId) return null;

  const isActive = activeGameCameraId === primaryId;

  // No camera configured yet
  if (!primaryGameCamera) {
    return (
      <div className="border-t border-zinc-800 px-3 py-2">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <Camera className="w-3.5 h-3.5 text-blue-400" />
            <span className="text-xs font-medium text-white">Game Camera</span>
          </div>
          <InfoTooltip text="Configure in-game camera behavior for play mode" />
        </div>
        <button
          onClick={() => handleModeChange('thirdPersonFollow')}
          className="w-full rounded bg-zinc-800 px-2 py-1.5 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-300"
        >
          Add Game Camera
        </button>
      </div>
    );
  }

  return (
    <div className="border-t border-zinc-800 px-3 py-2">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Camera className="w-3.5 h-3.5 text-blue-400" />
          <span className="text-xs font-medium text-white">Game Camera</span>
        </div>
        <div className="flex items-center gap-2">
          <InfoTooltip text="Configure in-game camera behavior for play mode" />
          <button
            onClick={handleRemove}
            className="text-[10px] text-red-400 hover:text-red-300"
          >
            Remove
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {/* Active toggle */}
        <div className="flex items-center gap-2">
          <div className="flex w-20 shrink-0 items-center gap-1">
            <label htmlFor={`${baseId}-active`} className="text-xs text-zinc-400">Active</label>
            <InfoTooltip term="gameCameraActive" />
          </div>
          <input
            id={`${baseId}-active`}
            type="checkbox"
            checked={isActive}
            onChange={(e) => handleToggleActive(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-zinc-600 bg-zinc-800 text-blue-500
              focus:ring-1 focus:ring-blue-500 focus:ring-offset-0"
          />
        </div>

        {/* Mode selector */}
        <div className="flex items-center gap-2">
          <div className="flex w-20 shrink-0 items-center gap-1">
            <label htmlFor={`${baseId}-mode`} className="text-xs text-zinc-400">Mode</label>
            <InfoTooltip term="gameCameraMode" />
          </div>
          <select
            id={`${baseId}-mode`}
            value={primaryGameCamera.mode}
            onChange={(e) => handleModeChange(e.target.value as GameCameraMode)}
            className="flex-1 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none
              focus:ring-1 focus:ring-blue-500"
          >
            {Object.entries(MODE_LABELS).map(([mode, label]) => (
              <option key={mode} value={mode}>
                {label}
              </option>
            ))}
          </select>
        </div>

        {/* Target entity */}
        <div className="flex items-center gap-2">
          <div className="flex w-20 shrink-0 items-center gap-1">
            <label htmlFor={`${baseId}-target`} className="text-xs text-zinc-400">Target ID</label>
            <InfoTooltip term="gameCameraTarget" />
          </div>
          <input
            id={`${baseId}-target`}
            type="text"
            value={primaryGameCamera.targetEntity ?? ''}
            onChange={(e) => handleParamChange({ targetEntity: e.target.value || null })}
            placeholder="(follow selected)"
            className="flex-1 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none
              focus:ring-1 focus:ring-blue-500 placeholder:text-zinc-400"
          />
        </div>

        {/* Mode-specific params */}
        {primaryGameCamera.mode === 'thirdPersonFollow' && (
          <>
            <NumberParamRow label="Distance" term="gameCameraFollowDist" field="followDistance" camera={primaryGameCamera} onChange={handleParamChange} />
            <NumberParamRow label="Height" term="gameCameraFollowHeight" field="followHeight" camera={primaryGameCamera} onChange={handleParamChange} />
            <NumberParamRow label="Smoothing" term="gameCameraSmoothing" field="followSmoothing" camera={primaryGameCamera} onChange={handleParamChange} />
          </>
        )}

        {primaryGameCamera.mode === 'firstPerson' && (
          <>
            <NumberParamRow label="Height" term="gameCameraFPHeight" field="firstPersonHeight" camera={primaryGameCamera} onChange={handleParamChange} />
            <NumberParamRow label="Mouse Sens." term="gameCameraMouseSens" field="firstPersonMouseSensitivity" step="0.01" camera={primaryGameCamera} onChange={handleParamChange} />
          </>
        )}

        {primaryGameCamera.mode === 'sideScroller' && (
          <>
            <NumberParamRow label="Distance" term="gameCameraSideScrollDist" field="sideScrollerDistance" camera={primaryGameCamera} onChange={handleParamChange} />
            <NumberParamRow label="Smoothing" term="gameCameraSideScrollSmoothing" field="sideScrollerSmoothing" camera={primaryGameCamera} onChange={handleParamChange} />
            <BooleanParamRow label="Follow Y" term="gameCameraSideScrollFollowY" field="sideScrollerFollowY" camera={primaryGameCamera} onChange={handleParamChange} />
            <RangeParamRow label="Y Bounds" term="gameCameraSideScrollYBounds" field="sideScrollerYBounds" camera={primaryGameCamera} onChange={handleParamChange} />
          </>
        )}

        {primaryGameCamera.mode === 'topDown' && (
          <>
            <NumberParamRow label="Height" term="gameCameraTopDownHeight" field="topDownHeight" camera={primaryGameCamera} onChange={handleParamChange} />
            <NumberParamRow label="Smoothing" term="gameCameraTopDownSmoothing" field="topDownSmoothing" camera={primaryGameCamera} onChange={handleParamChange} />
            <BooleanParamRow label="Follow Turn" term="gameCameraTopDownFollowRotation" field="topDownFollowRotation" camera={primaryGameCamera} onChange={handleParamChange} />
          </>
        )}

        {primaryGameCamera.mode === 'orbital' && (
          <>
            <NumberParamRow label="Distance" term="gameCameraOrbitalDist" field="orbitalDistance" camera={primaryGameCamera} onChange={handleParamChange} />
            <NumberParamRow label="Auto Rotate" term="gameCameraAutoRotate" field="orbitalAutoRotateSpeed" camera={primaryGameCamera} onChange={handleParamChange} />
          </>
        )}

        {primaryGameCamera.mode === 'fixed' && (
          <p className="text-xs text-zinc-400 italic">
            Camera position is set via entity transform
          </p>
        )}

        {/* Test shake button */}
        <button
          onClick={handleShakeTest}
          className="flex w-full items-center justify-center gap-1.5 rounded bg-zinc-800 px-2 py-1.5 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-300"
        >
          <Zap className="w-3 h-3" />
          Test Shake
        </button>
      </div>
    </div>
  );
});
