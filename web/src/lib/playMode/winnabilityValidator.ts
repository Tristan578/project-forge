/**
 * Pre-play winnability validator.
 *
 * Before a game enters Play mode we check that it is *actually* winnable: that
 * a player can drive at least one win condition to completion. A scene with no
 * win condition (the most common failure) can never be won, and a malformed
 * win condition — a goal that points at a deleted entity, a "collect all" with
 * nothing to collect — is just as dead.
 *
 * The check is intentionally STRUCTURAL, not spatial. We verify the pieces a
 * win requires exist and are wired together; we do not run pathfinding to prove
 * the goal is physically reachable (that would be fragile and non-deterministic
 * across generated geometry). "Reachable" here means "there is a player and a
 * goal entity for it to reach", which is what catches the real-world breakages.
 *
 * Mirrors the engine's win semantics in `engine/src/core/game_components.rs`:
 *   - reachGoal:  a CharacterController touches the goal target entity
 *   - collectAll: every Collectible has been picked up by the player
 *   - score:      the player's score reaches a positive target
 */

import type { SceneGraph, GameComponentData, WinConditionData } from '@/stores/slices/types';

export type WinnabilityIssueCode =
  | 'NO_WIN_CONDITION'
  | 'GOAL_TARGET_MISSING'
  | 'NO_PLAYER'
  | 'NO_COLLECTIBLES'
  | 'INVALID_TARGET_SCORE';

export interface WinnabilityIssue {
  code: WinnabilityIssueCode;
  /** Human-readable, AI-actionable explanation of what to fix. */
  message: string;
  /** The entity carrying the offending win condition, when applicable. */
  entityId?: string;
}

export interface WinnabilityReport {
  winnable: boolean;
  /** Empty when winnable; otherwise every reason the game cannot be won. */
  issues: WinnabilityIssue[];
}

interface SceneFacts {
  sceneGraph: SceneGraph;
  hasPlayer: boolean;
  collectibleCount: number;
}

/**
 * Evaluate a single win condition against the scene. Returns the issues that
 * make it unsatisfiable, or an empty array when the condition can be won.
 */
function evaluateCondition(
  entityId: string,
  data: WinConditionData,
  facts: SceneFacts,
): WinnabilityIssue[] {
  switch (data.conditionType) {
    case 'reachGoal': {
      const issues: WinnabilityIssue[] = [];
      const target = data.targetEntityId;
      if (!target || !facts.sceneGraph.nodes[target]) {
        issues.push({
          code: 'GOAL_TARGET_MISSING',
          entityId,
          message: target
            ? `The "reach goal" win condition points at a goal entity ("${target}") that no longer exists. Set its target to an entity the player can reach.`
            : 'The "reach goal" win condition has no goal entity set. Choose the entity the player must reach to win.',
        });
      }
      if (!facts.hasPlayer) {
        issues.push({
          code: 'NO_PLAYER',
          entityId,
          message: 'The "reach goal" win condition needs a player to reach it. Add a Character Controller component to the player entity.',
        });
      }
      return issues;
    }
    case 'collectAll': {
      const issues: WinnabilityIssue[] = [];
      if (facts.collectibleCount === 0) {
        issues.push({
          code: 'NO_COLLECTIBLES',
          entityId,
          message: 'The "collect all" win condition has no collectibles to gather, so it can never complete. Add at least one Collectible component to an entity.',
        });
      }
      if (!facts.hasPlayer) {
        issues.push({
          code: 'NO_PLAYER',
          entityId,
          message: 'The "collect all" win condition needs a player to pick the collectibles up. Add a Character Controller component to the player entity.',
        });
      }
      return issues;
    }
    case 'score': {
      if (data.targetScore == null || data.targetScore <= 0) {
        return [{
          code: 'INVALID_TARGET_SCORE',
          entityId,
          message: `The "reach score" win condition needs a positive target score (currently ${data.targetScore ?? 'unset'}). Set a target score greater than zero.`,
        }];
      }
      return [];
    }
    default:
      return [];
  }
}

/**
 * Validate whether the given scene can be won. A scene is winnable when at
 * least one of its win conditions is satisfiable; the report lists every reason
 * the others (or all) fail so the message back to the user is specific.
 */
export function validateWinnability(
  sceneGraph: SceneGraph,
  allGameComponents: Record<string, GameComponentData[]>,
): WinnabilityReport {
  const graph: SceneGraph = sceneGraph ?? { nodes: {}, rootIds: [] };
  const winConditions: Array<{ entityId: string; data: WinConditionData }> = [];
  let hasPlayer = false;
  let collectibleCount = 0;

  for (const [entityId, components] of Object.entries(allGameComponents ?? {})) {
    for (const component of components ?? []) {
      if (component.type === 'winCondition') {
        winConditions.push({ entityId, data: component.winCondition });
      } else if (component.type === 'characterController') {
        hasPlayer = true;
      } else if (component.type === 'collectible') {
        collectibleCount += 1;
      }
    }
  }

  if (winConditions.length === 0) {
    return {
      winnable: false,
      issues: [{
        code: 'NO_WIN_CONDITION',
        message: 'This scene has no win condition, so the game can never be won. Add a Win Condition component — for example "reach goal" tied to a goal entity, or "collect all" with collectible items.',
      }],
    };
  }

  const facts: SceneFacts = { sceneGraph: graph, hasPlayer, collectibleCount };
  const issues: WinnabilityIssue[] = [];
  let anySatisfiable = false;

  for (const { entityId, data } of winConditions) {
    const conditionIssues = evaluateCondition(entityId, data, facts);
    if (conditionIssues.length === 0) {
      anySatisfiable = true;
    } else {
      issues.push(...conditionIssues);
    }
  }

  if (anySatisfiable) {
    return { winnable: true, issues: [] };
  }
  return { winnable: false, issues };
}

/**
 * Render a winnability report into an actionable chat message. Returns an empty
 * string when the scene is winnable (nothing to surface).
 */
export function formatWinnabilityMessage(report: WinnabilityReport): string {
  if (report.winnable) return '';
  const bullets = report.issues.map(issue => `• ${issue.message}`);
  return [
    "This game can't be won yet:",
    ...bullets,
    'Fix the win condition above, then press Play again — or ask me to add or repair it for you.',
  ].join('\n');
}
