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

/**
 * A store stub always carries `allGameComponents` — the executor forwards it to
 * `applyPhysicsProfile`, which merges the profile onto each entity's EXISTING
 * character controller instead of rebuilding it from `Default`. Omitting it here
 * would let the map silently arrive as `undefined` and reintroduce PF-1118.
 */
function makeStore(
  nodes: Record<string, ReturnType<typeof makeNode>> = {},
  allGameComponents: Record<string, unknown[]> = {},
): ExecutorContext['store'] {
  return {
    sceneGraph: { nodes, rootIds: Object.keys(nodes) },
    allGameComponents,
  } as unknown as ExecutorContext['store'];
}

function makeCtx(overrides: Partial<ExecutorContext> = {}): ExecutorContext {
  return {
    dispatchCommand: vi.fn(),
    store: makeStore(),
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
      ctx.store.allGameComponents,
    );
    const output = result.output as { entityCount: number };
    expect(output.entityCount).toBe(2);
  });

  it('forwards the live game-component map so existing controllers are merged, not reset', async () => {
    // This executor runs AFTER character_setup in the pipeline. Dropping the map
    // here makes applyPhysicsProfile rebuild the controller from Default and wipe
    // every field that step configured — canDoubleJump above all (PF-1118).
    const components = {
      e1: [
        {
          type: 'characterController',
          characterController: { speed: 5, jumpHeight: 8, gravityScale: 1, canDoubleJump: true },
        },
      ],
    };
    const ctx = makeCtx({
      store: makeStore({ e1: makeNode('e1', 'Player', ['PhysicsData']) }, components),
    });

    await physicsProfileExecutor.execute({
      feelDirective: makeFeelDirective(),
      projectType: '3d',
      entityIds: ['e1'],
    }, ctx);

    expect(mockApplyPhysicsProfile.mock.calls[0][3]).toEqual(components);
  });

  it('falls back to store physics nodes when no entityIds', async () => {
    const ctx = makeCtx({
      store: makeStore({
        e1: makeNode('e1', 'Player', ['PhysicsData']),
        e2: makeNode('e2', 'Enemy', ['RigidBody']),
        e3: makeNode('e3', 'Ground', []),
      }),
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
      ctx.store.allGameComponents,
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
      store: makeStore({ e1: makeNode('e1', 'Player', ['PhysicsData']) }),
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
      store: makeStore({ e1: makeNode('e1', 'Player', ['PhysicsData']) }),
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
