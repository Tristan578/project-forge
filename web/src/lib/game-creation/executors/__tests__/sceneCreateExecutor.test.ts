import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sceneCreateExecutor } from '../sceneCreateExecutor';
import type { ExecutorContext } from '../../types';
import { loadProjectScenes } from '@/lib/scenes/sceneManager';

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
