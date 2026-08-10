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

function makeCtx(overrides: CtxOverrides = {}): ExecutorContext {
  const { store = { setScenes: vi.fn(), sceneGraph: { nodes: {} } } as never, ...rest } = overrides;
  return {
    dispatchCommand: vi.fn(),
    getStore: () => store as ReturnType<ExecutorContext['getStore']>,
    projectType: '3d',
    userTier: 'creator',
    signal: new AbortController().signal,
    resolveStepOutput: vi.fn(),
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

  it('clears the starter scene via new_scene', async () => {
    const ctx = makeCtx();
    await sceneCreateExecutor.execute({ name: 'Cave Level' }, ctx);

    expect(ctx.dispatchCommand).toHaveBeenCalledWith('new_scene', {});
  });

  it('does not create a scene or clear the viewport for a config-overlay step', async () => {
    const ctx = makeCtx();
    const before = loadProjectScenes().scenes.length;

    const result = await sceneCreateExecutor.execute({ cameraMode: 'top-down' }, ctx);

    expect(result.success).toBe(true);
    expect(loadProjectScenes().scenes.length).toBe(before);
    expect(ctx.dispatchCommand).not.toHaveBeenCalledWith('new_scene', {});
    expect(ctx.getStore().setScenes).not.toHaveBeenCalled();
  });

  it('still applies camera config on a primary creation step', async () => {
    const ctx = makeCtx();
    const result = await sceneCreateExecutor.execute({
      name: 'Arena',
      cameraMode: 'side-scroller',
      cameraConfig: { entityId: 'cam-1', sideScrollerDistance: 12 },
    }, ctx);

    expect(result.success).toBe(true);
    // Translated into the engine's vocabulary — `sideScrollerDistance` is the
    // store's authoring name for the engine's `zOffset`, and the engine drops
    // every name it does not recognize without an error (PF-1126).
    expect(ctx.dispatchCommand).toHaveBeenCalledWith('set_game_camera', {
      entityId: 'cam-1',
      mode: 'sideScroller',
      targetEntity: null,
      zOffset: 12,
    });
  });

  it('drops camera config keys no engine camera variant has', async () => {
    const ctx = makeCtx();
    const result = await sceneCreateExecutor.execute({
      name: 'Arena',
      cameraMode: 'top-down',
      cameraConfig: {
        entityId: 'cam-1',
        topDownHeight: 20,
        // Names the old hand-written allowlist accepted and dispatched flat.
        topDownAngle: 45,
        sideScrollerHeight: 6,
        followLookAhead: 2,
      },
    }, ctx);

    expect(result.success).toBe(true);
    expect(ctx.dispatchCommand).toHaveBeenCalledWith('set_game_camera', {
      entityId: 'cam-1',
      mode: 'topDown',
      targetEntity: null,
      height: 20,
    });
  });

  it('does not read camera params off the prototype chain', async () => {
    const ctx = makeCtx();
    // `cameraConfig` is GDD-derived, so the model controls its keys, and a
    // `__proto__` entry in that JSON produces exactly this object.
    //
    // Pins the PROPERTY, not one implementation of it: two independent guards
    // hold here — Zod's `z.record()` parse rebuilds the input as a plain object,
    // and the param loop reads own keys only — so this passes with either one
    // alone and only fails if BOTH go. That is weaker than a single-guard test
    // would be, and it is the honest shape given where the guards live.
    const cameraConfig = Object.create({ topDownHeight: 999 }) as Record<string, unknown>;
    cameraConfig['entityId'] = 'cam-1';

    const result = await sceneCreateExecutor.execute({
      name: 'Arena',
      cameraMode: 'top-down',
      cameraConfig,
    }, ctx);

    expect(result.success).toBe(true);
    expect(ctx.dispatchCommand).toHaveBeenCalledWith('set_game_camera', {
      entityId: 'cam-1',
      mode: 'topDown',
      targetEntity: null,
    });
  });

  it('does not read pending camera params off the prototype chain', async () => {
    const ctx = makeCtx();
    // Same input, the other branch: with no `entityId` there is no camera entity
    // to dispatch against, so the config is filtered into `pendingCameraConfig`
    // for a downstream step instead. That second loop is a separate read and had
    // no pin of its own.
    //
    // Measured, not assumed: stripping the loop's `Object.hasOwn` leaves this
    // test green, because Zod's `z.record()` parse rebuilds the input as a plain
    // object before either loop sees it and `execute()` offers no seam past it.
    // So this pins the PROPERTY — an inherited param never reaches downstream —
    // and the loop guard is the independently-true local version, held so the
    // read stays correct if the schema is ever loosened to passthrough. Same
    // honest shape as the dispatch-path test above.
    const cameraConfig = Object.create({ topDownHeight: 999 }) as Record<string, unknown>;

    const result = await sceneCreateExecutor.execute({
      name: 'Arena',
      cameraMode: 'top-down',
      cameraConfig,
    }, ctx);

    expect(result.success).toBe(true);
    expect(result.output?.pendingCameraConfig).toEqual({ mode: 'topDown', config: {} });
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
