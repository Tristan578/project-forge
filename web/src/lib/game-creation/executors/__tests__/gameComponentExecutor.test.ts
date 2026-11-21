/**
 * Tests for the `game_component` executor.
 *
 * This executor exists because nothing in the generation pipeline could attach
 * a gameplay component to a generated entity, so no generated game ever carried
 * a win condition and `validateWinnability` refused every Edit -> Play
 * transition (PF-1199).
 *
 * The assertions here are deliberately FULL-payload (`toEqual` /
 * `toHaveBeenCalledWith` on the whole object), never `expect.objectContaining`.
 * `objectContaining` asserts what is present and is blind to whatever the
 * executor invented alongside it — which is precisely the defect class this
 * executor is written to close: the engine merges a component payload onto ITS
 * OWN defaults, so a field the executor forgets silently keeps an engine
 * default, and a field it invents silently reaches the simulation.
 */

import { describe, it, expect, vi } from 'vitest';
import { gameComponentExecutor } from '../gameComponentExecutor';
import type { ExecutorContext } from '../../types';

/**
 * `store` is a TEST-ONLY override key: it seeds what `ctx.getStore()` returns.
 * `ExecutorContext` has no `store` field — executors must read the live store
 * through `getStore()`, never a snapshot (PF-1118).
 */
type CtxOverrides = Partial<ExecutorContext> & { store?: unknown };

function makeStore(extra: Record<string, unknown> = {}) {
  return {
    // Empty by default: the engine has not reported a scene graph yet during a
    // pipeline run, and the executor must not treat "not reported" as "absent".
    sceneGraph: { nodes: {}, rootIds: [] },
    addGameComponent: vi.fn(),
    ...extra,
  };
}

type TestStore = ReturnType<typeof makeStore>;

function makeCtx(overrides: CtxOverrides = {}): ExecutorContext {
  const { store = makeStore(), ...rest } = overrides;
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

function storeOf(ctx: ExecutorContext): TestStore {
  return ctx.getStore() as unknown as TestStore;
}

/** The plan injects these into EVERY step input (planBuilder Phase 3). */
const PLAN_INJECTED = {
  projectType: '3d',
  feelDirective: {
    mood: 'tense',
    pacing: 'fast',
    weight: 'heavy',
    referenceGames: [],
    oneLiner: 'x',
  },
};

describe('gameComponentExecutor', () => {
  it('is registered under the name the plan builder emits', () => {
    expect(gameComponentExecutor.name).toBe('game_component');
    expect(gameComponentExecutor.userFacingErrorMessage.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // winCondition
  // -------------------------------------------------------------------------

  it('attaches a score win condition as a COMPLETE property bag', async () => {
    const ctx = makeCtx();
    const result = await gameComponentExecutor.execute(
      {
        ...PLAN_INJECTED,
        type: 'winCondition',
        entityId: 'id-hero',
        conditionType: 'score',
        targetScore: 30,
        targetEntityId: null,
      },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(storeOf(ctx).addGameComponent).toHaveBeenCalledTimes(1);
    expect(storeOf(ctx).addGameComponent).toHaveBeenCalledWith('id-hero', {
      type: 'winCondition',
      winCondition: {
        conditionType: 'score',
        targetScore: 30,
        targetEntityId: null,
      },
    });
    expect(result.output).toEqual({ entityId: 'id-hero', componentType: 'winCondition' });
  });

  it('attaches a collectAll win condition', async () => {
    const ctx = makeCtx();
    await gameComponentExecutor.execute(
      {
        type: 'winCondition',
        entityId: 'id-hero',
        conditionType: 'collectAll',
        targetScore: null,
        targetEntityId: null,
      },
      ctx,
    );

    expect(storeOf(ctx).addGameComponent).toHaveBeenCalledWith('id-hero', {
      type: 'winCondition',
      winCondition: { conditionType: 'collectAll', targetScore: null, targetEntityId: null },
    });
  });

  it('attaches a reachGoal win condition bound to the goal UUID', async () => {
    const ctx = makeCtx();
    await gameComponentExecutor.execute(
      {
        type: 'winCondition',
        entityId: 'id-hero',
        conditionType: 'reachGoal',
        targetScore: null,
        targetEntityId: 'id-exit',
      },
      ctx,
    );

    expect(storeOf(ctx).addGameComponent).toHaveBeenCalledWith('id-hero', {
      type: 'winCondition',
      winCondition: { conditionType: 'reachGoal', targetScore: null, targetEntityId: 'id-exit' },
    });
  });

  it('rejects a score condition with no target score', async () => {
    const ctx = makeCtx();
    const result = await gameComponentExecutor.execute(
      {
        type: 'winCondition',
        entityId: 'id-hero',
        conditionType: 'score',
        targetScore: null,
        targetEntityId: null,
      },
      ctx,
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
    expect(storeOf(ctx).addGameComponent).not.toHaveBeenCalled();
  });

  it('rejects a reachGoal condition with no target entity', async () => {
    const ctx = makeCtx();
    const result = await gameComponentExecutor.execute(
      {
        type: 'winCondition',
        entityId: 'id-hero',
        conditionType: 'reachGoal',
        targetScore: null,
        targetEntityId: null,
      },
      ctx,
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
    expect(storeOf(ctx).addGameComponent).not.toHaveBeenCalled();
  });

  it.each([Infinity, Number.NaN, -5, 0])(
    'rejects a non-positive or non-finite target score (%p)',
    async targetScore => {
      const ctx = makeCtx();
      const result = await gameComponentExecutor.execute(
        {
          type: 'winCondition',
          entityId: 'id-hero',
          conditionType: 'score',
          targetScore,
          targetEntityId: null,
        },
        ctx,
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_INPUT');
      expect(storeOf(ctx).addGameComponent).not.toHaveBeenCalled();
    },
  );

  // -------------------------------------------------------------------------
  // health
  // -------------------------------------------------------------------------

  it('attaches a health component as a COMPLETE property bag', async () => {
    const ctx = makeCtx();
    const result = await gameComponentExecutor.execute(
      {
        ...PLAN_INJECTED,
        type: 'health',
        entityId: 'id-hero',
        maxHp: 100,
        currentHp: 100,
        invincibilitySecs: 0.5,
        respawnOnDeath: true,
        respawnPoint: [0, 1, 0],
        despawnOnDeath: false,
      },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(storeOf(ctx).addGameComponent).toHaveBeenCalledWith('id-hero', {
      type: 'health',
      health: {
        maxHp: 100,
        currentHp: 100,
        invincibilitySecs: 0.5,
        respawnOnDeath: true,
        respawnPoint: [0, 1, 0],
        despawnOnDeath: false,
      },
    });
  });

  it('rejects a health component missing a field the engine would default', async () => {
    const ctx = makeCtx();
    const result = await gameComponentExecutor.execute(
      {
        type: 'health',
        entityId: 'id-hero',
        maxHp: 100,
        // currentHp deliberately absent
        invincibilitySecs: 0.5,
        respawnOnDeath: true,
        respawnPoint: [0, 1, 0],
        despawnOnDeath: false,
      },
      ctx,
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
    expect(storeOf(ctx).addGameComponent).not.toHaveBeenCalled();
  });

  it('rejects a respawn point that is not three finite numbers', async () => {
    const ctx = makeCtx();
    const result = await gameComponentExecutor.execute(
      {
        type: 'health',
        entityId: 'id-hero',
        maxHp: 100,
        currentHp: 100,
        invincibilitySecs: 0,
        respawnOnDeath: true,
        respawnPoint: [0, Number.NaN, 0],
        despawnOnDeath: false,
      },
      ctx,
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
  });

  // -------------------------------------------------------------------------
  // collectible
  // -------------------------------------------------------------------------

  it('attaches a collectible component as a COMPLETE property bag', async () => {
    const ctx = makeCtx();
    const result = await gameComponentExecutor.execute(
      {
        ...PLAN_INJECTED,
        type: 'collectible',
        entityId: 'id-coin',
        value: 5,
        destroyOnCollect: true,
        pickupSoundAsset: null,
        rotateSpeed: 90,
      },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(storeOf(ctx).addGameComponent).toHaveBeenCalledWith('id-coin', {
      type: 'collectible',
      collectible: {
        value: 5,
        destroyOnCollect: true,
        pickupSoundAsset: null,
        rotateSpeed: 90,
      },
    });
  });

  // -------------------------------------------------------------------------
  // damageZone
  // -------------------------------------------------------------------------

  it('attaches a damageZone component as a COMPLETE property bag', async () => {
    const ctx = makeCtx();
    const result = await gameComponentExecutor.execute(
      {
        ...PLAN_INJECTED,
        type: 'damageZone',
        entityId: 'id-spikes',
        damagePerSecond: 40,
        oneShot: false,
      },
      ctx,
    );

    expect(result.success).toBe(true);
    // Full-object equality, not `objectContaining`: the engine merges this bag
    // onto `DamageZoneData::default()`, so a forgotten key silently keeps the
    // engine default (25 dps) and an invented one silently reaches the sim.
    expect(storeOf(ctx).addGameComponent).toHaveBeenCalledWith('id-spikes', {
      type: 'damageZone',
      damageZone: {
        damagePerSecond: 40,
        oneShot: false,
      },
    });
  });

  it('attaches a one-shot damageZone', async () => {
    const ctx = makeCtx();
    const result = await gameComponentExecutor.execute(
      { type: 'damageZone', entityId: 'id-pit', damagePerSecond: 1000, oneShot: true },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(storeOf(ctx).addGameComponent).toHaveBeenCalledWith('id-pit', {
      type: 'damageZone',
      damageZone: { damagePerSecond: 1000, oneShot: true },
    });
  });

  it('rejects a damageZone whose damagePerSecond is not a finite number', async () => {
    const ctx = makeCtx();
    const result = await gameComponentExecutor.execute(
      { type: 'damageZone', entityId: 'id-spikes', damagePerSecond: Number.NaN, oneShot: false },
      ctx,
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
    expect(storeOf(ctx).addGameComponent).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Entity binding
  // -------------------------------------------------------------------------

  it('fails when the scene graph is known and does not contain the entity', async () => {
    const store = makeStore({
      sceneGraph: { nodes: { 'id-someone-else': { id: 'id-someone-else' } }, rootIds: [] },
    });
    const ctx = makeCtx({ store });

    const result = await gameComponentExecutor.execute(
      {
        type: 'collectible',
        entityId: 'id-ghost',
        value: 1,
        destroyOnCollect: true,
        pickupSoundAsset: null,
        rotateSpeed: 90,
      },
      ctx,
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('ENTITY_NOT_FOUND');
    expect(result.error?.userFacingMessage.length).toBeGreaterThan(0);
    expect(store.addGameComponent).not.toHaveBeenCalled();
  });

  it('reads the scene graph with Object.hasOwn, not a bare index', async () => {
    // `nodes['constructor']` resolves on the prototype chain, so a bare read
    // would report this phantom entity as present.
    const store = makeStore({
      sceneGraph: { nodes: { 'id-real': { id: 'id-real' } }, rootIds: [] },
    });
    const ctx = makeCtx({ store });

    const result = await gameComponentExecutor.execute(
      {
        type: 'collectible',
        entityId: 'constructor',
        value: 1,
        destroyOnCollect: true,
        pickupSoundAsset: null,
        rotateSpeed: 90,
      },
      ctx,
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('ENTITY_NOT_FOUND');
    expect(store.addGameComponent).not.toHaveBeenCalled();
  });

  it('does NOT fail on an unreported scene graph — an empty graph is unknown, not absent', async () => {
    const ctx = makeCtx();
    const result = await gameComponentExecutor.execute(
      {
        type: 'collectible',
        entityId: 'id-coin',
        value: 1,
        destroyOnCollect: true,
        pickupSoundAsset: null,
        rotateSpeed: 90,
      },
      ctx,
    );

    expect(result.success).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['whitespace only', '   '],
    ['control character', 'id-\u0007-coin'],
    ['over 64 bytes', 'x'.repeat(65)],
  ])('rejects an entity id the engine cannot address (%s)', async (_label, entityId) => {
    const ctx = makeCtx();
    const result = await gameComponentExecutor.execute(
      {
        type: 'collectible',
        entityId,
        value: 1,
        destroyOnCollect: true,
        pickupSoundAsset: null,
        rotateSpeed: 90,
      },
      ctx,
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
    expect(storeOf(ctx).addGameComponent).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Input hygiene
  // -------------------------------------------------------------------------

  it('rejects a component type it does not implement', async () => {
    const ctx = makeCtx();
    const result = await gameComponentExecutor.execute(
      { type: 'spawner', entityId: 'id-hero', maxCount: 5 },
      ctx,
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
    expect(storeOf(ctx).addGameComponent).not.toHaveBeenCalled();
  });

  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])(
    'rejects a prototype-chain key used as a component type (%s)',
    async type => {
      const ctx = makeCtx();
      const result = await gameComponentExecutor.execute({ type, entityId: 'id-hero' }, ctx);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_INPUT');
      expect(storeOf(ctx).addGameComponent).not.toHaveBeenCalled();
    },
  );

  it('cannot be made to forward a smuggled __proto__ payload', async () => {
    const ctx = makeCtx();
    // JSON.parse is the realistic source: it produces an OWN "__proto__" data
    // property, which a naive spread would carry straight into the payload.
    const input = JSON.parse(
      '{"type":"collectible","entityId":"id-coin","value":5,"destroyOnCollect":true,'
        + '"pickupSoundAsset":null,"rotateSpeed":90,'
        + '"__proto__":{"value":9999},"constructor":{"rotateSpeed":9999}}',
    ) as Record<string, unknown>;

    const result = await gameComponentExecutor.execute(input, ctx);

    expect(result.success).toBe(true);
    const call = storeOf(ctx).addGameComponent.mock.calls[0];
    expect(call[1]).toEqual({
      type: 'collectible',
      collectible: {
        value: 5,
        destroyOnCollect: true,
        pickupSoundAsset: null,
        rotateSpeed: 90,
      },
    });
    // Not merely value-equal: structurally clean, built key-by-key.
    expect(Object.getPrototypeOf(call[1] as object)).toBe(Object.prototype);
    const collectible = (call[1] as { collectible: object }).collectible;
    expect(Object.getPrototypeOf(collectible)).toBe(Object.prototype);
    expect(Object.keys(collectible).sort()).toEqual([
      'destroyOnCollect',
      'pickupSoundAsset',
      'rotateSpeed',
      'value',
    ]);
  });

  it('never dispatches an engine command directly — the store owns that', async () => {
    const ctx = makeCtx();
    await gameComponentExecutor.execute(
      {
        type: 'winCondition',
        entityId: 'id-hero',
        conditionType: 'score',
        targetScore: 10,
        targetEntityId: null,
      },
      ctx,
    );

    expect(ctx.dispatchCommand).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // PF-1201 — the kinds that used to fall through to a generated script
  // -------------------------------------------------------------------------

  describe('checkpoint', () => {
    it('builds the whole bag, so no field falls back to an engine default', async () => {
      const ctx = makeCtx();
      const result = await gameComponentExecutor.execute(
        { type: 'checkpoint', entityId: 'id-flag', autoSave: false, ...PLAN_INJECTED },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(storeOf(ctx).addGameComponent).toHaveBeenCalledWith('id-flag', {
        type: 'checkpoint',
        checkpoint: { autoSave: false },
      });
    });
  });

  describe('follower', () => {
    it('builds the whole bag', async () => {
      const ctx = makeCtx();
      const result = await gameComponentExecutor.execute(
        {
          type: 'follower',
          entityId: 'id-slime',
          targetEntityId: 'id-hero',
          speed: 4,
          stopDistance: 2,
          lookAtTarget: true,
          ...PLAN_INJECTED,
        },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(storeOf(ctx).addGameComponent).toHaveBeenCalledWith('id-slime', {
        type: 'follower',
        follower: {
          targetEntityId: 'id-hero',
          speed: 4,
          stopDistance: 2,
          lookAtTarget: true,
        },
      });
    });

    it('REFUSES to make something chase itself', async () => {
      const ctx = makeCtx();
      const result = await gameComponentExecutor.execute(
        {
          type: 'follower',
          entityId: 'id-slime',
          targetEntityId: 'id-slime',
          speed: 4,
          stopDistance: 2,
          lookAtTarget: true,
          ...PLAN_INJECTED,
        },
        ctx,
      );

      expect(result.success).toBe(false);
      expect(storeOf(ctx).addGameComponent).not.toHaveBeenCalled();
    });

    it('REFUSES a target the scene graph has reported as absent', async () => {
      const ctx = makeCtx({
        store: makeStore({
          sceneGraph: { nodes: { 'id-slime': { id: 'id-slime' } }, rootIds: [] },
        }),
      });
      const result = await gameComponentExecutor.execute(
        {
          type: 'follower',
          entityId: 'id-slime',
          targetEntityId: 'id-ghost',
          speed: 4,
          stopDistance: 2,
          lookAtTarget: true,
          ...PLAN_INJECTED,
        },
        ctx,
      );

      // Attaching it anyway would leave an enemy that silently never moves:
      // the engine matches the target on its `EntityId` component and emits
      // nothing at all when nothing matches.
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('ENTITY_NOT_FOUND');
      expect(storeOf(ctx).addGameComponent).not.toHaveBeenCalled();
    });

    it('accepts a target while the scene graph is still empty', async () => {
      // An empty graph means "the engine has not reported yet", not "absent".
      const ctx = makeCtx();
      const result = await gameComponentExecutor.execute(
        {
          type: 'follower',
          entityId: 'id-slime',
          targetEntityId: 'id-hero',
          speed: 4,
          stopDistance: 2,
          lookAtTarget: true,
          ...PLAN_INJECTED,
        },
        ctx,
      );

      expect(result.success).toBe(true);
    });
  });

  describe('movingPlatform', () => {
    it('builds the whole bag', async () => {
      const ctx = makeCtx();
      const result = await gameComponentExecutor.execute(
        {
          type: 'movingPlatform',
          entityId: 'id-platform',
          speed: 2,
          waypoints: [
            [0, 0, 0],
            [4, 0, 0],
          ],
          pauseDuration: 0.5,
          loopMode: 'pingPong',
          ...PLAN_INJECTED,
        },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(storeOf(ctx).addGameComponent).toHaveBeenCalledWith('id-platform', {
        type: 'movingPlatform',
        movingPlatform: {
          speed: 2,
          waypoints: [
            [0, 0, 0],
            [4, 0, 0],
          ],
          pauseDuration: 0.5,
          loopMode: 'pingPong',
        },
      });
    });

    it('REFUSES a single waypoint, which the engine ignores in silence', async () => {
      // `system_moving_platform` returns early below two waypoints, so a
      // one-waypoint platform is a platform that never moves and never says so.
      const ctx = makeCtx();
      const result = await gameComponentExecutor.execute(
        {
          type: 'movingPlatform',
          entityId: 'id-platform',
          speed: 2,
          waypoints: [[0, 0, 0]],
          pauseDuration: 0.5,
          loopMode: 'pingPong',
          ...PLAN_INJECTED,
        },
        ctx,
      );

      expect(result.success).toBe(false);
      expect(storeOf(ctx).addGameComponent).not.toHaveBeenCalled();
    });

    it('REFUSES more waypoints than the engine keeps, rather than being truncated', async () => {
      // The engine takes the first 64 and drops the rest without a word.
      const ctx = makeCtx();
      const waypoints = Array.from({ length: 65 }, (_, i) => [i, 0, 0]);
      const result = await gameComponentExecutor.execute(
        {
          type: 'movingPlatform',
          entityId: 'id-platform',
          speed: 2,
          waypoints,
          pauseDuration: 0.5,
          loopMode: 'pingPong',
          ...PLAN_INJECTED,
        },
        ctx,
      );

      expect(result.success).toBe(false);
      expect(storeOf(ctx).addGameComponent).not.toHaveBeenCalled();
    });
  });

  describe('spawner', () => {
    it('builds the whole bag', async () => {
      const ctx = makeCtx();
      const result = await gameComponentExecutor.execute(
        {
          type: 'spawner',
          entityId: 'id-nest',
          entityType: 'sphere',
          intervalSecs: 3,
          maxCount: 5,
          spawnOffset: [0, 1, 0],
          onTrigger: null,
          ...PLAN_INJECTED,
        },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(storeOf(ctx).addGameComponent).toHaveBeenCalledWith('id-nest', {
        type: 'spawner',
        spawner: {
          entityType: 'sphere',
          intervalSecs: 3,
          maxCount: 5,
          spawnOffset: [0, 1, 0],
          onTrigger: null,
        },
      });
    });

    it('REFUSES a mesh the engine cannot build', async () => {
      // The engine falls back to a cuboid for any unrecognised name, so a
      // "dragon" would silently become a cube in the finished game.
      const ctx = makeCtx();
      const result = await gameComponentExecutor.execute(
        {
          type: 'spawner',
          entityId: 'id-nest',
          entityType: 'dragon',
          intervalSecs: 3,
          maxCount: 5,
          spawnOffset: [0, 1, 0],
          onTrigger: null,
          ...PLAN_INJECTED,
        },
        ctx,
      );

      expect(result.success).toBe(false);
      expect(storeOf(ctx).addGameComponent).not.toHaveBeenCalled();
    });
  });
});
