/**
 * Tests for verifyExecutor — scene verification checks.
 */
import { describe, it, expect, vi } from 'vitest';
import { verifyExecutor } from '../verifyExecutor';
import type { ExecutorContext } from '../../types';

function makeCtx(overrides: Partial<ExecutorContext> = {}): ExecutorContext {
  return {
    dispatchCommand: vi.fn(),
    store: {
      sceneGraph: { nodes: {}, rootIds: [] },
    } as unknown as ExecutorContext['store'],
    projectType: '3d',
    userTier: 'creator',
    signal: new AbortController().signal,
    resolveStepOutput: vi.fn(),
    ...overrides,
  };
}

function makeNode(entityId: string, name: string, components: string[] = []) {
  return { entityId, name, components, children: [] };
}

describe('verifyExecutor', () => {
  it('has correct metadata', () => {
    expect(verifyExecutor.name).toBe('verify_all_scenes');
    expect(verifyExecutor.userFacingErrorMessage).toBeDefined();
  });

  it('reports empty scene', async () => {
    const ctx = makeCtx();
    const result = await verifyExecutor.execute({}, ctx);

    expect(result.success).toBe(true);
    const output = result.output as { warnings: string[]; issues: string[]; passed: boolean; entityCount: number };
    expect(output.warnings).toContain('Scene has no entities');
    expect(output.issues).toContain('empty_scene');
    expect(output.entityCount).toBe(0);
    expect(output.passed).toBe(false);
  });

  it('passes when scene has camera, light, and ground', async () => {
    const ctx = makeCtx({
      store: {
        sceneGraph: {
          nodes: {
            e1: makeNode('e1', 'Player'),
            e2: makeNode('e2', 'MainCamera'),
            e3: makeNode('e3', 'DirectionalLight'),
            e4: makeNode('e4', 'Ground'),
          },
          rootIds: ['e1', 'e2', 'e3', 'e4'],
        },
      } as unknown as ExecutorContext['store'],
    });

    const result = await verifyExecutor.execute({}, ctx);

    expect(result.success).toBe(true);
    const output = result.output as { warnings: string[]; issues: string[]; passed: boolean };
    expect(output.passed).toBe(true);
    expect(output.warnings).toHaveLength(0);
    expect(output.issues).toHaveLength(0);
  });

  it('detects missing camera', async () => {
    const ctx = makeCtx({
      store: {
        sceneGraph: {
          nodes: {
            e1: makeNode('e1', 'Player'),
            e2: makeNode('e2', 'AmbientLight'),
            e3: makeNode('e3', 'Ground'),
          },
          rootIds: ['e1', 'e2', 'e3'],
        },
      } as unknown as ExecutorContext['store'],
    });

    const result = await verifyExecutor.execute({}, ctx);

    const output = result.output as { issues: string[] };
    expect(output.issues).toContain('no_camera_on_player');
  });

  it('detects missing light', async () => {
    const ctx = makeCtx({
      store: {
        sceneGraph: {
          nodes: {
            e1: makeNode('e1', 'Player'),
            e2: makeNode('e2', 'Camera'),
            e3: makeNode('e3', 'Ground'),
          },
          rootIds: ['e1', 'e2', 'e3'],
        },
      } as unknown as ExecutorContext['store'],
    });

    const result = await verifyExecutor.execute({}, ctx);

    const output = result.output as { issues: string[] };
    expect(output.issues).toContain('no_ambient_light');
  });

  it('detects missing ground plane in 3D projects', async () => {
    const ctx = makeCtx({
      projectType: '3d',
      store: {
        sceneGraph: {
          nodes: {
            e1: makeNode('e1', 'Player'),
            e2: makeNode('e2', 'Camera'),
            e3: makeNode('e3', 'SunLight'),
          },
          rootIds: ['e1', 'e2', 'e3'],
        },
      } as unknown as ExecutorContext['store'],
    });

    const result = await verifyExecutor.execute({}, ctx);

    const output = result.output as { issues: string[] };
    expect(output.issues).toContain('no_ground_plane');
  });

  it('does not check ground plane for 2D projects', async () => {
    const ctx = makeCtx({
      projectType: '2d',
      store: {
        sceneGraph: {
          nodes: {
            e1: makeNode('e1', 'Player'),
            e2: makeNode('e2', 'Camera'),
            e3: makeNode('e3', 'AmbientLight'),
          },
          rootIds: ['e1', 'e2', 'e3'],
        },
      } as unknown as ExecutorContext['store'],
    });

    const result = await verifyExecutor.execute({}, ctx);

    const output = result.output as { issues: string[] };
    expect(output.issues).not.toContain('no_ground_plane');
  });

  it('recognizes camera naming variants', async () => {
    for (const name of ['Camera', 'camera', 'MainCamera', 'player_cam']) {
      const ctx = makeCtx({
        store: {
          sceneGraph: {
            nodes: {
              e1: makeNode('e1', name),
              e2: makeNode('e2', 'SunLight'),
              e3: makeNode('e3', 'Ground'),
            },
            rootIds: ['e1', 'e2', 'e3'],
          },
        } as unknown as ExecutorContext['store'],
      });

      const result = await verifyExecutor.execute({}, ctx);
      const output = result.output as { issues: string[] };
      expect(output.issues).not.toContain('no_camera_on_player');
    }
  });

  it('recognizes light naming variants', async () => {
    for (const name of ['DirectionalLight', 'ambient', 'Sun', 'sunlight']) {
      const ctx = makeCtx({
        store: {
          sceneGraph: {
            nodes: {
              e1: makeNode('e1', 'Camera'),
              e2: makeNode('e2', name),
              e3: makeNode('e3', 'Ground'),
            },
            rootIds: ['e1', 'e2', 'e3'],
          },
        } as unknown as ExecutorContext['store'],
      });

      const result = await verifyExecutor.execute({}, ctx);
      const output = result.output as { issues: string[] };
      expect(output.issues).not.toContain('no_ambient_light');
    }
  });

  it('recognizes ground naming variants', async () => {
    for (const name of ['Ground', 'floor', 'Plane', 'background_ground']) {
      const ctx = makeCtx({
        projectType: '3d',
        store: {
          sceneGraph: {
            nodes: {
              e1: makeNode('e1', 'Camera'),
              e2: makeNode('e2', 'Light'),
              e3: makeNode('e3', name),
            },
            rootIds: ['e1', 'e2', 'e3'],
          },
        } as unknown as ExecutorContext['store'],
      });

      const result = await verifyExecutor.execute({}, ctx);
      const output = result.output as { issues: string[] };
      expect(output.issues).not.toContain('no_ground_plane');
    }
  });

  it('returns entity count', async () => {
    const ctx = makeCtx({
      store: {
        sceneGraph: {
          nodes: {
            e1: makeNode('e1', 'Camera'),
            e2: makeNode('e2', 'Light'),
            e3: makeNode('e3', 'Ground'),
            e4: makeNode('e4', 'Enemy'),
            e5: makeNode('e5', 'Coin'),
          },
          rootIds: ['e1', 'e2', 'e3', 'e4', 'e5'],
        },
      } as unknown as ExecutorContext['store'],
    });

    const result = await verifyExecutor.execute({}, ctx);
    const output = result.output as { entityCount: number };
    expect(output.entityCount).toBe(5);
  });

  it('returns failure when aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const ctx = makeCtx({ signal: controller.signal });

    const result = await verifyExecutor.execute({}, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('ABORTED');
  });
});
