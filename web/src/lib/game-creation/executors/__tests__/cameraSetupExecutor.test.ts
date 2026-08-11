import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cameraSetupExecutor } from '../cameraSetupExecutor';
import type { ExecutorContext } from '../../types';
import type { EditorState } from '@/stores/editorStore';

/**
 * The whole point of this executor is that a GDD camera directive REACHES the
 * engine, so every assertion below is on the FULL dispatched payload via
 * `toEqual`, never `expect.objectContaining`. `objectContaining` asserts what is
 * present and is blind to whatever sits alongside it — which is exactly why the
 * PF-1097/1109/1111/1115/1118/1126 defect class kept surviving green suites.
 */

function makeCtx(
  nodes: Record<string, { entityId: string; name: string }>,
  overrides: Partial<ExecutorContext> = {},
): { ctx: ExecutorContext; dispatch: ReturnType<typeof vi.fn> } {
  const dispatch = vi.fn();
  const ctx: ExecutorContext = {
    dispatchCommand: dispatch,
    getStore: () => ({ sceneGraph: { nodes } }) as unknown as EditorState,
    projectType: '3d',
    userTier: 'pro',
    signal: new AbortController().signal,
    resolveStepOutput: () => undefined,
    ...overrides,
  };
  return { ctx, dispatch };
}

const CAMERA_NODE = { 'e-9': { entityId: 'e-9', name: 'Main Camera' } };

describe('cameraSetupExecutor', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is registered under the camera_setup executor name', () => {
    expect(cameraSetupExecutor.name).toBe('camera_setup');
  });

  // ---------------------------------------------------------------------------
  // The PF-1125 regression: the directive has to change what the engine receives
  // ---------------------------------------------------------------------------

  it('dispatches a sideScroller camera for a side-scroller GDD directive', async () => {
    const { ctx, dispatch } = makeCtx(CAMERA_NODE);

    const result = await cameraSetupExecutor.execute(
      { cameraMode: 'side-scroller', cameraConfig: { sideScrollerDistance: 14 } },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(dispatch).toHaveBeenCalledWith('set_game_camera', {
      entityId: 'e-9',
      mode: 'sideScroller',
      targetEntity: null,
      zOffset: 14,
    });
    expect(dispatch).toHaveBeenCalledWith('set_active_game_camera', { entityId: 'e-9' });
  });

  it('dispatches a firstPerson camera for a first-person GDD directive', async () => {
    const { ctx, dispatch } = makeCtx(CAMERA_NODE);

    await cameraSetupExecutor.execute(
      {
        cameraMode: 'first_person',
        cameraConfig: { firstPersonHeight: 1.8, firstPersonMouseSensitivity: 0.25 },
      },
      ctx,
    );

    // A DIFFERENT directive must produce a DIFFERENT payload. Before PF-1125 both
    // of these produced no dispatch at all, so a test that only checked one mode
    // could not tell the difference between "translated" and "dropped".
    expect(dispatch).toHaveBeenCalledWith('set_game_camera', {
      entityId: 'e-9',
      mode: 'firstPerson',
      targetEntity: null,
      eyeHeight: 1.8,
      mouseSensitivity: 0.25,
    });
  });

  it('translates the authoring vocabulary rather than passing GDD keys through', async () => {
    const { ctx, dispatch } = makeCtx(CAMERA_NODE);

    await cameraSetupExecutor.execute(
      { cameraMode: 'third-person', cameraConfig: { followDistance: 7, followHeight: 3 } },
      ctx,
    );

    // `offset`, not `followDistance`/`followHeight`. The store's names share no
    // key with the engine's wire form, and the engine drops every key it does not
    // recognize without an error.
    expect(dispatch).toHaveBeenCalledWith('set_game_camera', {
      entityId: 'e-9',
      mode: 'thirdPersonFollow',
      targetEntity: null,
      offset: [0, 3, -7],
    });
  });

  // ---------------------------------------------------------------------------
  // Entity resolution
  // ---------------------------------------------------------------------------

  it('resolves the camera entity live, not from a pipeline-start snapshot', async () => {
    const dispatch = vi.fn();
    let nodes: Record<string, { entityId: string; name: string }> = {};
    const ctx: ExecutorContext = {
      dispatchCommand: dispatch,
      // The orchestrator builds the context once and every step reuses it, so a
      // camera spawned by an earlier step is only visible through a live read.
      getStore: () => ({ sceneGraph: { nodes } }) as unknown as EditorState,
      projectType: '3d',
      userTier: 'pro',
      signal: new AbortController().signal,
      resolveStepOutput: () => undefined,
    };
    nodes = { 'spawned-later': { entityId: 'spawned-later', name: 'PlayerCamera' } };

    await cameraSetupExecutor.execute({ cameraMode: 'top-down' }, ctx);

    expect(dispatch).toHaveBeenCalledWith('set_game_camera', {
      entityId: 'spawned-later',
      mode: 'topDown',
      targetEntity: null,
    });
  });

  it('succeeds with a warning and dispatches nothing when the scene has no camera', async () => {
    const { ctx, dispatch } = makeCtx({
      'e-1': { entityId: 'e-1', name: 'Ground' },
    });

    const result = await cameraSetupExecutor.execute({ cameraMode: 'top-down' }, ctx);

    // A missing camera is not a pipeline failure — the game is still playable on
    // the engine's default camera — but it must be REPORTED, not swallowed.
    expect(result.success).toBe(true);
    expect(result.output?.applied).toBe(false);
    expect(result.output?.warning).toContain('camera');
    expect(dispatch).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Untrusted-input handling: `cameraConfig` is model-authored
  // ---------------------------------------------------------------------------

  it('falls back to thirdPersonFollow for a mode the engine does not know', async () => {
    const { ctx, dispatch } = makeCtx(CAMERA_NODE);

    await cameraSetupExecutor.execute({ cameraMode: 'cinematic-dolly' }, ctx);

    // Not passed through: `from_flat` rejects an unknown mode outright, and a
    // rejected `set_game_camera` is a silent no-op.
    expect(dispatch).toHaveBeenCalledWith('set_game_camera', {
      entityId: 'e-9',
      mode: 'thirdPersonFollow',
      targetEntity: null,
    });
  });

  it('drops non-finite and non-numeric config values', async () => {
    const { ctx, dispatch } = makeCtx(CAMERA_NODE);

    await cameraSetupExecutor.execute(
      {
        cameraMode: 'top-down',
        cameraConfig: { topDownHeight: Number.NaN, followDistance: '5', arbitraryKey: 3 },
      },
      ctx,
    );

    // `NaN` JSON-serializes to `null`, which `from_flat` reads as "absent, take
    // the default" — so forwarding it would silently reset the parameter.
    expect(dispatch).toHaveBeenCalledWith('set_game_camera', {
      entityId: 'e-9',
      mode: 'topDown',
      targetEntity: null,
    });
  });

  it('keeps a legitimate zero rather than treating it as absent', async () => {
    const { ctx, dispatch } = makeCtx(CAMERA_NODE);

    await cameraSetupExecutor.execute(
      { cameraMode: 'orbital', cameraConfig: { orbitalAutoRotateSpeed: 0 } },
      ctx,
    );

    expect(dispatch).toHaveBeenCalledWith('set_game_camera', {
      entityId: 'e-9',
      mode: 'orbital',
      targetEntity: null,
      autoRotateSpeed: 0,
      autoRotate: false,
    });
  });

  it('does not read camera parameters off Object.prototype', async () => {
    const { ctx, dispatch } = makeCtx(CAMERA_NODE);

    const result = await cameraSetupExecutor.execute(
      { cameraMode: 'top-down', cameraConfig: JSON.parse('{"__proto__":{"topDownHeight":99}}') },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(dispatch).toHaveBeenCalledWith('set_game_camera', {
      entityId: 'e-9',
      mode: 'topDown',
      targetEntity: null,
    });
  });

  // ---------------------------------------------------------------------------
  // Contract plumbing
  // ---------------------------------------------------------------------------

  it('fails on a malformed cameraConfig', async () => {
    const { ctx, dispatch } = makeCtx(CAMERA_NODE);

    const result = await cameraSetupExecutor.execute({ cameraConfig: 'not-an-object' }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('aborts without dispatching when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const { ctx, dispatch } = makeCtx(CAMERA_NODE, { signal: controller.signal });

    const result = await cameraSetupExecutor.execute({ cameraMode: 'top-down' }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('ABORTED');
    expect(dispatch).not.toHaveBeenCalled();
  });
});
