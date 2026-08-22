/**
 * Tests for verifyExecutor — scene verification checks.
 *
 * The headline contract (PF-1199): verification runs the REAL
 * `validateWinnability` — the same function `gameSlice.play()` gates on — so
 * the pipeline can never report a playable game that the Play button then
 * refuses. Before this, the executor's only user-facing sentence was
 * "Verification found issues, but your game is still playable.", a claim it had
 * no evidence for and which was false for every generated game (none carried a
 * win condition, so `play()` refused all of them).
 */
import { describe, it, expect, vi } from 'vitest';
import { verifyExecutor } from '../verifyExecutor';
import { collectStepWarnings } from '../../stepWarnings';
import type { ExecutorContext } from '../../types';
import type { GameComponentData } from '@/stores/slices/types';

/**
 * `store` is a TEST-ONLY override key: it seeds what `ctx.getStore()` returns.
 * `ExecutorContext` itself has no `store` field — executors must read the live
 * store through `getStore()`, never a snapshot (PF-1118).
 */
type CtxOverrides = Partial<ExecutorContext> & { store?: unknown };

function makeCtx(overrides: CtxOverrides = {}): ExecutorContext {
  const {
    store = { sceneGraph: { nodes: {}, rootIds: [] }, allGameComponents: {} },
    ...rest
  } = overrides;
  const ctx: ExecutorContext = {
    dispatchCommand: vi.fn(),
    getStore: () => store as ReturnType<ExecutorContext['getStore']>,
    projectType: '3d',
    userTier: 'creator',
    signal: new AbortController().signal,
    resolveStepOutput: vi.fn(),
    resolveStepOutputs: vi.fn(() => []),
    ...rest,
  };
  return ctx;
}

function makeNode(entityId: string, name: string, components: string[] = []) {
  return { entityId, name, components, children: [] };
}

/**
 * A cosmetically complete 3D scene: camera, light, ground, player, goal.
 *
 * The player carries `PhysicsEnabled` because check 4 is a real check now: a
 * character without it never receives a collider, so the engine never even
 * considers it for a kinematic controller (PF-1214). A fixture missing it is not
 * a complete scene — it is the golden-path bug.
 */
function completeNodes() {
  return {
    e1: makeNode('e1', 'Player', ['PhysicsEnabled']),
    e2: makeNode('e2', 'MainCamera'),
    e3: makeNode('e3', 'DirectionalLight'),
    e4: makeNode('e4', 'Ground'),
    goal: makeNode('goal', 'GoalFlag'),
  };
}

const player: GameComponentData = {
  type: 'characterController',
  characterController: { speed: 5, jumpHeight: 2, gravityScale: 1, canDoubleJump: false },
};

const collectible: GameComponentData = {
  type: 'collectible',
  collectible: {
    value: 1,
    destroyOnCollect: true,
    pickupSoundAsset: null,
    rotateSpeed: 90,
  },
};

function winCondition(
  conditionType: string,
  targetScore: number | null = null,
  targetEntityId: string | null = null,
): GameComponentData {
  return {
    type: 'winCondition',
    winCondition: { conditionType, targetScore, targetEntityId },
  } as unknown as GameComponentData;
}

/** A scene that the real validator agrees is winnable. */
type SceneNodes = Record<string, ReturnType<typeof makeNode>>;

function winnableStore(nodes: SceneNodes = completeNodes()) {
  return {
    sceneGraph: { nodes, rootIds: Object.keys(nodes) },
    allGameComponents: {
      e1: [player],
      goal: [winCondition('reachGoal', null, 'goal')],
    },
  };
}

type VerifyOutput = {
  warnings: string[];
  issues: string[];
  passed: boolean;
  entityCount: number;
  winnable: boolean;
  winnabilityIssues: string[];
};

function outputOf(result: { output?: Record<string, unknown> }): VerifyOutput {
  return result.output as unknown as VerifyOutput;
}

describe('verifyExecutor', () => {
  it('has correct metadata', () => {
    expect(verifyExecutor.name).toBe('verify_all_scenes');
    expect(verifyExecutor.userFacingErrorMessage).toBeDefined();
  });

  // The old value of this field was
  // 'Verification found issues, but your game is still playable.' — an
  // unconditional playability claim on the one code path where verification
  // could not even run. Pinned so it cannot come back.
  it('never claims the game is playable in its generic error message', () => {
    expect(verifyExecutor.userFacingErrorMessage).toBe(
      'Verification could not confirm your game is playable.',
    );
    expect(verifyExecutor.userFacingErrorMessage).not.toMatch(/still playable/i);
  });

  describe('winnability (the real validator)', () => {
    it('succeeds and says so when the scene is genuinely winnable', async () => {
      const ctx = makeCtx({ store: winnableStore() });

      const result = await verifyExecutor.execute({}, ctx);

      expect(result.success).toBe(true);
      const output = outputOf(result);
      expect(output.winnable).toBe(true);
      expect(output.winnabilityIssues).toEqual([]);
      expect(output.passed).toBe(true);
      expect(output.warnings).toEqual([]);
      expect(output.issues).toEqual([]);
    });

    it('fails with the exact user-facing message when no win condition exists', async () => {
      const nodes = completeNodes();
      const ctx = makeCtx({
        store: {
          sceneGraph: { nodes, rootIds: Object.keys(nodes) },
          allGameComponents: { e1: [player] },
        },
      });

      const result = await verifyExecutor.execute({}, ctx);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NOT_WINNABLE');
      expect(result.error?.retryable).toBe(false);
      // Exact string. The validator owns the sentence inside the bullet; the
      // executor owns the frame and the [CODE] prefix.
      expect(result.error?.userFacingMessage).toBe(
        [
          "This game can't be won yet, so the Play button will refuse it:",
          '• [NO_WIN_CONDITION] This scene has no win condition, so the game can never be won. Add a Win Condition component — for example "reach goal" tied to a goal entity, or "collect all" with collectible items.',
          'Add or repair a win condition, then build again.',
        ].join('\n'),
      );
      expect(outputOf(result).winnable).toBe(false);
      expect(outputOf(result).winnabilityIssues).toEqual(['NO_WIN_CONDITION']);
    });

    it.each([
      [
        'NO_COLLECTIBLES',
        { e1: [player], wc: [winCondition('collectAll')] },
      ],
      [
        'NO_PLAYER',
        { c1: [collectible], wc: [winCondition('collectAll')] },
      ],
      [
        'GOAL_TARGET_MISSING',
        { e1: [player], wc: [winCondition('reachGoal', null, 'deleted-entity')] },
      ],
      [
        'INVALID_TARGET_SCORE',
        { e1: [player], wc: [winCondition('score', 0)] },
      ],
      [
        'UNKNOWN_WIN_CONDITION',
        { e1: [player], wc: [winCondition('survive-for-60s')] },
      ],
    ])('fails carrying the %s code', async (code, allGameComponents) => {
      const nodes = completeNodes();
      const ctx = makeCtx({
        store: { sceneGraph: { nodes, rootIds: Object.keys(nodes) }, allGameComponents },
      });

      const result = await verifyExecutor.execute({}, ctx);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NOT_WINNABLE');
      expect(outputOf(result).winnabilityIssues).toContain(code);
      // The code is in the message the user reads, not only in metadata.
      expect(result.error?.userFacingMessage).toContain(`[${code}]`);
    });

    // PF-1125: a message computed and then discarded is not a message. The
    // failure path is the one that matters here — `onStepComplete` fires for a
    // failed step too, and `collectStepWarnings` reads `result.output`, which
    // `failResult()` alone would leave undefined.
    it('surfaces the unwinnable explanation through collectStepWarnings', async () => {
      const nodes = completeNodes();
      const ctx = makeCtx({
        store: {
          sceneGraph: { nodes, rootIds: Object.keys(nodes) },
          allGameComponents: { e1: [player] },
        },
      });

      const result = await verifyExecutor.execute({}, ctx);

      const surfaced = collectStepWarnings(result.output);
      expect(surfaced).toContain(result.error?.userFacingMessage);
    });

    it('still reports the cosmetic findings when it fails on winnability', async () => {
      const ctx = makeCtx({
        projectType: '3d',
        store: {
          sceneGraph: {
            nodes: { e1: makeNode('e1', 'Player') },
            rootIds: ['e1'],
          },
          allGameComponents: {},
        },
      });

      const result = await verifyExecutor.execute({}, ctx);

      expect(result.success).toBe(false);
      const output = outputOf(result);
      expect(output.issues).toContain('no_camera_on_player');
      expect(output.issues).toContain('no_ambient_light');
      expect(output.issues).toContain('no_ground_plane');
      expect(output.entityCount).toBe(1);
      expect(output.passed).toBe(false);
    });

    it('is not fooled by a prototype-chain entity id', async () => {
      const nodes = completeNodes();
      const ctx = makeCtx({
        store: {
          sceneGraph: { nodes, rootIds: Object.keys(nodes) },
          allGameComponents: {
            e1: [player],
            wc: [winCondition('reachGoal', null, 'constructor')],
          },
        },
      });

      const result = await verifyExecutor.execute({}, ctx);

      // `nodes.constructor` is truthy off Object.prototype. If this ever goes
      // green as "winnable", the validator has regressed to a bare index.
      expect(result.success).toBe(false);
      expect(outputOf(result).winnabilityIssues).toContain('GOAL_TARGET_MISSING');
    });
  });

  describe('cosmetic checks', () => {
    // CORRECTION (was: `expect(result.success).toBe(true)`). An empty scene has
    // no win condition, so it is definitively unwinnable — asserting success
    // here was asserting the exact claim this executor had no evidence for.
    it('reports empty scene', async () => {
      const ctx = makeCtx();
      const result = await verifyExecutor.execute({}, ctx);

      expect(result.success).toBe(false);
      const output = outputOf(result);
      expect(output.warnings).toContain('Scene has no entities');
      expect(output.issues).toContain('empty_scene');
      expect(output.entityCount).toBe(0);
      expect(output.passed).toBe(false);
    });

    // CORRECTION (was: a scene with camera+light+ground and NO game components
    // asserted `passed === true`). "Passed" now requires winnability, so the
    // fixture gained the player and win condition that make the claim true.
    it('passes when scene has camera, light, ground — and is winnable', async () => {
      const ctx = makeCtx({ store: winnableStore() });

      const result = await verifyExecutor.execute({}, ctx);

      expect(result.success).toBe(true);
      const output = outputOf(result);
      expect(output.passed).toBe(true);
      expect(output.warnings).toHaveLength(0);
      expect(output.issues).toHaveLength(0);
    });

    it('detects missing camera', async () => {
      const nodes = {
        e1: makeNode('e1', 'Player'),
        e2: makeNode('e2', 'AmbientLight'),
        e3: makeNode('e3', 'Ground'),
        goal: makeNode('goal', 'GoalFlag'),
      };
      const ctx = makeCtx({ store: winnableStore(nodes) });

      const result = await verifyExecutor.execute({}, ctx);

      expect(outputOf(result).issues).toContain('no_camera_on_player');
    });

    it('detects missing light', async () => {
      const nodes = {
        e1: makeNode('e1', 'Player'),
        e2: makeNode('e2', 'Camera'),
        e3: makeNode('e3', 'Ground'),
        goal: makeNode('goal', 'GoalFlag'),
      };
      const ctx = makeCtx({ store: winnableStore(nodes) });

      const result = await verifyExecutor.execute({}, ctx);

      expect(outputOf(result).issues).toContain('no_ambient_light');
    });

    it('detects missing ground plane in 3D projects', async () => {
      const nodes = {
        e1: makeNode('e1', 'Player'),
        e2: makeNode('e2', 'Camera'),
        e3: makeNode('e3', 'SunLight'),
        goal: makeNode('goal', 'GoalFlag'),
      };
      const ctx = makeCtx({ projectType: '3d', store: winnableStore(nodes) });

      const result = await verifyExecutor.execute({}, ctx);

      expect(outputOf(result).issues).toContain('no_ground_plane');
    });

    it('does not check ground plane for 2D projects', async () => {
      const nodes = {
        e1: makeNode('e1', 'Player'),
        e2: makeNode('e2', 'Camera'),
        e3: makeNode('e3', 'AmbientLight'),
        goal: makeNode('goal', 'GoalFlag'),
      };
      const ctx = makeCtx({ projectType: '2d', store: winnableStore(nodes) });

      const result = await verifyExecutor.execute({}, ctx);

      expect(outputOf(result).issues).not.toContain('no_ground_plane');
    });

    it('recognizes camera naming variants', async () => {
      for (const name of ['Camera', 'camera', 'MainCamera', 'player_cam']) {
        const nodes = {
          e1: makeNode('e1', name),
          e2: makeNode('e2', 'SunLight'),
          e3: makeNode('e3', 'Ground'),
          goal: makeNode('goal', 'GoalFlag'),
        };
        const ctx = makeCtx({ store: winnableStore(nodes) });

        const result = await verifyExecutor.execute({}, ctx);
        expect(outputOf(result).issues).not.toContain('no_camera_on_player');
      }
    });

    it('recognizes light naming variants', async () => {
      for (const name of ['DirectionalLight', 'ambient', 'Sun', 'sunlight']) {
        const nodes = {
          e1: makeNode('e1', 'Camera'),
          e2: makeNode('e2', name),
          e3: makeNode('e3', 'Ground'),
          goal: makeNode('goal', 'GoalFlag'),
        };
        const ctx = makeCtx({ store: winnableStore(nodes) });

        const result = await verifyExecutor.execute({}, ctx);
        expect(outputOf(result).issues).not.toContain('no_ambient_light');
      }
    });

    it('recognizes ground naming variants', async () => {
      for (const name of ['Ground', 'floor', 'Plane', 'background_ground']) {
        const nodes = {
          e1: makeNode('e1', 'Camera'),
          e2: makeNode('e2', 'Light'),
          e3: makeNode('e3', name),
          goal: makeNode('goal', 'GoalFlag'),
        };
        const ctx = makeCtx({ projectType: '3d', store: winnableStore(nodes) });

        const result = await verifyExecutor.execute({}, ctx);
        expect(outputOf(result).issues).not.toContain('no_ground_plane');
      }
    });

    it('returns entity count', async () => {
      const nodes = {
        e1: makeNode('e1', 'Camera'),
        e2: makeNode('e2', 'Light'),
        e3: makeNode('e3', 'Ground'),
        e4: makeNode('e4', 'Enemy'),
        e5: makeNode('e5', 'Coin'),
        goal: makeNode('goal', 'GoalFlag'),
      };
      const ctx = makeCtx({ store: winnableStore(nodes) });

      const result = await verifyExecutor.execute({}, ctx);
      expect(outputOf(result).entityCount).toBe(6);
    });
  });

  /**
   * PF-1214, review finding #2. `manage_character_controller_lifecycle` only
   * attaches Rapier's controller to entities that already carry a `Collider`,
   * and colliders come from `manage_physics_lifecycle`, which queries
   * `With<PhysicsEnabled>`. A character without it is never CONSIDERED — no
   * error, no rejected command, no CHARACTER_GROUNDED_CHANGED — and keeps the
   * raw-translation path, walking through walls in a scene that verified clean.
   */
  describe('check 4: a character that will never get a controller', () => {
    function strandedStore() {
      const nodes = completeNodes();
      // The one difference from a winnable scene: no PhysicsEnabled on the player.
      nodes.e1 = makeNode('e1', 'Player');
      return {
        sceneGraph: { nodes, rootIds: Object.keys(nodes) },
        allGameComponents: {
          e1: [player],
          goal: [winCondition('reachGoal', null, 'goal')],
        },
      };
    }

    it('warns, by name, about a character with physics off', async () => {
      const result = await verifyExecutor.execute({}, makeCtx({ store: strandedStore() }));

      const output = outputOf(result);
      expect(output.issues).toContain('character_without_collider');
      // On `warnings`, not `issues` alone: `collectStepWarnings` reads warnings,
      // so a finding recorded only as an issue is one the user never sees
      // (PF-1125). Checks 3 and 5 have that shape; this one must not.
      expect(output.warnings).toHaveLength(1);
      // The same sentence the play-time toast raises, so the build-time and
      // play-time descriptions of one condition cannot drift apart.
      expect(output.warnings[0]).toBe(
        'Player has no physics, so it falls through the floor and walks through walls. ' +
          'Select it and tick Physics > Enabled in the Inspector, then press Play again.',
      );
      expect(output.passed).toBe(false);
      // Still a winnable scene, so the step itself succeeds — this is a warning
      // about how the game will FEEL, not a reason to refuse the build.
      expect(result.success).toBe(true);
    });

    it('surfaces that warning through collectStepWarnings', async () => {
      const result = await verifyExecutor.execute({}, makeCtx({ store: strandedStore() }));

      expect(collectStepWarnings(result.output)).toEqual([
        expect.stringContaining('Player has no physics'),
      ]);
    });

    it('stays quiet when the character has physics enabled', async () => {
      const result = await verifyExecutor.execute({}, makeCtx({ store: winnableStore() }));

      expect(outputOf(result).issues).not.toContain('character_without_collider');
      expect(outputOf(result).warnings).toEqual([]);
    });

    it('ignores an entity with no character controller', async () => {
      // A crate with physics off is just a crate: nothing tries to drive it.
      const nodes = completeNodes();
      nodes.e4 = makeNode('e4', 'Ground');
      const result = await verifyExecutor.execute(
        {},
        makeCtx({
          store: {
            sceneGraph: { nodes, rootIds: Object.keys(nodes) },
            allGameComponents: {
              e1: [player],
              e4: [collectible],
              goal: [winCondition('reachGoal', null, 'goal')],
            },
          },
        }),
      );

      expect(outputOf(result).issues).not.toContain('character_without_collider');
    });

    it('says nothing for a 2D project', async () => {
      // 2D keeps the legacy path by design; the engine never records a 2D
      // character as skipped, so neither may verification.
      const result = await verifyExecutor.execute(
        {},
        makeCtx({ store: strandedStore(), projectType: '2d' }),
      );

      expect(outputOf(result).issues).not.toContain('character_without_collider');
    });

    it('names every stranded character and agrees with itself in the plural', async () => {
      const nodes = {
        ...completeNodes(),
        e1: makeNode('e1', 'Player'),
        e5: makeNode('e5', 'Rival'),
      };
      const result = await verifyExecutor.execute(
        {},
        makeCtx({
          store: {
            sceneGraph: { nodes, rootIds: Object.keys(nodes) },
            allGameComponents: {
              e1: [player],
              e5: [player],
              goal: [winCondition('reachGoal', null, 'goal')],
            },
          },
        }),
      );

      expect(outputOf(result).warnings[0]).toContain('Player and Rival have no physics');
      expect(outputOf(result).warnings[0]).toContain(
        'Select each one and tick Physics > Enabled in the Inspector, then press Play again.',
      );
    });

    it('does not read a component list off the prototype chain', async () => {
      // `allGameComponents` is keyed by ids that arrive straight off the engine
      // wire, so a bare read for an entity named `constructor` resolves an
      // inherited function, and `.some` on a function throws inside
      // verification. Measured: this pins the PAIR of guards (`Object.hasOwn`
      // plus the `Array.isArray` line) — removing either one alone still passes,
      // removing both turns this red.
      const nodes = { constructor: makeNode('constructor', 'Odd'), ...completeNodes() };
      const result = await verifyExecutor.execute(
        {},
        makeCtx({
          store: {
            sceneGraph: { nodes, rootIds: Object.keys(nodes) },
            allGameComponents: {
              e1: [player],
              goal: [winCondition('reachGoal', null, 'goal')],
            },
          },
        }),
      );

      expect(result.success).toBe(true);
      expect(outputOf(result).issues).not.toContain('character_without_collider');
    });
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
