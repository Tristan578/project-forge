import { describe, it, expect } from 'vitest';
import {
  BOT_STRATEGIES,
  simulatePlaytest,
  generatePlaytestReport,
  type SceneContext,
  type PlaytestSession,
  type BotStrategy,
} from '../gameplayBot';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEmptyScene(): SceneContext {
  return {
    sceneGraph: { nodes: {}, rootIds: [] },
    projectType: '3d',
  };
}

function makeMinimalScene(): SceneContext {
  return {
    sceneGraph: {
      nodes: {
        'e-1': { entityId: 'e-1', name: 'Player', parentId: null, children: [], components: ['Mesh3d'], visible: true },
        'e-2': { entityId: 'e-2', name: 'Ground', parentId: null, children: [], components: ['Mesh3d', 'TerrainEnabled'], visible: true },
        'e-3': { entityId: 'e-3', name: 'Light', parentId: null, children: [], components: ['DirectionalLight'], visible: true },
      },
      rootIds: ['e-1', 'e-2', 'e-3'],
    },
    gameComponents: {
      'e-1': [{ type: 'characterController', speed: 5 }],
    },
    physicsEntities: {
      'e-1': { bodyType: 'dynamic', colliderShape: 'capsule' },
      'e-2': { bodyType: 'fixed', colliderShape: 'trimesh' },
    },
    projectType: '3d',
  };
}

function makeComplexScene(): SceneContext {
  return {
    sceneGraph: {
      nodes: {
        'player': { entityId: 'player', name: 'Player', parentId: null, children: [], components: ['Mesh3d'], visible: true },
        'ground': { entityId: 'ground', name: 'Ground', parentId: null, children: [], components: ['Mesh3d', 'TerrainEnabled'], visible: true },
        'spike-1': { entityId: 'spike-1', name: 'Spike 1', parentId: null, children: [], components: ['Mesh3d'], visible: true },
        'spike-2': { entityId: 'spike-2', name: 'Spike 2', parentId: null, children: [], components: ['Mesh3d'], visible: true },
        'spike-3': { entityId: 'spike-3', name: 'Spike 3', parentId: null, children: [], components: ['Mesh3d'], visible: true },
        'spike-4': { entityId: 'spike-4', name: 'Spike 4', parentId: null, children: [], components: ['Mesh3d'], visible: true },
        'coin-1': { entityId: 'coin-1', name: 'Coin 1', parentId: null, children: [], components: ['Mesh3d'], visible: true },
        'coin-2': { entityId: 'coin-2', name: 'Coin 2', parentId: null, children: [], components: ['Mesh3d'], visible: true },
        'goal': { entityId: 'goal', name: 'Goal', parentId: null, children: [], components: ['Mesh3d'], visible: true },
        'teleporter': { entityId: 'teleporter', name: 'Teleporter A', parentId: null, children: [], components: ['Mesh3d'], visible: true },
      },
      rootIds: ['player', 'ground', 'spike-1', 'spike-2', 'spike-3', 'spike-4', 'coin-1', 'coin-2', 'goal', 'teleporter'],
    },
    gameComponents: {
      'player': [{ type: 'characterController', speed: 5 }, { type: 'health', maxHealth: 100 }],
      'spike-1': [{ type: 'damageZone', damage: 25 }],
      'spike-2': [{ type: 'damageZone', damage: 25 }],
      'spike-3': [{ type: 'damageZone', damage: 25 }],
      'spike-4': [{ type: 'damageZone', damage: 25 }],
      'coin-1': [{ type: 'collectible', value: 10 }],
      'coin-2': [{ type: 'collectible', value: 10 }],
      'goal': [{ type: 'winCondition' }],
      'teleporter': [{ type: 'teleporter', targetScene: 'level2' }],
    },
    physicsEntities: {
      'player': { bodyType: 'dynamic', colliderShape: 'capsule' },
      'ground': { bodyType: 'fixed', colliderShape: 'trimesh' },
      'spike-1': { bodyType: 'fixed', colliderShape: 'box', isSensor: true },
      'spike-2': { bodyType: 'fixed', colliderShape: 'box', isSensor: true },
      'spike-3': { bodyType: 'fixed', colliderShape: 'box', isSensor: true },
      'spike-4': { bodyType: 'fixed', colliderShape: 'box', isSensor: true },
    },
    projectType: '3d',
  };
}

// ---------------------------------------------------------------------------
// Strategy configs
// ---------------------------------------------------------------------------

describe('BOT_STRATEGIES', () => {
  const allStrategies: BotStrategy[] = ['explorer', 'speedrunner', 'completionist', 'random', 'cautious'];

  it('should define configs for all 5 strategies', () => {
    expect(Object.keys(BOT_STRATEGIES)).toHaveLength(5);
    for (const s of allStrategies) {
      expect(BOT_STRATEGIES[s]).toBeDefined();
    }
  });

  it.each(allStrategies)('strategy "%s" has a name and description', (strategy) => {
    const config = BOT_STRATEGIES[strategy];
    expect(config.name).toBeTruthy();
    expect(config.description.length).toBeGreaterThan(10);
  });

  it.each(allStrategies)('strategy "%s" has bias values in [0,1]', (strategy) => {
    const config = BOT_STRATEGIES[strategy];
    const fields = [
      config.explorationBias,
      config.riskTolerance,
      config.completionFocus,
      config.actionVariety,
      config.backtrackWillingness,
    ];
    for (const val of fields) {
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(1);
    }
  });

  it('explorer has the highest exploration bias', () => {
    const maxExploration = Math.max(...Object.values(BOT_STRATEGIES).map((c) => c.explorationBias));
    expect(BOT_STRATEGIES.explorer.explorationBias).toBe(maxExploration);
  });

  it('speedrunner has the highest completion focus', () => {
    const maxCompletion = Math.max(...Object.values(BOT_STRATEGIES).map((c) => c.completionFocus));
    expect(BOT_STRATEGIES.speedrunner.completionFocus).toBe(maxCompletion);
  });

  it('random has the highest action variety', () => {
    const maxVariety = Math.max(...Object.values(BOT_STRATEGIES).map((c) => c.actionVariety));
    expect(BOT_STRATEGIES.random.actionVariety).toBe(maxVariety);
  });

  it('cautious has the lowest risk tolerance', () => {
    const minRisk = Math.min(...Object.values(BOT_STRATEGIES).map((c) => c.riskTolerance));
    expect(BOT_STRATEGIES.cautious.riskTolerance).toBe(minRisk);
  });
});

// ---------------------------------------------------------------------------
// simulatePlaytest
// ---------------------------------------------------------------------------

describe('simulatePlaytest', () => {
  it('should handle an empty scene', async () => {
    const session = await simulatePlaytest(makeEmptyScene(), 'explorer');
    expect(session.strategy).toBe('explorer');
    expect(session.discoveries.length).toBeGreaterThan(0);
    expect(session.discoveries.some((d) => d.type === 'empty_area')).toBe(true);
    expect(session.outcome).not.toBe('completed');
  });

  it('should return a valid PlaytestSession for a minimal scene', async () => {
    const session = await simulatePlaytest(makeMinimalScene(), 'explorer');
    expect(session.strategy).toBe('explorer');
    expect(session.actions.length).toBeGreaterThan(0);
    expect(session.duration).toBeGreaterThan(0);
    expect(['completed', 'stuck', 'died', 'timeout']).toContain(session.outcome);
    expect(session.metrics).toHaveProperty('timeToComplete');
    expect(session.metrics).toHaveProperty('deathCount');
    expect(session.metrics).toHaveProperty('itemsCollected');
    expect(session.metrics).toHaveProperty('areasExplored');
    expect(session.metrics).toHaveProperty('backtrackCount');
  });

  it('should produce different results per strategy', async () => {
    const ctx = makeComplexScene();
    const explorer = await simulatePlaytest(ctx, 'explorer');
    const speedrunner = await simulatePlaytest(ctx, 'speedrunner');
    const random = await simulatePlaytest(ctx, 'random');

    // Different strategies should produce different action sequences
    expect(explorer.actions).not.toEqual(speedrunner.actions);
    expect(explorer.actions).not.toEqual(random.actions);
  });

  it('should detect missing character controller', async () => {
    const ctx = makeMinimalScene();
    ctx.gameComponents = {}; // Remove all game components
    const session = await simulatePlaytest(ctx, 'explorer');
    expect(session.discoveries.some((d) =>
      d.type === 'missing_feedback' && d.description.includes('character controller')
    )).toBe(true);
  });

  it('should detect damage zones without health components', async () => {
    const ctx = makeMinimalScene();
    ctx.gameComponents = {
      'e-1': [{ type: 'characterController', speed: 5 }],
      'e-2': [{ type: 'damageZone', damage: 50 }],
    };
    const session = await simulatePlaytest(ctx, 'explorer');
    expect(session.discoveries.some((d) => d.type === 'difficulty_spike')).toBe(true);
  });

  it('should detect single teleporter soft-lock', async () => {
    const ctx = makeMinimalScene();
    ctx.gameComponents = {
      'e-1': [{ type: 'characterController' }, { type: 'teleporter', target: 'level2' }],
    };
    const session = await simulatePlaytest(ctx, 'explorer');
    expect(session.discoveries.some((d) => d.type === 'soft_lock')).toBe(true);
  });

  it('should produce actions with valid timestamps', async () => {
    const session = await simulatePlaytest(makeMinimalScene(), 'random');
    for (let i = 1; i < session.actions.length; i++) {
      expect(session.actions[i].timestamp).toBeGreaterThanOrEqual(session.actions[i - 1].timestamp);
    }
  });

  it('should produce actions with valid types', async () => {
    const validTypes = ['move', 'jump', 'interact', 'attack', 'wait', 'use_item'];
    const session = await simulatePlaytest(makeComplexScene(), 'random');
    for (const action of session.actions) {
      expect(validTypes).toContain(action.type);
    }
  });

  it('should assign direction to move/jump actions', async () => {
    const session = await simulatePlaytest(makeComplexScene(), 'explorer');
    const moveOrJump = session.actions.filter((a) => a.type === 'move' || a.type === 'jump');
    for (const action of moveOrJump) {
      expect(action.direction).toBeDefined();
      expect(action.direction!.x).toBeGreaterThanOrEqual(-1);
      expect(action.direction!.x).toBeLessThanOrEqual(1);
    }
  });

  it('should have non-negative metrics', async () => {
    const session = await simulatePlaytest(makeComplexScene(), 'completionist');
    expect(session.metrics.timeToComplete).toBeGreaterThanOrEqual(0);
    expect(session.metrics.deathCount).toBeGreaterThanOrEqual(0);
    expect(session.metrics.itemsCollected).toBeGreaterThanOrEqual(0);
    expect(session.metrics.areasExplored).toBeGreaterThanOrEqual(0);
    expect(session.metrics.backtrackCount).toBeGreaterThanOrEqual(0);
  });

  it('completionist should collect more items than speedrunner', async () => {
    const ctx = makeComplexScene();
    const comp = await simulatePlaytest(ctx, 'completionist');
    const speed = await simulatePlaytest(ctx, 'speedrunner');
    expect(comp.metrics.itemsCollected).toBeGreaterThanOrEqual(speed.metrics.itemsCollected);
  });
});

// ---------------------------------------------------------------------------
// Session outcome classification
// ---------------------------------------------------------------------------

describe('outcome classification', () => {
  it('classifies empty scene as non-completed', async () => {
    const session = await simulatePlaytest(makeEmptyScene(), 'explorer');
    expect(session.outcome).not.toBe('completed');
  });

  it('classifies well-built scene as completed for explorer', async () => {
    const ctx = makeComplexScene();
    const session = await simulatePlaytest(ctx, 'explorer');
    // Complex scene has character controller and win condition, should complete
    expect(session.outcome).toBe('completed');
  });

  it('cautious bot can get stuck with many hazards', async () => {
    const ctx = makeComplexScene();
    // Scene already has 4 damage zones and no checkpoints — cautious bot is sensitive
    const session = await simulatePlaytest(ctx, 'cautious');
    // Should still complete because the scene is well-structured
    expect(['completed', 'stuck', 'timeout']).toContain(session.outcome);
  });
});

// ---------------------------------------------------------------------------
// Discovery severity ranking
// ---------------------------------------------------------------------------

describe('discovery severity', () => {
  it('empty scene produces a critical discovery', async () => {
    const session = await simulatePlaytest(makeEmptyScene(), 'explorer');
    expect(session.discoveries.some((d) => d.severity === 'critical')).toBe(true);
  });

  it('no character controller is critical', async () => {
    const ctx: SceneContext = {
      sceneGraph: {
        nodes: {
          'e-1': { entityId: 'e-1', name: 'Box', parentId: null, children: [], components: ['Mesh3d'], visible: true },
        },
        rootIds: ['e-1'],
      },
      gameComponents: {},
    };
    const session = await simulatePlaytest(ctx, 'explorer');
    const noController = session.discoveries.find(
      (d) => d.type === 'missing_feedback' && d.description.includes('character controller'),
    );
    expect(noController).toBeDefined();
    expect(noController!.severity).toBe('critical');
  });

  it('discoveries have valid severity levels', async () => {
    const session = await simulatePlaytest(makeComplexScene(), 'random');
    for (const d of session.discoveries) {
      expect(['critical', 'major', 'minor']).toContain(d.severity);
    }
  });
});

// ---------------------------------------------------------------------------
// generatePlaytestReport
// ---------------------------------------------------------------------------

describe('generatePlaytestReport', () => {
  it('should aggregate multiple sessions', async () => {
    const ctx = makeComplexScene();
    const sessions: PlaytestSession[] = [];
    const strategies: BotStrategy[] = ['explorer', 'speedrunner', 'completionist', 'random', 'cautious'];
    for (const s of strategies) {
      sessions.push(await simulatePlaytest(ctx, s));
    }
    const report = generatePlaytestReport(sessions);

    expect(report.sessions).toHaveLength(5);
    expect(report.totalDiscoveries).toBeGreaterThanOrEqual(0);
    expect(report.criticalCount + report.majorCount + report.minorCount).toBe(report.totalDiscoveries);
    expect(Object.keys(report.strategyComparison)).toHaveLength(5);
    expect(['excellent', 'good', 'needs_work', 'critical_issues']).toContain(report.overallRating);
  });

  it('should deduplicate discoveries across sessions', async () => {
    const ctx = makeEmptyScene();
    const s1 = await simulatePlaytest(ctx, 'explorer');
    const s2 = await simulatePlaytest(ctx, 'speedrunner');
    const report = generatePlaytestReport([s1, s2]);

    // Both sessions find "empty scene" — report should deduplicate
    const emptyAreaDiscoveries = report.uniqueDiscoveries.filter(
      (d) => d.type === 'empty_area',
    );
    expect(emptyAreaDiscoveries).toHaveLength(1);
  });

  it('should rate scene with critical issues as critical_issues', async () => {
    const session = await simulatePlaytest(makeEmptyScene(), 'explorer');
    const report = generatePlaytestReport([session]);
    expect(report.overallRating).toBe('critical_issues');
  });

  it('should rate a well-built scene as excellent or good', async () => {
    const ctx = makeComplexScene();
    const session = await simulatePlaytest(ctx, 'explorer');
    const report = generatePlaytestReport([session]);
    expect(['excellent', 'good']).toContain(report.overallRating);
  });

  it('should handle an empty sessions array', () => {
    const report = generatePlaytestReport([]);
    expect(report.sessions).toHaveLength(0);
    expect(report.totalDiscoveries).toBe(0);
    expect(report.overallRating).toBe('excellent');
  });

  it('strategy comparison contains metrics for each session', async () => {
    const ctx = makeMinimalScene();
    const s1 = await simulatePlaytest(ctx, 'explorer');
    const s2 = await simulatePlaytest(ctx, 'cautious');
    const report = generatePlaytestReport([s1, s2]);

    expect(report.strategyComparison.explorer).toBeDefined();
    expect(report.strategyComparison.cautious).toBeDefined();
    expect(report.strategyComparison.explorer.timeToComplete).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('handles scene with only lights', async () => {
    const ctx: SceneContext = {
      sceneGraph: {
        nodes: {
          'l1': { entityId: 'l1', name: 'Sun', parentId: null, children: [], components: ['DirectionalLight'], visible: true },
          'l2': { entityId: 'l2', name: 'Lamp', parentId: null, children: [], components: ['PointLight'], visible: true },
        },
        rootIds: ['l1', 'l2'],
      },
    };
    const session = await simulatePlaytest(ctx, 'explorer');
    expect(session.discoveries.length).toBeGreaterThan(0);
    // No character controller → critical
    expect(session.discoveries.some((d) => d.severity === 'critical')).toBe(true);
  });

  it('handles 2d project type', async () => {
    const ctx: SceneContext = {
      sceneGraph: {
        nodes: {
          's1': { entityId: 's1', name: 'Sprite', parentId: null, children: [], components: ['Sprite2d'], visible: true },
        },
        rootIds: ['s1'],
      },
      projectType: '2d',
    };
    const session = await simulatePlaytest(ctx, 'explorer');
    expect(session.strategy).toBe('explorer');
    expect(session.actions.length).toBeGreaterThan(0);
  });

  it('deterministic: same input produces same output', async () => {
    const ctx = makeComplexScene();
    const a = await simulatePlaytest(ctx, 'random');
    const b = await simulatePlaytest(ctx, 'random');
    expect(a.actions).toEqual(b.actions);
    expect(a.discoveries).toEqual(b.discoveries);
    expect(a.metrics).toEqual(b.metrics);
  });

  it('handles scene with children (nested hierarchy)', async () => {
    const ctx: SceneContext = {
      sceneGraph: {
        nodes: {
          'parent': { entityId: 'parent', name: 'Platform', parentId: null, children: ['child'], components: ['Mesh3d'], visible: true },
          'child': { entityId: 'child', name: 'Decoration', parentId: 'parent', children: [], components: ['Mesh3d'], visible: true },
        },
        rootIds: ['parent'],
      },
      gameComponents: {
        'parent': [{ type: 'characterController' }],
      },
      physicsEntities: {
        'parent': { bodyType: 'dynamic', colliderShape: 'capsule' },
      },
    };
    const session = await simulatePlaytest(ctx, 'explorer');
    // Child entity has a parent so should NOT be flagged as unreachable
    const childFlagged = session.discoveries.some(
      (d) => d.location === 'Decoration' && d.type === 'unreachable_area',
    );
    expect(childFlagged).toBe(false);
  });
});
