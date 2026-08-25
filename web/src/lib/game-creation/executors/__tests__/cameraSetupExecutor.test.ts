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
    resolveStepOutputs: () => [],
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
      {
        cameraMode: 'side-scroller',
        cameraConfig: { sideScrollerDistance: 14 },
        targetEntityId: 'player-1',
      },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(dispatch).toHaveBeenCalledWith('set_game_camera', {
      entityId: 'e-9',
      mode: 'sideScroller',
      targetEntity: 'player-1',
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
        targetEntityId: 'player-1',
      },
      ctx,
    );

    // A DIFFERENT directive must produce a DIFFERENT payload. Before PF-1125 both
    // of these produced no dispatch at all, so a test that only checked one mode
    // could not tell the difference between "translated" and "dropped".
    expect(dispatch).toHaveBeenCalledWith('set_game_camera', {
      entityId: 'e-9',
      mode: 'firstPerson',
      targetEntity: 'player-1',
      eyeHeight: 1.8,
      mouseSensitivity: 0.25,
    });
  });

  it('translates the authoring vocabulary rather than passing GDD keys through', async () => {
    const { ctx, dispatch } = makeCtx(CAMERA_NODE);

    await cameraSetupExecutor.execute(
      {
        cameraMode: 'third-person',
        cameraConfig: { followDistance: 7, followHeight: 3 },
        targetEntityId: 'player-1',
      },
      ctx,
    );

    // `offset`, not `followDistance`/`followHeight`. The store's names share no
    // key with the engine's wire form, and the engine drops every key it does not
    // recognize without an error.
    expect(dispatch).toHaveBeenCalledWith('set_game_camera', {
      entityId: 'e-9',
      mode: 'thirdPersonFollow',
      targetEntity: 'player-1',
      offset: [0, 3, -7],
    });
  });

  it('dispatches exactly two commands, configuring before activating', async () => {
    const { ctx, dispatch } = makeCtx(CAMERA_NODE);

    await cameraSetupExecutor.execute(
      { cameraMode: 'third-person', targetEntityId: 'player-1' },
      ctx,
    );

    // `toHaveBeenCalledWith` is blind to whatever else was dispatched alongside,
    // so every other case here would stay green with a stray `delete_entity` in
    // the middle. The ORDER matters too: activating a camera the engine has not
    // been told the mode of would render one frame of the previous camera.
    expect(dispatch.mock.calls.map((c) => c[0])).toEqual([
      'set_game_camera',
      'set_active_game_camera',
    ]);
  });

  // ---------------------------------------------------------------------------
  // The producer's vocabulary — the aliases that were missing
  // ---------------------------------------------------------------------------

  /**
   * `systemDecomposer.ts` picks its camera `defaultType` from a fixed list, and
   * three of those spellings had no alias entry: `side-scroll`, `orbit` and
   * `follow`. Each fell through to the unknown-mode fallback, so EVERY 2D
   * side-scroller the decomposer produced was configured as a third-person
   * follow camera — the exact defect PF-1125 was filed to fix, surviving the fix.
   * `cameraModeVocabulary.test.ts` guards the list; these guard the translation.
   */
  it.each([
    ['side-scroll', 'sideScroller'],
    ['orbit', 'orbital'],
    ['follow', 'thirdPersonFollow'],
    ['top-down', 'topDown'],
    ['first-person', 'firstPerson'],
  ])('normalizes the decomposer spelling %s to %s', async (raw, normalized) => {
    const { ctx, dispatch } = makeCtx(CAMERA_NODE);

    await cameraSetupExecutor.execute({ cameraMode: raw, targetEntityId: 'p' }, ctx);

    expect(dispatch).toHaveBeenCalledWith('set_game_camera', {
      entityId: 'e-9',
      mode: normalized,
      targetEntity: 'p',
    });
  });

  it('falls back to sideScroller, not thirdPersonFollow, in a 2D project', async () => {
    const { ctx, dispatch } = makeCtx(CAMERA_NODE, { projectType: '2d' });

    await cameraSetupExecutor.execute(
      { cameraMode: 'cinematic-dolly', targetEntityId: 'p' },
      ctx,
    );

    // A third-person camera orbiting a flat scene is not a sane default for a 2D
    // game, and `autoPolishExecutor` has always branched this way when it repairs
    // a missing camera — the authoring path disagreeing with the repair path meant
    // the same game got two different cameras depending on which one ran.
    expect(dispatch).toHaveBeenCalledWith('set_game_camera', {
      entityId: 'e-9',
      mode: 'sideScroller',
      targetEntity: 'p',
    });
  });

  // ---------------------------------------------------------------------------
  // The GDD's config vocabulary: mapped where the units match, reported otherwise
  // ---------------------------------------------------------------------------

  it('maps the GDD spelling altitude onto topDownHeight', async () => {
    const { ctx, dispatch } = makeCtx(CAMERA_NODE);

    const result = await cameraSetupExecutor.execute(
      { cameraMode: 'top-down', cameraConfig: { altitude: 18 }, targetEntityId: 'p' },
      ctx,
    );

    expect(dispatch).toHaveBeenCalledWith('set_game_camera', {
      entityId: 'e-9',
      mode: 'topDown',
      targetEntity: 'p',
      height: 18,
    });
    expect(result.output?.warning).toBeUndefined();
  });

  it('lets an explicit engine field beat the aliased GDD spelling', async () => {
    const { ctx, dispatch } = makeCtx(CAMERA_NODE);

    const result = await cameraSetupExecutor.execute(
      {
        cameraMode: 'top-down',
        cameraConfig: { altitude: 18, topDownHeight: 25 },
        targetEntityId: 'p',
      },
      ctx,
    );

    expect(dispatch).toHaveBeenCalledWith('set_game_camera', {
      entityId: 'e-9',
      mode: 'topDown',
      targetEntity: 'p',
      height: 25,
    });
    // The alias was accepted-then-overridden, which from the user's side is still
    // "this key did nothing", so it is reported rather than quietly discarded —
    // but with its own reason, because the fix is to delete one of the two
    // spellings, not to correct a name or a value.
    expect(result.output?.warning).toContain('given twice');
    expect(result.output?.warning).toContain('altitude (superseded by topDownHeight)');
    expect(result.output?.warning).not.toContain('no parameter for');
  });

  it('reports the config keys the engine has no parameter for', async () => {
    const { ctx, dispatch } = makeCtx(CAMERA_NODE);

    // The real vocabulary the GDD generator emits. Before PF-1125's second half,
    // `filterCameraNumerics` returned `{}` for input like this — 100% of it
    // dropped — while the step still reported `applied: true`.
    const result = await cameraSetupExecutor.execute(
      {
        cameraMode: 'side-scroll',
        cameraConfig: { smoothing: 0.1, leadAhead: 3, locked: true },
        targetEntityId: 'p',
      },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(dispatch).toHaveBeenCalledWith('set_game_camera', {
      entityId: 'e-9',
      mode: 'sideScroller',
      targetEntity: 'p',
    });
    expect(result.output?.warning).toContain('no parameter for');
    for (const key of ['smoothing', 'leadAhead', 'locked']) {
      expect(result.output?.warning).toContain(key);
    }
  });

  it('reports a real field carrying a value that cannot be sent', async () => {
    const { ctx } = makeCtx(CAMERA_NODE);

    const result = await cameraSetupExecutor.execute(
      { cameraMode: 'top-down', cameraConfig: { topDownHeight: '25' }, targetEntityId: 'p' },
      ctx,
    );

    // Naming a real parameter is not the same as setting it — but it is also not
    // the same as naming a parameter that does not exist, which is what this used
    // to be told. `topDownHeight` is a field the engine very much has, and an
    // author sent to look for a different key would never find one.
    expect(result.output?.warning).toContain('cannot accept');
    expect(result.output?.warning).toContain('topDownHeight (not a finite number)');
    expect(result.output?.warning).not.toContain('no parameter for');
  });

  it('reports a value the range policy refuses, naming the range as the reason', async () => {
    const { ctx, dispatch } = makeCtx(CAMERA_NODE);

    // A negative follow damping is the PF-1166 defect: the engine computes
    // `t = (damping * delta).min(1.0)` and lerps by it, so `t` is capped above
    // but never below — a negative rate extrapolates AWAY from the target and
    // compounds ~16x per second at 60fps. It used to be accepted here, sent, and
    // reported as applied.
    const result = await cameraSetupExecutor.execute(
      {
        cameraMode: 'follow',
        cameraConfig: { followSmoothing: -3, followDistance: 7 },
        targetEntityId: 'p',
      },
      ctx,
    );

    // The refused value is absent from the wire and the good one still lands.
    expect(dispatch).toHaveBeenCalledWith('set_game_camera', {
      entityId: 'e-9',
      mode: 'thirdPersonFollow',
      targetEntity: 'p',
      // `followHeight` was not given, so the engine's own default fills it —
      // omission and the default are the same thing by construction (PF-1126).
      offset: [0, 2, -7],
    });
    expect(result.output?.warning).toContain('followSmoothing (must not be negative)');
    // Between the filter and the report, this was the value announced by NEITHER:
    // dropped by one, and seen as a finite number under a real field name by the
    // other. It must never fall back to the wrong-parameter sentence.
    expect(result.output?.warning).not.toContain('no parameter for');
  });

  it('combines the targetless and ignored-key warnings into one report', async () => {
    const { ctx } = makeCtx(CAMERA_NODE);

    const result = await cameraSetupExecutor.execute(
      { cameraMode: 'follow', cameraConfig: { smoothing: 0.2 } },
      ctx,
    );

    expect(result.output?.warning).toContain('will not move');
    expect(result.output?.warning).toContain('smoothing');
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
      resolveStepOutputs: () => [],
    };
    nodes = { 'spawned-later': { entityId: 'spawned-later', name: 'PlayerCamera' } };

    await cameraSetupExecutor.execute(
      { cameraMode: 'top-down', targetEntityId: 'player-1' },
      ctx,
    );

    expect(dispatch).toHaveBeenCalledWith('set_game_camera', {
      entityId: 'spawned-later',
      mode: 'topDown',
      targetEntity: 'player-1',
    });
  });

  // ---------------------------------------------------------------------------
  // The follow target: every mode but `fixed` is INERT without one
  // ---------------------------------------------------------------------------

  /**
   * `engine/src/core/game_camera.rs` resolves `target_transform` to `None` when
   * `target_entity` is `None`, and wraps the ThirdPersonFollow, FirstPerson,
   * SideScroller, TopDown and Orbital update arms in
   * `if let Some(target_t) = target_transform`. So a targetless camera in any of
   * those modes never has its transform touched — it reports success, stores the
   * mode the GDD asked for, and sits motionless for the whole game. That is the
   * PF-1125 symptom one layer down, so it is reported rather than passed off as
   * a clean apply.
   */
  it.each([
    ['side-scroller', 'sideScroller'],
    ['first_person', 'firstPerson'],
    ['third-person', 'thirdPersonFollow'],
    ['top-down', 'topDown'],
    ['orbital', 'orbital'],
  ])('warns that a targetless %s camera will not move', async (raw, normalized) => {
    const { ctx, dispatch } = makeCtx(CAMERA_NODE);

    const result = await cameraSetupExecutor.execute({ cameraMode: raw }, ctx);

    expect(result.success).toBe(true);
    expect(result.output?.applied).toBe(true);
    expect(result.output?.targetEntityId).toBeNull();
    expect(result.output?.warning).toContain('will not move');
    // The mode is still worth recording — engine defaults beat failing a
    // non-optional step and discarding the whole build.
    expect(dispatch).toHaveBeenCalledWith('set_game_camera', {
      entityId: 'e-9',
      mode: normalized,
      targetEntity: null,
    });
  });

  it('does not warn for a targetless fixed camera — the one mode that works', async () => {
    const { ctx } = makeCtx(CAMERA_NODE);

    const result = await cameraSetupExecutor.execute({ cameraMode: 'fixed' }, ctx);

    expect(result.success).toBe(true);
    expect(result.output?.warning).toBeUndefined();
  });

  it('rejects an empty target id rather than sending one that can never match', async () => {
    const { ctx, dispatch } = makeCtx(CAMERA_NODE);

    // An empty string is not "no target" — it is a target id the engine will
    // look up and miss, silently, the way every other id miss fails here.
    const result = await cameraSetupExecutor.execute(
      { cameraMode: 'top-down', targetEntityId: '' },
      ctx,
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
    expect(dispatch).not.toHaveBeenCalled();
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

  it('does not read camera parameters off the prototype chain', async () => {
    const { ctx, dispatch } = makeCtx(CAMERA_NODE);

    // `Object.create`, NOT `JSON.parse('{"__proto__":…}')`. JSON.parse builds the
    // key with CreateDataProperty and never invokes the `__proto__` setter, so
    // that fixture yields a plain OWN property named `__proto__` — a key the
    // allowlist ignores for the same reason it ignores `arbitraryKey`. It passes
    // whether or not the own-key guards exist, which makes it a test of nothing.
    const config = Object.create({ topDownHeight: 99, altitude: 42 }) as Record<string, unknown>;

    const result = await cameraSetupExecutor.execute(
      { cameraMode: 'top-down', cameraConfig: config },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(dispatch).toHaveBeenCalledWith('set_game_camera', {
      entityId: 'e-9',
      mode: 'topDown',
      targetEntity: null,
    });
    // An inherited key is not something the user asked for, so it is not reported
    // as ignored either — `Object.keys` sees own keys only.
    expect(result.output?.warning).not.toContain('altitude');
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
  // ---------------------------------------------------------------------------
  // Command routing (PF-1231)
  // ---------------------------------------------------------------------------
  //
  // Both commands used to go out through `ctx.dispatchCommand` directly, which
  // meant an engine refusal — an unknown mode, a payload the bridge would not
  // deserialize — was reported to the user as a configured camera.
  describe('command routing (PF-1231)', () => {
    const INPUT = { cameraMode: 'third_person', targetEntityId: 'player-1' };

    it('sends both commands in ONE batch when the context has a batch dispatcher', async () => {
      // The parameter is named even though the body ignores it: without it TS
      // infers the mock's arg tuple as `[]` and `mock.calls[0][0]` stops
      // typechecking, which is the assertion this test exists for.
      const dispatchCommandBatch = vi.fn(
        (_commands: Array<{ command: string; payload?: unknown }>) => ({ success: true, results: [] }),
      );
      const { ctx, dispatch } = makeCtx(CAMERA_NODE, { dispatchCommandBatch });

      const result = await cameraSetupExecutor.execute(INPUT, ctx);

      expect(result.success).toBe(true);
      // Configuring a camera and activating it are one unit of work: split
      // across two crossings, a scene can render through the old camera for a
      // frame with the new one already configured.
      expect(dispatchCommandBatch).toHaveBeenCalledTimes(1);
      expect(dispatchCommandBatch.mock.calls[0][0]).toEqual([
        { command: 'set_game_camera', payload: expect.objectContaining({ entityId: 'e-9' }) },
        { command: 'set_active_game_camera', payload: { entityId: 'e-9' } },
      ]);
      expect(dispatch).not.toHaveBeenCalled();
    });

    it('FAILS the step when the engine refuses the camera commands', async () => {
      const { ctx } = makeCtx(CAMERA_NODE, {
        dispatchCommandBatch: vi.fn(() => ({
          success: false,
          results: [{ success: false, error: 'unknown command' }],
        })),
      });

      const result = await cameraSetupExecutor.execute(INPUT, ctx);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('COMMAND_FAILED');
    });

    it('FAILS the step when the single dispatcher refuses, with no batch dispatcher', async () => {
      const { ctx } = makeCtx(CAMERA_NODE, {
        dispatchCommand: vi.fn(() => ({ success: false, error: 'bad payload' })),
      });

      const result = await cameraSetupExecutor.execute(INPUT, ctx);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('COMMAND_FAILED');
    });
  });
});
