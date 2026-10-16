import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sceneCreateExecutor } from '../sceneCreateExecutor';
import type { ExecutorContext, OrchestratorGDD } from '../../types';
import { loadProjectScenes, saveProjectScenes, createInitialProject } from '@/lib/scenes/sceneManager';
import { attachFixtureValidator } from '@/lib/scenes/__tests__/sceneFixture';
import { setSceneValidator } from '@/lib/scenes/sceneValidation';
import { ENGINE_THREW_RELOAD_GUIDANCE, EngineDispatchThrewError } from '@/lib/scenes/engineDispatchThrew';

/**
 * `store` is a TEST-ONLY override key: it seeds what `ctx.getStore()` returns.
 * `ExecutorContext` itself has no `store` field — executors must read the live
 * store through `getStore()`, never a snapshot (PF-1118).
 */
type CtxOverrides = Partial<ExecutorContext> & { store?: unknown };

type FrameCallback = (time: number) => void;

function makeCtx(overrides: CtxOverrides = {}): ExecutorContext {
  const {
    store = { setScenes: vi.fn(), newScene: vi.fn(), sceneGraph: { nodes: {} } } as never,
    ...rest
  } = overrides;
  return {
    dispatchCommand: vi.fn(),
    getStore: () => store as ReturnType<ExecutorContext['getStore']>,
    projectType: '3d',
    userTier: 'creator',
    signal: new AbortController().signal,
    resolveStepOutput: vi.fn(),
    resolveStepOutputs: vi.fn(() => []),
    ...rest,
  };
}

describe('sceneCreateExecutor', () => {
  beforeEach(() => {
    localStorage.clear();
    attachFixtureValidator();
  });

  afterEach(() => {
    setSceneValidator(null);
    vi.unstubAllGlobals();
  });

  it('creates scenes only in the active project namespace', async () => {
    const a = createInitialProject();
    const b = createInitialProject();
    a.scenes[0].name = 'Keep project A';
    b.scenes[0].name = 'Keep project B';
    saveProjectScenes(a, 'project-a');
    saveProjectScenes(b, 'project-b');
    const aBefore = JSON.stringify(loadProjectScenes('project-a'));
    const ctx = makeCtx({ store: {
      projectId: 'project-b', setScenes: vi.fn(), newScene: vi.fn(), sceneGraph: { nodes: {} },
    } });

    const result = await sceneCreateExecutor.execute({ name: 'New B scene' }, ctx);

    expect(result.success).toBe(true);
    expect(JSON.stringify(loadProjectScenes('project-a'))).toBe(aBefore);
    const updated = loadProjectScenes('project-b');
    expect(updated.scenes.map((scene) => scene.name)).toEqual(['Keep project B', 'New B scene']);
    expect(updated.activeSceneId).toBe(updated.scenes[1].id);
    expect(updated.scenes[1].data?.metadata?.name).toBe('New B scene');
  });

  it('has correct name', () => {
    expect(sceneCreateExecutor.name).toBe('scene_create');
  });

  // `create_scene` is an engine stub that rejects by design — scene management is
  // JS-side. Dispatching it made the pipeline's first step a silent no-op.
  it('never dispatches create_scene', async () => {
    const ctx = makeCtx();
    await sceneCreateExecutor.execute({ name: 'Cave Level', purpose: 'first level' }, ctx);

    const commands = (ctx.dispatchCommand as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(commands).not.toContain('create_scene');
  });

  it('records the scene under the given name and makes it active', async () => {
    const ctx = makeCtx();
    const result = await sceneCreateExecutor.execute({ name: 'Cave Level', purpose: 'first level' }, ctx);

    expect(result.success).toBe(true);

    const project = loadProjectScenes();
    const entry = project.scenes.find((s) => s.name === 'Cave Level');
    expect(entry).toBeDefined();
    expect(project.activeSceneId).toBe(entry?.id);

    expect(ctx.getStore().setScenes).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ name: 'Cave Level' })]),
      entry?.id,
    );
  });

  // Through the store, not a raw dispatch: `newScene` also drops scene audio
  // staged by an unconfirmed load, which the SCENE_LOADED this emits would
  // otherwise adopt onto the generated game's entity ids.
  it('clears the starter scene via the store\'s newScene', async () => {
    const ctx = makeCtx();
    await sceneCreateExecutor.execute({ name: 'Cave Level' }, ctx);

    expect(ctx.getStore().newScene).toHaveBeenCalled();
    expect(ctx.dispatchCommand).not.toHaveBeenCalledWith('new_scene', {});
  });

  // #9998: the brief's completion mode becomes the scene's native, editable
  // `SceneGraph.completionMode`. It rides on `newScene` because the
  // SCENE_LOADED that command emits is the boundary that sets the incoming
  // scene's mode — written any earlier, that same event would wipe it.
  it.each(['win', 'endless', 'sandbox', 'narrative'] as const)(
    'opens the new scene in the brief\'s %s mode',
    async (mode) => {
      const ctx = makeCtx({ gdd: { completionMode: mode } as OrchestratorGDD });
      await sceneCreateExecutor.execute({ name: 'Cave Level' }, ctx);

      expect(ctx.getStore().newScene).toHaveBeenCalledWith({ completionMode: mode });
    },
  );

  it('opens a legacy win scene when the brief declares no mode, rather than keeping the previous one', async () => {
    const withoutMode = makeCtx({ gdd: {} as OrchestratorGDD });
    await sceneCreateExecutor.execute({ name: 'Cave Level' }, withoutMode);
    expect(withoutMode.getStore().newScene).toHaveBeenCalledWith({ completionMode: undefined });

    // A context built before `gdd` existed (every older caller) behaves the same.
    const withoutGdd = makeCtx();
    await sceneCreateExecutor.execute({ name: 'Cave Level' }, withoutGdd);
    expect(withoutGdd.getStore().newScene).toHaveBeenCalledWith({ completionMode: undefined });
  });

  // PF-1138. `worldType`/`worldConfig` used to be accepted by this schema and
  // then dropped — there was no world build command to send them to — and the
  // world system's step pointed here because of it, so every generated game was
  // an empty room. Both fields are now GONE from the schema rather than ignored,
  // and the world is built by `world_build`. `z.object` strips unknown keys
  // silently, so a still-accepted field would be the very silent-drop defect
  // this closes; the assertion is on the full output for the same reason.
  it('no longer carries world config — the fields are stripped, not stored', async () => {
    const ctx = makeCtx();
    const before = loadProjectScenes().scenes.length;

    const result = await sceneCreateExecutor.execute({
      name: 'Cave Level',
      worldType: 'tiled',
      worldConfig: { tileSize: 32, gridWidth: 40, gridHeight: 24 },
    }, ctx);

    expect(result.success).toBe(true);
    expect(result.output).toEqual({ sceneName: 'Cave Level' });
    expect(ctx.dispatchCommand).not.toHaveBeenCalled();
    // Still a real scene creation: the overlay branch that used to skip this
    // work existed only for the world system's step, which no longer comes here.
    expect(loadProjectScenes().scenes.length).toBe(before + 1);
    expect(ctx.getStore().newScene).toHaveBeenCalled();
  });

  // Camera configuration moved out of this executor in PF-1125 — it lives in
  // `camera_setup`, which runs after entities exist. `cameraMode`/`cameraConfig`
  // were REMOVED from the schema rather than ignored, so a step that still sends
  // them is a visible no-op instead of a value that vanishes: `z.object` strips
  // unknown keys, and an accepted-but-unread field is the silent-drop defect
  // itself. This pins that neither the dispatch nor the old `pendingCameraConfig`
  // output can come back here.
  it('ignores camera fields entirely — no dispatch, no pending output', async () => {
    const ctx = makeCtx();
    const result = await sceneCreateExecutor.execute({
      name: 'Arena',
      cameraMode: 'side-scroller',
      cameraConfig: { entityId: 'cam-1', sideScrollerDistance: 12 },
    }, ctx);

    expect(result.success).toBe(true);
    expect(result.output).toEqual({ sceneName: 'Arena' });

    // The scene clear goes through `getStore().newScene()` as of PF-1155, so
    // this executor now dispatches nothing at all — which makes the assertion
    // stricter than the `['new_scene']` it replaced: ANY dispatch from here,
    // camera or otherwise, fails it.
    expect(ctx.getStore().newScene).toHaveBeenCalled();
    const commands = (ctx.dispatchCommand as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(commands).toEqual([]);
  });

  // Regression, PF-1245: `new_scene` and every `spawn_entity` dispatched before
  // the next engine frame land in the SAME frame, and `apply_new_scene` despawns
  // every deletable entity carrying an `EntityId`. Returning from this step
  // without waiting therefore lets the despawn eat the `entity_setup` cohort
  // that runs immediately after it, and which of the two wins is decided by
  // Bevy's ambiguous `Update` ordering — it flipped on #9493 from one unrelated
  // system being added to a 13-system tuple, and the live engine smoke gate
  // failed with a scene graph holding only `world_build`'s entities plus the
  // engine's `Undeletable` camera.
  //
  // The assertion is on the AWAIT, not on a call count: a version that fired the
  // frame wait and ignored the promise would still record two rAF calls while
  // reintroducing the exact race. So the executor must still be pending while
  // the frame callbacks are held, and must only settle once they have run.
  it('does not resolve until the engine has applied the scene clear', async () => {
    const pending: FrameCallback[] = [];
    const raf = vi.fn((cb: FrameCallback) => { pending.push(cb); return pending.length; });
    vi.stubGlobal('requestAnimationFrame', raf);

    const ctx = makeCtx();
    let settled = false;
    const run = sceneCreateExecutor.execute({ name: 'Arena' }, ctx).then((r) => { settled = true; return r; });

    // The clear is dispatched before the wait, so the engine has the request in
    // hand while we hold the frame — otherwise waiting would guarantee nothing.
    await Promise.resolve();
    expect(ctx.getStore().newScene).toHaveBeenCalled();
    expect(settled).toBe(false);

    // One tick is not enough: a single rAF can land inside the engine frame that
    // queued the command, which is why `waitForEngineFrame` nests two.
    pending.shift()!(0);
    await Promise.resolve();
    expect(settled).toBe(false);

    pending.shift()!(0);
    const result = await run;
    expect(settled).toBe(true);
    expect(result.success).toBe(true);

    vi.unstubAllGlobals();
  });

  // #10056: `newScene()` was made boolean precisely so a refused new scene
  // cannot be reported as success, but this executor discarded the result and
  // returned `successResult` regardless — so the pipeline reported a created
  // scene the engine never emptied, and every later step stacked the generated
  // game on top of the starter Ground/Player/Sun.
  it('fails the step when the engine refuses to clear the starter scene', async () => {
    const ctx = makeCtx({ store: {
      projectId: null, setScenes: vi.fn(), newScene: vi.fn(() => false), newSceneRefusal: vi.fn(() => 'engine_refused'), sceneGraph: { nodes: {} },
    } });

    const result = await sceneCreateExecutor.execute({ name: 'Cave Level' }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('COMMAND_FAILED');
    expect(result.error?.message).toBe('Engine refused new_scene while clearing the starter scene');
    // A refusal is not a throw: nothing was locked, so "try again" stays right
    // and the reload advice must not leak onto this path.
    expect(result.error?.userFacingMessage).toBe('Could not create the scene. Please try again.');
    expect(ctx.getStore().newScene).toHaveBeenCalled();
  });

  // #10202 review, round 2: `newScene()` is also `false` when the store
  // refused on its own — browser storage would not clear the prefab-instance
  // registry before the dispatch — and when no engine is attached. The step
  // error names the real cause so the log does not send the reader to the
  // engine for a storage refusal.
  it.each([
    ['registry_not_cleared', 'Browser storage refused to clear the prefab-instance registry, so new_scene was never dispatched'],
    ['engine_not_attached', 'No engine was attached to clear the starter scene, so new_scene was never dispatched'],
  ] as const)('names the real cause when newScene() refuses for %s', async (refusal, message) => {
    const ctx = makeCtx({ store: {
      projectId: null, setScenes: vi.fn(), newScene: vi.fn(() => false), newSceneRefusal: vi.fn(() => refusal), sceneGraph: { nodes: {} },
    } });

    const result = await sceneCreateExecutor.execute({ name: 'Cave Level' }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('COMMAND_FAILED');
    expect(result.error?.message).toBe(message);
    expect(result.error?.message).not.toContain('Engine refused');
    expect(result.error?.userFacingMessage).toBe('Could not create the scene. Please try again.');
  });

  // #10202 review (Sentry): `newScene()` now THROWS `EngineDispatchThrewError`
  // when the engine call throws, after locking every save path. This executor
  // had no catch, so the throw reached the pipeline runner's generic catch, was
  // reported `retryable: true`, and `scene_create`'s `maxRetries: 1` dispatched
  // `new_scene` a SECOND time — against an engine that had already thrown
  // mid-apply, with saves locked. The step must fail typed and non-retryable,
  // with exactly one dispatch.
  describe('when newScene() throws', () => {
    function makeThrowingCtx(thrown: unknown) {
      const newScene = vi.fn(() => { throw thrown; });
      const ctx = makeCtx({ store: {
        projectId: null, setScenes: vi.fn(), newScene, newSceneRefusal: vi.fn(() => null), sceneGraph: { nodes: {} },
      } });
      return { ctx, newScene };
    }

    it('fails the step NON-retryably after a single dispatch when the engine threw', async () => {
      const { ctx, newScene } = makeThrowingCtx(
        new EngineDispatchThrewError('new_scene', 'RuntimeError: unreachable executed'),
      );

      const result = await sceneCreateExecutor.execute({ name: 'Cave Level' }, ctx);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('ENGINE_DISPATCH_THREW');
      // The property the runner reads to decide whether to dispatch again.
      expect(result.error?.retryable).toBe(false);
      expect(newScene).toHaveBeenCalledTimes(1);
      // Names the engine throw and carries its text, and — like the chat
      // tools' `new_scene` — says to reload rather than blaming a refusal.
      expect(result.error?.message).toContain('due to an engine error (RuntimeError: unreachable executed)');
      expect(result.error?.message).toContain(ENGINE_THREW_RELOAD_GUIDANCE);
      expect(result.error?.message).not.toContain('Engine refused');
      // The line the user reads gives the right advice too. "Please try again"
      // — the step's generic message — is wrong after an engine throw: the
      // viewport can be half-applied and saving is locked, so the answer is to
      // reload, in the same words `sceneDispatchThrewResult` uses.
      expect(result.error?.userFacingMessage).toBe(
        `The engine failed while creating the scene. ${ENGINE_THREW_RELOAD_GUIDANCE}`,
      );
      expect(result.error?.userFacingMessage).toContain('Reload the editor');
      expect(result.error?.userFacingMessage).not.toContain('try again');
      expect(result.error?.userFacingMessage).not.toBe(sceneCreateExecutor.userFacingErrorMessage);
    });

    it('lets a throw that is not the engine\'s propagate to the runner as the plain failure it is', async () => {
      // A storage write refused under quota (or a subscriber that threw) set no
      // lockout, so it must not be reported as one — it goes to the runner's
      // generic catch exactly as before.
      const quota = new Error('QuotaExceededError');
      const { ctx, newScene } = makeThrowingCtx(quota);

      await expect(sceneCreateExecutor.execute({ name: 'Cave Level' }, ctx)).rejects.toBe(quota);
      expect(newScene).toHaveBeenCalledTimes(1);
    });
  });

  it('aborts before touching persisted scenes', async () => {
    const controller = new AbortController();
    controller.abort();
    const ctx = makeCtx({ signal: controller.signal });

    const result = await sceneCreateExecutor.execute({ name: 'Never' }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('ABORTED');
    expect(loadProjectScenes().scenes.some((s) => s.name === 'Never')).toBe(false);
  });
});
