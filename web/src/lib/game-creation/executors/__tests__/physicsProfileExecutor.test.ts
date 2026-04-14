/**
 * Tests for physicsProfileExecutor — physics feel to preset mapping.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { physicsProfileExecutor } from '../physicsProfileExecutor';
import type { ExecutorContext } from '../../types';

// Mock the physics module
const mockApplyPhysicsProfile = vi.fn();
vi.mock('@/lib/ai/physicsFeel', () => ({
  PHYSICS_PRESETS: {
    space_zero_g: { gravity: 0, moveSpeed: 2 },
    platformer_floaty: { gravity: 5, moveSpeed: 6 },
    platformer_snappy: { gravity: 15, moveSpeed: 8 },
    underwater: { gravity: 3, moveSpeed: 3 },
    puzzle_precise: { gravity: 10, moveSpeed: 4 },
    arcade_classic: { gravity: 10, moveSpeed: 7 },
    rpg_weighty: { gravity: 12, moveSpeed: 5 },
  },
  applyPhysicsProfile: (...args: unknown[]) => mockApplyPhysicsProfile(...args),
}));

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

function makeFeelDirective(overrides: Record<string, unknown> = {}) {
  return {
    mood: 'energetic',
    pacing: 'medium',
    weight: 'medium',
    referenceGames: ['Super Mario Bros'],
    oneLiner: 'A fast-paced platformer',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('physicsProfileExecutor', () => {
  it('has correct metadata', () => {
    expect(physicsProfileExecutor.name).toBe('physics_profile');
    expect(physicsProfileExecutor.userFacingErrorMessage).toBeDefined();
  });

  it('maps floaty+slow to space_zero_g', async () => {
    const ctx = makeCtx();
    const result = await physicsProfileExecutor.execute({
      feelDirective: makeFeelDirective({ weight: 'floaty', pacing: 'slow' }),
      projectType: '3d',
    }, ctx);

    expect(result.success).toBe(true);
    const output = result.output as { presetUsed: string };
    expect(output.presetUsed).toBe('space_zero_g');
  });

  it('maps heavy+medium to rpg_weighty', async () => {
    const ctx = makeCtx();
    const result = await physicsProfileExecutor.execute({
      feelDirective: makeFeelDirective({ weight: 'heavy', pacing: 'medium' }),
      projectType: '3d',
    }, ctx);

    expect(result.success).toBe(true);
    const output = result.output as { presetUsed: string };
    expect(output.presetUsed).toBe('rpg_weighty');
  });

  it('maps light+slow to underwater', async () => {
    const ctx = makeCtx();
    const result = await physicsProfileExecutor.execute({
      feelDirective: makeFeelDirective({ weight: 'light', pacing: 'slow' }),
      projectType: '3d',
    }, ctx);

    expect(result.success).toBe(true);
    const output = result.output as { presetUsed: string };
    expect(output.presetUsed).toBe('underwater');
  });

  it('defaults to arcade_classic for medium+medium', async () => {
    const ctx = makeCtx();
    const result = await physicsProfileExecutor.execute({
      feelDirective: makeFeelDirective({ weight: 'medium', pacing: 'medium' }),
      projectType: '3d',
    }, ctx);

    expect(result.success).toBe(true);
    const output = result.output as { presetUsed: string };
    expect(output.presetUsed).toBe('arcade_classic');
  });

  it('applies to specified entityIds', async () => {
    const ctx = makeCtx();
    const result = await physicsProfileExecutor.execute({
      feelDirective: makeFeelDirective(),
      projectType: '3d',
      entityIds: ['e1', 'e2'],
    }, ctx);

    expect(result.success).toBe(true);
    expect(mockApplyPhysicsProfile).toHaveBeenCalledWith(
      expect.any(Object),
      ctx.dispatchCommand,
      ['e1', 'e2'],
    );
    const output = result.output as { entityCount: number };
    expect(output.entityCount).toBe(2);
  });

  it('falls back to store physics nodes when no entityIds', async () => {
    const ctx = makeCtx({
      store: {
        sceneGraph: {
          nodes: {
            e1: makeNode('e1', 'Player', ['PhysicsData']),
            e2: makeNode('e2', 'Enemy', ['RigidBody']),
            e3: makeNode('e3', 'Ground', []),
          },
          rootIds: ['e1', 'e2', 'e3'],
        },
      } as unknown as ExecutorContext['store'],
    });

    const result = await physicsProfileExecutor.execute({
      feelDirective: makeFeelDirective(),
      projectType: '3d',
    }, ctx);

    expect(result.success).toBe(true);
    expect(mockApplyPhysicsProfile).toHaveBeenCalledWith(
      expect.any(Object),
      ctx.dispatchCommand,
      ['e1', 'e2'],
    );
    const output = result.output as { entityCount: number };
    expect(output.entityCount).toBe(2);
  });

  it('returns entityCount 0 when no physics nodes and no entityIds', async () => {
    const ctx = makeCtx();
    const result = await physicsProfileExecutor.execute({
      feelDirective: makeFeelDirective(),
      projectType: '3d',
    }, ctx);

    expect(result.success).toBe(true);
    expect(mockApplyPhysicsProfile).not.toHaveBeenCalled();
    const output = result.output as { entityCount: number };
    expect(output.entityCount).toBe(0);
  });

  it('allows safe config overrides for moveSpeed and jumpForce', async () => {
    const ctx = makeCtx({
      store: {
        sceneGraph: {
          nodes: { e1: makeNode('e1', 'Player', ['PhysicsData']) },
          rootIds: ['e1'],
        },
      } as unknown as ExecutorContext['store'],
    });

    await physicsProfileExecutor.execute({
      feelDirective: makeFeelDirective(),
      projectType: '3d',
      config: { moveSpeed: 15, jumpForce: 20 },
    }, ctx);

    const appliedProfile = mockApplyPhysicsProfile.mock.calls[0][0];
    expect(appliedProfile.moveSpeed).toBe(15);
    expect(appliedProfile.jumpForce).toBe(20);
  });

  it('ignores non-numeric config overrides', async () => {
    const ctx = makeCtx({
      store: {
        sceneGraph: {
          nodes: { e1: makeNode('e1', 'Player', ['PhysicsData']) },
          rootIds: ['e1'],
        },
      } as unknown as ExecutorContext['store'],
    });

    await physicsProfileExecutor.execute({
      feelDirective: makeFeelDirective(),
      projectType: '3d',
      config: { moveSpeed: 'fast', jumpForce: NaN },
    }, ctx);

    const appliedProfile = mockApplyPhysicsProfile.mock.calls[0][0];
    // Should use preset value, not the invalid overrides
    expect(typeof appliedProfile.moveSpeed).toBe('number');
    expect(Number.isFinite(appliedProfile.moveSpeed)).toBe(true);
  });

  it('rejects invalid feel directive', async () => {
    const ctx = makeCtx();
    const result = await physicsProfileExecutor.execute({
      feelDirective: { mood: 'happy' }, // missing required fields
      projectType: '3d',
    }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
  });

  it('rejects missing projectType', async () => {
    const ctx = makeCtx();
    const result = await physicsProfileExecutor.execute({
      feelDirective: makeFeelDirective(),
    }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
  });

  it('rejects invalid pacing enum', async () => {
    const ctx = makeCtx();
    const result = await physicsProfileExecutor.execute({
      feelDirective: makeFeelDirective({ pacing: 'turbo' }),
      projectType: '3d',
    }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
  });
});
