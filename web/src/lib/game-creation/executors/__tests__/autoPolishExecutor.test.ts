import { describe, it, expect, vi } from 'vitest';
import { autoPolishExecutor } from '../autoPolishExecutor';
import type { ExecutorContext } from '../../types';

const FEEL_DIRECTIVE = {
  mood: 'adventurous',
  pacing: 'medium' as const,
  weight: 'medium' as const,
  referenceGames: ['Mario'],
  oneLiner: 'A platformer adventure',
};

/**
 * `store` is a TEST-ONLY override key: it seeds what `ctx.getStore()` returns.
 * `ExecutorContext` itself has no `store` field — executors must read the live
 * store through `getStore()`, never a snapshot (PF-1118).
 */
type CtxOverrides = Partial<ExecutorContext> & { store?: unknown };

function makeCtx(overrides: CtxOverrides = {}): ExecutorContext {
  const { store = { sceneGraph: { nodes: {} } } as never, ...rest } = overrides;
  return {
    dispatchCommand: vi.fn(),
    getStore: () => store as ReturnType<ExecutorContext['getStore']>,
    projectType: '3d',
    userTier: 'creator',
    signal: new AbortController().signal,
    resolveStepOutput: vi.fn().mockReturnValue(undefined),
    ...rest,
  };
}

describe('autoPolishExecutor', () => {
  it('has correct name and error message', () => {
    expect(autoPolishExecutor.name).toBe('auto_polish');
    expect(autoPolishExecutor.userFacingErrorMessage).toContain('ready as-is');
  });

  it('applies no fixes when no issues found', async () => {
    const ctx = makeCtx();
    const result = await autoPolishExecutor.execute({
      projectType: '3d',
      feelDirective: FEEL_DIRECTIVE,
    }, ctx);

    expect(result.success).toBe(true);
    expect(result.output?.fixCount).toBe(0);
    expect(result.output?.fixesApplied).toEqual([]);
    expect(ctx.dispatchCommand).not.toHaveBeenCalled();
  });

  it('adds ambient light when no_ambient_light issue present', async () => {
    const ctx = makeCtx({
      resolveStepOutput: vi.fn().mockReturnValue({ issues: ['no_ambient_light'] }),
    });

    const result = await autoPolishExecutor.execute({
      projectType: '3d',
      feelDirective: FEEL_DIRECTIVE,
    }, ctx);

    expect(result.success).toBe(true);
    expect(result.output?.fixesApplied).toContain('Added ambient lighting');
    expect(ctx.dispatchCommand).toHaveBeenCalledWith('update_ambient_light', {
      color: [1, 1, 1],
      brightness: 0.3,
    });
  });

  it('adds ground plane when no_ground_plane issue present', async () => {
    const ctx = makeCtx({
      resolveStepOutput: vi.fn().mockReturnValue({ issues: ['no_ground_plane'] }),
    });

    const result = await autoPolishExecutor.execute({
      projectType: '3d',
      feelDirective: FEEL_DIRECTIVE,
    }, ctx);

    expect(result.success).toBe(true);
    expect(result.output?.fixesApplied).toContain('Added ground plane');
    expect(ctx.dispatchCommand).toHaveBeenCalledWith('spawn_entity', {
      entityType: 'plane',
      name: 'Ground',
      position: [0, 0, 0],
    });
  });

  it('configures camera as thirdPersonFollow in 3D when no_camera_on_player', async () => {
    const ctx = makeCtx({
      resolveStepOutput: vi.fn().mockReturnValue({ issues: ['no_camera_on_player'] }),
      store: {
        sceneGraph: {
          nodes: {
            n1: { entityId: 'cam_id', name: 'MainCamera' },
          },
        },
      } as never,
    });

    const result = await autoPolishExecutor.execute({
      projectType: '3d',
      feelDirective: FEEL_DIRECTIVE,
    }, ctx);

    expect(result.success).toBe(true);
    expect(result.output?.fixesApplied).toContain('Configured camera as thirdPersonFollow');
    // The engine's vocabulary, not the store's: `followSmoothing` is authoring
    // for `damping`, and the engine drops every name it does not recognize
    // without an error (PF-1126).
    expect(ctx.dispatchCommand).toHaveBeenCalledWith('set_game_camera', {
      entityId: 'cam_id',
      mode: 'thirdPersonFollow',
      targetEntity: null,
      // No `damping`. This used to assert 0.8, sent as a 0..1 smoothing factor —
      // but the engine's damping is a rate per second (`t = (damping * delta)
      // .min(1.0)`), so 0.8 ran the follow roughly six times slower than the 5.0
      // default. Omitting the field is how the payload asks for that default, and
      // it keeps no second copy of the number here to drift from the engine's.
    });
  });

  it('configures camera as sideScroller in 2D', async () => {
    const ctx = makeCtx({
      resolveStepOutput: vi.fn().mockReturnValue({ issues: ['no_camera_on_player'] }),
      store: {
        sceneGraph: {
          nodes: {
            n1: { entityId: 'cam2d', name: 'game_cam' },
          },
        },
      } as never,
    });

    const result = await autoPolishExecutor.execute({
      projectType: '2d',
      feelDirective: FEEL_DIRECTIVE,
    }, ctx);

    expect(result.success).toBe(true);
    expect(result.output?.fixesApplied).toContain('Configured camera as sideScroller');
    // `GameCameraData` has no side-scroller damping field, so the 0.8 smoothing
    // the 3D branch gets is simply not expressible here — the camera takes the
    // engine's default of 5. Asserted in full so that gap stays visible rather
    // than reappearing as a silently-dropped key.
    expect(ctx.dispatchCommand).toHaveBeenCalledWith('set_game_camera', {
      entityId: 'cam2d',
      mode: 'sideScroller',
      targetEntity: null,
    });
  });

  it('warns when no camera entity exists for no_camera_on_player', async () => {
    const ctx = makeCtx({
      resolveStepOutput: vi.fn().mockReturnValue({ issues: ['no_camera_on_player'] }),
    });

    const result = await autoPolishExecutor.execute({
      projectType: '3d',
      feelDirective: FEEL_DIRECTIVE,
    }, ctx);

    expect(result.success).toBe(true);
    expect(result.output?.fixesApplied).toContain('Warning: no camera entity found to configure');
    // No command dispatched since no camera found
    expect(ctx.dispatchCommand).not.toHaveBeenCalled();
  });

  it('warns about physics_without_collider without dispatching commands', async () => {
    const ctx = makeCtx({
      resolveStepOutput: vi.fn().mockReturnValue({ issues: ['physics_without_collider'] }),
    });

    const result = await autoPolishExecutor.execute({
      projectType: '3d',
      feelDirective: FEEL_DIRECTIVE,
    }, ctx);

    expect(result.success).toBe(true);
    expect(result.output?.fixesApplied).toContain('Warning: entity has physics without collider — manual fix needed');
    expect(ctx.dispatchCommand).not.toHaveBeenCalled();
  });

  it('applies multiple fixes for multiple issues', async () => {
    const ctx = makeCtx({
      resolveStepOutput: vi.fn().mockReturnValue({
        issues: ['no_ambient_light', 'no_ground_plane', 'physics_without_collider'],
      }),
    });

    const result = await autoPolishExecutor.execute({
      projectType: '3d',
      feelDirective: FEEL_DIRECTIVE,
    }, ctx);

    expect(result.success).toBe(true);
    expect(result.output?.fixCount).toBe(3);
    const fixes = result.output?.fixesApplied as string[];
    expect(fixes).toContain('Added ambient lighting');
    expect(fixes).toContain('Added ground plane');
  });

  it('uses dispatchCommandBatch when available', async () => {
    const batch = vi.fn().mockReturnValue({ success: true });
    const ctx = makeCtx({
      dispatchCommandBatch: batch,
      resolveStepOutput: vi.fn().mockReturnValue({ issues: ['no_ambient_light', 'no_ground_plane'] }),
    });

    const result = await autoPolishExecutor.execute({
      projectType: '3d',
      feelDirective: FEEL_DIRECTIVE,
    }, ctx);

    expect(result.success).toBe(true);
    expect(batch).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ command: 'update_ambient_light' }),
      expect.objectContaining({ command: 'spawn_entity' }),
    ]));
  });

  it('returns failure when batch command fails', async () => {
    const batch = vi.fn().mockReturnValue({ success: false });
    const ctx = makeCtx({
      dispatchCommandBatch: batch,
      resolveStepOutput: vi.fn().mockReturnValue({ issues: ['no_ambient_light'] }),
    });

    const result = await autoPolishExecutor.execute({
      projectType: '3d',
      feelDirective: FEEL_DIRECTIVE,
    }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('COMMAND_FAILED');
  });

  it('rejects invalid projectType', async () => {
    const ctx = makeCtx();
    const result = await autoPolishExecutor.execute({
      projectType: 'vr',
      feelDirective: FEEL_DIRECTIVE,
    }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
  });

  it('rejects invalid pacing in feelDirective', async () => {
    const ctx = makeCtx();
    const result = await autoPolishExecutor.execute({
      projectType: '3d',
      feelDirective: { ...FEEL_DIRECTIVE, pacing: 'turbo' },
    }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
  });

  it('finds camera by _cam suffix', async () => {
    const ctx = makeCtx({
      resolveStepOutput: vi.fn().mockReturnValue({ issues: ['no_camera_on_player'] }),
      store: {
        sceneGraph: {
          nodes: {
            n1: { entityId: 'follow_cam_id', name: 'follow_cam' },
          },
        },
      } as never,
    });

    const result = await autoPolishExecutor.execute({
      projectType: '3d',
      feelDirective: FEEL_DIRECTIVE,
    }, ctx);

    expect(result.success).toBe(true);
    expect(ctx.dispatchCommand).toHaveBeenCalledWith('set_game_camera', {
      entityId: 'follow_cam_id',
      mode: 'thirdPersonFollow',
      targetEntity: null,
      // No `damping` — see the 3D case above.
    });
  });
});
