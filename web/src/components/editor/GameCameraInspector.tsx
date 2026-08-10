'use client';

import { memo, useCallback } from 'react';
import { Camera, Zap } from 'lucide-react';
import { useEditorStore, type GameCameraData, type GameCameraMode } from '@/stores/editorStore';
import { InfoTooltip } from '@/components/ui/InfoTooltip';

/**
 * Per-mode starting values. Every one of these MUST match the engine default in
 * `GameCameraMode::from_flat` (engine/src/core/game_camera.rs) — a mismatch here
 * is invisible, because `dispatchCommand` returns `void` and the engine happily
 * accepts an in-range-but-wrong number.
 *
 * `firstPersonMouseSensitivity` is DEGREES of yaw per pixel of mouse delta
 * (`fp_state.yaw -= delta.dx * sensitivity`), so the engine's 0.1 turns a
 * 900-pixel sweep through 90°. This panel shipped `2`, which turned the same
 * sweep through 1800° — five full rotations, i.e. unusable.
 */
const MODE_DEFAULTS: Record<GameCameraMode, Partial<GameCameraData>> = {
  thirdPersonFollow: { followDistance: 5, followHeight: 2, followSmoothing: 5 },
  firstPerson: { firstPersonHeight: 1.7, firstPersonMouseSensitivity: 0.1 },
  sideScroller: { sideScrollerDistance: 10 },
  topDown: { topDownHeight: 15 },
  fixed: {},
  orbital: { orbitalDistance: 5, orbitalAutoRotateSpeed: 0 },
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
            <label className="text-xs text-zinc-400">Active</label>
            <InfoTooltip term="gameCameraActive" />
          </div>
          <input
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
            <label className="text-xs text-zinc-400">Mode</label>
            <InfoTooltip term="gameCameraMode" />
          </div>
          <select
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
            <label className="text-xs text-zinc-400">Target ID</label>
            <InfoTooltip term="gameCameraTarget" />
          </div>
          <input
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
            <div className="flex items-center gap-2">
              <div className="flex w-20 shrink-0 items-center gap-1">
                <label className="text-xs text-zinc-400">Distance</label>
                <InfoTooltip term="gameCameraFollowDist" />
              </div>
              <input
                type="number"
                step="0.1"
                value={primaryGameCamera.followDistance ?? 5}
                onChange={(e) =>
                  handleParamChange({
                    followDistance: parseNumberInput(e.target.value, primaryGameCamera.followDistance ?? 5),
                  })
                }
                className="flex-1 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none
                  focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div className="flex items-center gap-2">
              <div className="flex w-20 shrink-0 items-center gap-1">
                <label className="text-xs text-zinc-400">Height</label>
                <InfoTooltip term="gameCameraFollowHeight" />
              </div>
              <input
                type="number"
                step="0.1"
                value={primaryGameCamera.followHeight ?? 2}
                onChange={(e) =>
                  handleParamChange({
                    followHeight: parseNumberInput(e.target.value, primaryGameCamera.followHeight ?? 2),
                  })
                }
                className="flex-1 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none
                  focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div className="flex items-center gap-2">
              <div className="flex w-20 shrink-0 items-center gap-1">
                <label className="text-xs text-zinc-400">Smoothing</label>
                <InfoTooltip term="gameCameraSmoothing" />
              </div>
              <input
                type="number"
                step="0.1"
                value={primaryGameCamera.followSmoothing ?? 5}
                onChange={(e) =>
                  handleParamChange({
                    followSmoothing: parseNumberInput(e.target.value, primaryGameCamera.followSmoothing ?? 5),
                  })
                }
                className="flex-1 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none
                  focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </>
        )}

        {primaryGameCamera.mode === 'firstPerson' && (
          <>
            <div className="flex items-center gap-2">
              <div className="flex w-20 shrink-0 items-center gap-1">
                <label className="text-xs text-zinc-400">Height</label>
                <InfoTooltip term="gameCameraFPHeight" />
              </div>
              <input
                type="number"
                step="0.1"
                value={primaryGameCamera.firstPersonHeight ?? 1.7}
                onChange={(e) =>
                  handleParamChange({
                    firstPersonHeight: parseNumberInput(e.target.value, primaryGameCamera.firstPersonHeight ?? 1.7),
                  })
                }
                className="flex-1 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none
                  focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div className="flex items-center gap-2">
              <div className="flex w-20 shrink-0 items-center gap-1">
                <label className="text-xs text-zinc-400">Mouse Sens.</label>
                <InfoTooltip term="gameCameraMouseSens" />
              </div>
              <input
                type="number"
                step="0.01"
                value={primaryGameCamera.firstPersonMouseSensitivity ?? 0.1}
                onChange={(e) =>
                  handleParamChange({
                    firstPersonMouseSensitivity: parseNumberInput(
                      e.target.value,
                      primaryGameCamera.firstPersonMouseSensitivity ?? 0.1
                    ),
                  })
                }
                className="flex-1 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none
                  focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </>
        )}

        {primaryGameCamera.mode === 'sideScroller' && (
          <>
            <div className="flex items-center gap-2">
              <div className="flex w-20 shrink-0 items-center gap-1">
                <label className="text-xs text-zinc-400">Distance</label>
                <InfoTooltip term="gameCameraSideScrollDist" />
              </div>
              <input
                type="number"
                step="0.1"
                value={primaryGameCamera.sideScrollerDistance ?? 10}
                onChange={(e) =>
                  handleParamChange({
                    sideScrollerDistance: parseNumberInput(e.target.value, primaryGameCamera.sideScrollerDistance ?? 10),
                  })
                }
                className="flex-1 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none
                  focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </>
        )}

        {primaryGameCamera.mode === 'topDown' && (
          <>
            <div className="flex items-center gap-2">
              <div className="flex w-20 shrink-0 items-center gap-1">
                <label className="text-xs text-zinc-400">Height</label>
                <InfoTooltip term="gameCameraTopDownHeight" />
              </div>
              <input
                type="number"
                step="0.1"
                value={primaryGameCamera.topDownHeight ?? 15}
                onChange={(e) =>
                  handleParamChange({
                    topDownHeight: parseNumberInput(e.target.value, primaryGameCamera.topDownHeight ?? 15),
                  })
                }
                className="flex-1 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none
                  focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </>
        )}

        {primaryGameCamera.mode === 'orbital' && (
          <>
            <div className="flex items-center gap-2">
              <div className="flex w-20 shrink-0 items-center gap-1">
                <label className="text-xs text-zinc-400">Distance</label>
                <InfoTooltip term="gameCameraOrbitalDist" />
              </div>
              <input
                type="number"
                step="0.1"
                value={primaryGameCamera.orbitalDistance ?? 5}
                onChange={(e) =>
                  handleParamChange({
                    orbitalDistance: parseNumberInput(e.target.value, primaryGameCamera.orbitalDistance ?? 5),
                  })
                }
                className="flex-1 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none
                  focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div className="flex items-center gap-2">
              <div className="flex w-20 shrink-0 items-center gap-1">
                <label className="text-xs text-zinc-400">Auto Rotate</label>
                <InfoTooltip term="gameCameraAutoRotate" />
              </div>
              <input
                type="number"
                step="0.1"
                value={primaryGameCamera.orbitalAutoRotateSpeed ?? 0}
                onChange={(e) =>
                  handleParamChange({
                    orbitalAutoRotateSpeed: parseNumberInput(
                      e.target.value,
                      primaryGameCamera.orbitalAutoRotateSpeed ?? 0
                    ),
                  })
                }
                className="flex-1 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none
                  focus:ring-1 focus:ring-blue-500"
              />
            </div>
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
