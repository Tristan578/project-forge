/**
 * AI Gameplay Bot — automated playtesting and balance verification.
 *
 * Analyses a scene's entity graph, game components, physics, and scripts to
 * simulate a playthrough under one of five behaviour strategies. Produces a
 * structured PlaytestSession with discoveries (unreachable areas, soft-locks,
 * difficulty spikes, etc.) and aggregate metrics.
 *
 * The bot does NOT actually run the WASM engine — it performs static/heuristic
 * analysis of the scene graph plus game-component metadata to infer issues.
 */

import type { SceneGraph, SceneNode } from '@/stores/slices/types';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type BotStrategy =
  | 'explorer'
  | 'speedrunner'
  | 'completionist'
  | 'random'
  | 'cautious';

export interface BotAction {
  type: 'move' | 'jump' | 'interact' | 'attack' | 'wait' | 'use_item';
  target?: string;
  direction?: { x: number; y: number };
  timestamp: number;
}

export interface BotDiscovery {
  type:
    | 'unreachable_area'
    | 'impossible_jump'
    | 'soft_lock'
    | 'exploit'
    | 'difficulty_spike'
    | 'empty_area'
    | 'missing_feedback';
  location: string;
  description: string;
  severity: 'critical' | 'major' | 'minor';
}

export interface PlaytestMetrics {
  timeToComplete: number;
  deathCount: number;
  itemsCollected: number;
  areasExplored: number;
  backtrackCount: number;
}

export type SessionOutcome = 'completed' | 'stuck' | 'died' | 'timeout';

export interface PlaytestSession {
  strategy: BotStrategy;
  actions: BotAction[];
  duration: number;
  outcome: SessionOutcome;
  discoveries: BotDiscovery[];
  metrics: PlaytestMetrics;
}

export interface PlaytestReport {
  sessions: PlaytestSession[];
  totalDiscoveries: number;
  criticalCount: number;
  majorCount: number;
  minorCount: number;
  uniqueDiscoveries: BotDiscovery[];
  strategyComparison: Record<BotStrategy, PlaytestMetrics>;
  overallRating: 'excellent' | 'good' | 'needs_work' | 'critical_issues';
}

// ---------------------------------------------------------------------------
// Scene context (subset of what buildSceneContext uses)
// ---------------------------------------------------------------------------

export interface SceneContext {
  sceneGraph: SceneGraph;
  gameComponents?: Record<string, GameComponentInfo[]>;
  physicsEntities?: Record<string, PhysicsInfo>;
  scripts?: Record<string, ScriptInfo>;
  projectType?: '2d' | '3d';
}

export interface GameComponentInfo {
  type: string;
  [key: string]: unknown;
}

export interface PhysicsInfo {
  bodyType: string;
  colliderShape: string;
  isSensor?: boolean;
}

export interface ScriptInfo {
  enabled: boolean;
  template?: string;
}

// ---------------------------------------------------------------------------
// Strategy configs
// ---------------------------------------------------------------------------

export interface StrategyConfig {
  name: string;
  description: string;
  explorationBias: number; // 0-1, how much the bot explores
  riskTolerance: number; // 0-1, willingness to enter danger zones
  completionFocus: number; // 0-1, drives towards objectives vs wandering
  actionVariety: number; // 0-1, diversity of action types attempted
  backtrackWillingness: number; // 0-1, willingness to revisit areas
}

export const BOT_STRATEGIES: Record<BotStrategy, StrategyConfig> = {
  explorer: {
    name: 'Explorer',
    description: 'Visits every room and checks every corner. Good for finding hidden areas and unreachable zones.',
    explorationBias: 1.0,
    riskTolerance: 0.5,
    completionFocus: 0.3,
    actionVariety: 0.7,
    backtrackWillingness: 0.9,
  },
  speedrunner: {
    name: 'Speedrunner',
    description: 'Takes the fastest path to the goal. Skips optional content. Good for finding critical path issues.',
    explorationBias: 0.1,
    riskTolerance: 0.8,
    completionFocus: 1.0,
    actionVariety: 0.3,
    backtrackWillingness: 0.1,
  },
  completionist: {
    name: 'Completionist',
    description: 'Collects everything and completes all side objectives. Good for verifying all content is reachable.',
    explorationBias: 0.9,
    riskTolerance: 0.6,
    completionFocus: 0.9,
    actionVariety: 0.8,
    backtrackWillingness: 0.8,
  },
  random: {
    name: 'Random',
    description: 'Performs random actions to fuzz for edge cases. Good for finding exploits and soft-locks.',
    explorationBias: 0.5,
    riskTolerance: 0.5,
    completionFocus: 0.1,
    actionVariety: 1.0,
    backtrackWillingness: 0.5,
  },
  cautious: {
    name: 'Cautious',
    description: 'Avoids danger and takes safe paths. Good for testing if cautious players can still progress.',
    explorationBias: 0.4,
    riskTolerance: 0.1,
    completionFocus: 0.7,
    actionVariety: 0.4,
    backtrackWillingness: 0.6,
  },
};

// ---------------------------------------------------------------------------
// Analysis helpers
// ---------------------------------------------------------------------------

/** Classify an entity by its components. */
function classifyEntity(node: SceneNode): string {
  const c = node.components;
  if (c.includes('TerrainEnabled')) return 'terrain';
  if (c.includes('PointLight') || c.includes('DirectionalLight') || c.includes('SpotLight')) return 'light';
  if (c.includes('Camera')) return 'camera';
  return 'object';
}

/** Identify areas: entities that look like rooms/platforms/zones. */
function identifyAreas(graph: SceneGraph): SceneNode[] {
  return Object.values(graph.nodes).filter((n) => {
    const cls = classifyEntity(n);
    return cls === 'object' || cls === 'terrain';
  });
}

/** Check if a scene has any game-component of a given type. */
function hasComponentType(
  components: Record<string, GameComponentInfo[]> | undefined,
  type: string,
): boolean {
  if (!components) return false;
  return Object.values(components).some((list) =>
    list.some((c) => c.type === type),
  );
}

/** Get all entities with a specific game component type. */
function getEntitiesWithComponent(
  components: Record<string, GameComponentInfo[]> | undefined,
  type: string,
): string[] {
  if (!components) return [];
  return Object.entries(components)
    .filter(([, list]) => list.some((c) => c.type === type))
    .map(([id]) => id);
}

/** Check if an entity has physics. */
function hasPhysics(
  entityId: string,
  physics: Record<string, PhysicsInfo> | undefined,
): boolean {
  if (!physics) return false;
  return entityId in physics;
}

/** Analyse damage zones vs health entities for difficulty assessment. */
function analyseDifficulty(
  ctx: SceneContext,
): { damageZoneCount: number; healthEntityCount: number; checkpointCount: number } {
  const damageZoneCount = getEntitiesWithComponent(ctx.gameComponents, 'damageZone').length;
  const healthEntityCount = getEntitiesWithComponent(ctx.gameComponents, 'health').length;
  const checkpointCount = getEntitiesWithComponent(ctx.gameComponents, 'checkpoint').length;
  return { damageZoneCount, healthEntityCount, checkpointCount };
}

// ---------------------------------------------------------------------------
// Discovery detection
// ---------------------------------------------------------------------------

function detectDiscoveries(ctx: SceneContext, strategy: BotStrategy): BotDiscovery[] {
  const discoveries: BotDiscovery[] = [];
  const areas = identifyAreas(ctx.sceneGraph);
  const nodeCount = Object.keys(ctx.sceneGraph.nodes).length;
  const config = BOT_STRATEGIES[strategy];

  // Empty scene
  if (nodeCount === 0) {
    discoveries.push({
      type: 'empty_area',
      location: 'scene',
      description: 'Scene is completely empty — nothing to playtest.',
      severity: 'critical',
    });
    return discoveries;
  }

  // No game components at all
  if (!ctx.gameComponents || Object.keys(ctx.gameComponents).length === 0) {
    discoveries.push({
      type: 'missing_feedback',
      location: 'scene',
      description: 'No game components found. The scene has no gameplay mechanics.',
      severity: 'major',
    });
  }

  // No character controller
  if (!hasComponentType(ctx.gameComponents, 'characterController')) {
    discoveries.push({
      type: 'missing_feedback',
      location: 'scene',
      description: 'No character controller found. Players cannot move.',
      severity: 'critical',
    });
  }

  // Win condition check (speedrunner/completionist care most)
  if (
    (config.completionFocus > 0.5) &&
    !hasComponentType(ctx.gameComponents, 'winCondition')
  ) {
    discoveries.push({
      type: 'soft_lock',
      location: 'scene',
      description: 'No win condition defined. Players have no goal to complete.',
      severity: 'major',
    });
  }

  // Difficulty analysis
  const diff = analyseDifficulty(ctx);
  if (diff.damageZoneCount > 0 && diff.healthEntityCount === 0) {
    discoveries.push({
      type: 'difficulty_spike',
      location: 'scene',
      description: `${diff.damageZoneCount} damage zone(s) but no entities with health components. Damage zones will have no effect.`,
      severity: 'major',
    });
  }

  if (diff.damageZoneCount > 3 && diff.checkpointCount === 0) {
    discoveries.push({
      type: 'difficulty_spike',
      location: 'scene',
      description: `${diff.damageZoneCount} damage zones with no checkpoints. Players may lose significant progress on death.`,
      severity: 'major',
    });
  }

  // High damage-zone-to-checkpoint ratio (cautious bot is sensitive to this)
  if (config.riskTolerance < 0.3 && diff.damageZoneCount > diff.checkpointCount * 3) {
    discoveries.push({
      type: 'difficulty_spike',
      location: 'scene',
      description: 'Too many hazards relative to checkpoints for cautious players.',
      severity: 'minor',
    });
  }

  // Explorer: check for floating objects (no physics on non-terrain objects)
  if (config.explorationBias > 0.7) {
    for (const area of areas) {
      if (
        classifyEntity(area) === 'object' &&
        !hasPhysics(area.entityId, ctx.physicsEntities) &&
        !hasComponentType(
          ctx.gameComponents ? { [area.entityId]: ctx.gameComponents[area.entityId] ?? [] } : undefined,
          'movingPlatform',
        )
      ) {
        // Only flag if the entity has no parent (root level), as children inherit physics
        if (!area.parentId) {
          discoveries.push({
            type: 'unreachable_area',
            location: area.name,
            description: `"${area.name}" has no physics body and no moving platform — it may be unreachable or non-interactive.`,
            severity: 'minor',
          });
        }
      }
    }
  }

  // Collectibles without character controller
  const collectibles = getEntitiesWithComponent(ctx.gameComponents, 'collectible');
  if (collectibles.length > 0 && !hasComponentType(ctx.gameComponents, 'characterController')) {
    discoveries.push({
      type: 'unreachable_area',
      location: 'scene',
      description: `${collectibles.length} collectible(s) exist but no character controller to collect them.`,
      severity: 'critical',
    });
  }

  // Teleporters: check for paired teleporters
  const teleporters = getEntitiesWithComponent(ctx.gameComponents, 'teleporter');
  if (teleporters.length === 1) {
    discoveries.push({
      type: 'soft_lock',
      location: ctx.sceneGraph.nodes[teleporters[0]]?.name ?? 'unknown',
      description: 'Only one teleporter found. Players may get stuck with a one-way trip.',
      severity: 'major',
    });
  }

  // Spawners without health targets (random bot fuzz)
  if (config.actionVariety > 0.8) {
    const spawners = getEntitiesWithComponent(ctx.gameComponents, 'spawner');
    if (spawners.length > 3 && diff.healthEntityCount === 0) {
      discoveries.push({
        type: 'exploit',
        location: 'scene',
        description: 'Multiple spawners but nothing can take damage. Spawned entities may pile up indefinitely.',
        severity: 'minor',
      });
    }
  }

  return discoveries;
}

// ---------------------------------------------------------------------------
// Action generation
// ---------------------------------------------------------------------------

function generateActions(
  ctx: SceneContext,
  strategy: BotStrategy,
  durationMs: number,
): BotAction[] {
  const config = BOT_STRATEGIES[strategy];
  const actions: BotAction[] = [];
  const areas = identifyAreas(ctx.sceneGraph);
  const actionTypes: BotAction['type'][] = ['move', 'jump', 'interact', 'attack', 'wait', 'use_item'];

  // Deterministic seed based on strategy name for reproducibility
  let seed = 0;
  for (const ch of strategy) seed = (seed * 31 + ch.charCodeAt(0)) | 0;

  const pseudoRandom = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  const stepMs = 500; // One action every 500ms
  const steps = Math.min(Math.floor(durationMs / stepMs), 200); // Cap at 200 actions

  for (let i = 0; i < steps; i++) {
    const t = i * stepMs;
    const r = pseudoRandom();

    // Pick action type biased by strategy
    let actionType: BotAction['type'];
    if (config.completionFocus > 0.7 && r < 0.4) {
      actionType = 'move';
    } else if (config.riskTolerance > 0.6 && r < 0.3) {
      actionType = 'jump';
    } else if (config.actionVariety > 0.8) {
      actionType = actionTypes[Math.floor(pseudoRandom() * actionTypes.length)];
    } else if (config.riskTolerance < 0.3) {
      actionType = r < 0.6 ? 'move' : 'wait';
    } else {
      actionType = r < 0.5 ? 'move' : r < 0.7 ? 'jump' : 'interact';
    }

    const action: BotAction = {
      type: actionType,
      timestamp: t,
    };

    // Assign target for interact/attack
    if ((actionType === 'interact' || actionType === 'attack') && areas.length > 0) {
      const target = areas[Math.floor(pseudoRandom() * areas.length)];
      action.target = target.entityId;
    }

    // Assign direction for move/jump
    if (actionType === 'move' || actionType === 'jump') {
      const angle = pseudoRandom() * Math.PI * 2;
      action.direction = {
        x: Math.round(Math.cos(angle) * 100) / 100,
        y: Math.round(Math.sin(angle) * 100) / 100,
      };
    }

    actions.push(action);
  }

  return actions;
}

// ---------------------------------------------------------------------------
// Outcome classification
// ---------------------------------------------------------------------------

function classifyOutcome(
  discoveries: BotDiscovery[],
  strategy: BotStrategy,
): SessionOutcome {
  const criticals = discoveries.filter((d) => d.severity === 'critical');
  if (criticals.some((d) => d.type === 'soft_lock')) return 'stuck';
  if (criticals.length > 0) return 'died';

  const config = BOT_STRATEGIES[strategy];
  const majors = discoveries.filter((d) => d.severity === 'major');

  // Cautious players get stuck more easily
  if (config.riskTolerance < 0.3 && majors.length > 2) return 'stuck';

  // Speedrunners timeout if no clear path
  if (config.completionFocus > 0.8 && majors.some((d) => d.type === 'soft_lock')) return 'timeout';

  if (majors.length > 3) return 'timeout';

  return 'completed';
}

// ---------------------------------------------------------------------------
// Metrics computation
// ---------------------------------------------------------------------------

function computeMetrics(
  ctx: SceneContext,
  strategy: BotStrategy,
  actions: BotAction[],
  discoveries: BotDiscovery[],
): PlaytestMetrics {
  const config = BOT_STRATEGIES[strategy];
  const areas = identifyAreas(ctx.sceneGraph);
  const diff = analyseDifficulty(ctx);

  const moveActions = actions.filter((a) => a.type === 'move');
  const exploredFraction = Math.min(
    1,
    (moveActions.length * config.explorationBias) / Math.max(areas.length, 1),
  );

  const deathCount =
    diff.damageZoneCount > 0
      ? Math.max(0, Math.round(diff.damageZoneCount * (1 - config.riskTolerance) * 0.5))
      : 0;

  const collectibles = getEntitiesWithComponent(ctx.gameComponents, 'collectible');
  const itemsCollected = Math.round(collectibles.length * config.completionFocus * exploredFraction);

  const backtrackCount = Math.round(
    actions.length * config.backtrackWillingness * 0.1,
  );

  const baseDuration = actions.length * 500;
  const difficultyMultiplier = 1 + discoveries.filter((d) => d.severity !== 'minor').length * 0.15;
  const timeToComplete = Math.round(baseDuration * difficultyMultiplier);

  return {
    timeToComplete,
    deathCount,
    itemsCollected,
    areasExplored: Math.round(areas.length * exploredFraction),
    backtrackCount,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Simulate a playtest session for the given scene context and strategy.
 * This is a heuristic analysis, not an actual game-engine simulation.
 */
export async function simulatePlaytest(
  sceneContext: SceneContext,
  strategy: BotStrategy,
): Promise<PlaytestSession> {
  const durationMs = 60_000; // Simulate 60 seconds of play time

  const discoveries = detectDiscoveries(sceneContext, strategy);
  const actions = generateActions(sceneContext, strategy, durationMs);
  const outcome = classifyOutcome(discoveries, strategy);
  const metrics = computeMetrics(sceneContext, strategy, actions, discoveries);

  return {
    strategy,
    actions,
    duration: metrics.timeToComplete,
    outcome,
    discoveries,
    metrics,
  };
}

/**
 * Generate an aggregate report from multiple playtest sessions.
 */
export function generatePlaytestReport(
  sessions: PlaytestSession[],
): PlaytestReport {
  // Deduplicate discoveries by type+location
  const seen = new Set<string>();
  const uniqueDiscoveries: BotDiscovery[] = [];
  for (const session of sessions) {
    for (const d of session.discoveries) {
      const key = `${d.type}:${d.location}:${d.description}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueDiscoveries.push(d);
      }
    }
  }

  const criticalCount = uniqueDiscoveries.filter((d) => d.severity === 'critical').length;
  const majorCount = uniqueDiscoveries.filter((d) => d.severity === 'major').length;
  const minorCount = uniqueDiscoveries.filter((d) => d.severity === 'minor').length;

  const strategyComparison = {} as Record<BotStrategy, PlaytestMetrics>;
  for (const session of sessions) {
    strategyComparison[session.strategy] = session.metrics;
  }

  let overallRating: PlaytestReport['overallRating'];
  if (criticalCount > 0) {
    overallRating = 'critical_issues';
  } else if (majorCount > 2) {
    overallRating = 'needs_work';
  } else if (majorCount > 0 || minorCount > 3) {
    overallRating = 'good';
  } else {
    overallRating = 'excellent';
  }

  return {
    sessions,
    totalDiscoveries: uniqueDiscoveries.length,
    criticalCount,
    majorCount,
    minorCount,
    uniqueDiscoveries,
    strategyComparison,
    overallRating,
  };
}
