import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sceneCreateExecutor } from '../sceneCreateExecutor';
import type { ExecutorContext } from '../../types';
import { loadProjectScenes } from '@/lib/scenes/sceneManager';

function makeCtx(overrides?: Partial<ExecutorContext>): ExecutorContext {
  const ctx: ExecutorContext = {
    dispatchCommand: vi.fn(),
    store: { setScenes: vi.fn(), sceneGraph: { nodes: {} } } as never,
    getStore: () => ctx.store,
    projectType: '3d',
    userTier: 'creator',
    signal: new AbortController().signal,
    resolveStepOutput: vi.fn(),
    ...overrides,
  };
  return ctx;
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

    expect(ctx.store.setScenes).toHaveBeenCalledWith(
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
    expect(ctx.store.setScenes).not.toHaveBeenCalled();
  });

  it('still applies camera config on a primary creation step', async () => {
    const ctx = makeCtx();
    const result = await sceneCreateExecutor.execute({
      name: 'Arena',
      cameraMode: 'side-scroller',
      cameraConfig: { entityId: 'cam-1', sideScrollerDistance: 12 },
    }, ctx);

    expect(result.success).toBe(true);
    expect(ctx.dispatchCommand).toHaveBeenCalledWith('set_game_camera', {
      entityId: 'cam-1',
      mode: 'sideScroller',
      sideScrollerDistance: 12,
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
