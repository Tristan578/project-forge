import { describe, it, expect } from 'vitest';
import {
  validateWinnability,
  formatWinnabilityMessage,
} from '../winnabilityValidator';
import type { SceneGraph, GameComponentData } from '@/stores/slices/types';

function graph(entityIds: string[]): SceneGraph {
  const nodes: SceneGraph['nodes'] = {};
  for (const id of entityIds) {
    nodes[id] = { entityId: id, name: id, parentId: null, children: [], components: [], visible: true };
  }
  return { nodes, rootIds: entityIds };
}

const player: GameComponentData = {
  type: 'characterController',
  characterController: { speed: 5, jumpHeight: 2, gravityScale: 1, canDoubleJump: false },
};
const collectible: GameComponentData = {
  type: 'collectible',
  collectible: { value: 1, destroyOnCollect: true, pickupSoundAsset: null, rotateSpeed: 0 },
};
function reachGoal(targetEntityId: string | null): GameComponentData {
  return { type: 'winCondition', winCondition: { conditionType: 'reachGoal', targetScore: null, targetEntityId } };
}
function collectAll(): GameComponentData {
  return { type: 'winCondition', winCondition: { conditionType: 'collectAll', targetScore: null, targetEntityId: null } };
}
function scoreWin(targetScore: number | null): GameComponentData {
  return { type: 'winCondition', winCondition: { conditionType: 'score', targetScore, targetEntityId: null } };
}

describe('validateWinnability', () => {
  describe('no win condition', () => {
    it('flags a scene with no win condition at all', () => {
      const report = validateWinnability(graph(['player', 'goal']), {
        player: [player],
      });
      expect(report.winnable).toBe(false);
      expect(report.issues).toHaveLength(1);
      expect(report.issues[0].code).toBe('NO_WIN_CONDITION');
    });

    it('flags an entirely empty scene', () => {
      const report = validateWinnability(graph([]), {});
      expect(report.winnable).toBe(false);
      expect(report.issues[0].code).toBe('NO_WIN_CONDITION');
    });
  });

  describe('reachGoal', () => {
    it('passes when goal target exists and a player is present', () => {
      const report = validateWinnability(graph(['player', 'goal']), {
        player: [player],
        wc: [reachGoal('goal')],
      });
      expect(report.winnable).toBe(true);
      expect(report.issues).toHaveLength(0);
    });

    it('fails when the goal target does not exist', () => {
      const report = validateWinnability(graph(['player']), {
        player: [player],
        wc: [reachGoal('ghost')],
      });
      expect(report.winnable).toBe(false);
      expect(report.issues.map(i => i.code)).toContain('GOAL_TARGET_MISSING');
    });

    it('fails when the goal target is null', () => {
      const report = validateWinnability(graph(['player']), {
        player: [player],
        wc: [reachGoal(null)],
      });
      expect(report.winnable).toBe(false);
      expect(report.issues.map(i => i.code)).toContain('GOAL_TARGET_MISSING');
    });

    it('fails when there is no player to reach the goal', () => {
      const report = validateWinnability(graph(['goal']), {
        wc: [reachGoal('goal')],
      });
      expect(report.winnable).toBe(false);
      expect(report.issues.map(i => i.code)).toContain('NO_PLAYER');
    });

    it('reports both missing target and missing player together', () => {
      const report = validateWinnability(graph([]), {
        wc: [reachGoal('ghost')],
      });
      expect(report.winnable).toBe(false);
      const codes = report.issues.map(i => i.code);
      expect(codes).toContain('GOAL_TARGET_MISSING');
      expect(codes).toContain('NO_PLAYER');
    });

    it('attaches the offending win-condition entity id to issues', () => {
      const report = validateWinnability(graph(['player']), {
        player: [player],
        wcEntity: [reachGoal('ghost')],
      });
      expect(report.issues[0].entityId).toBe('wcEntity');
    });
  });

  describe('collectAll', () => {
    it('passes with at least one collectible and a player', () => {
      const report = validateWinnability(graph(['player', 'coin']), {
        player: [player],
        coin: [collectible],
        wc: [collectAll()],
      });
      expect(report.winnable).toBe(true);
    });

    it('fails when there are no collectibles', () => {
      const report = validateWinnability(graph(['player']), {
        player: [player],
        wc: [collectAll()],
      });
      expect(report.winnable).toBe(false);
      expect(report.issues.map(i => i.code)).toContain('NO_COLLECTIBLES');
    });

    it('fails when there is no player to collect', () => {
      const report = validateWinnability(graph(['coin']), {
        coin: [collectible],
        wc: [collectAll()],
      });
      expect(report.winnable).toBe(false);
      expect(report.issues.map(i => i.code)).toContain('NO_PLAYER');
    });

    it('counts multiple collectibles', () => {
      const report = validateWinnability(graph(['player', 'c1', 'c2']), {
        player: [player],
        c1: [collectible],
        c2: [collectible],
        wc: [collectAll()],
      });
      expect(report.winnable).toBe(true);
    });
  });

  describe('score', () => {
    it('passes with a positive target score', () => {
      const report = validateWinnability(graph(['player']), {
        player: [player],
        wc: [scoreWin(100)],
      });
      expect(report.winnable).toBe(true);
    });

    it('fails with a null target score', () => {
      const report = validateWinnability(graph(['player']), {
        wc: [scoreWin(null)],
      });
      expect(report.winnable).toBe(false);
      expect(report.issues.map(i => i.code)).toContain('INVALID_TARGET_SCORE');
    });

    it('fails with a zero target score', () => {
      const report = validateWinnability(graph(['player']), {
        wc: [scoreWin(0)],
      });
      expect(report.winnable).toBe(false);
      expect(report.issues.map(i => i.code)).toContain('INVALID_TARGET_SCORE');
    });

    it('fails with a negative target score', () => {
      const report = validateWinnability(graph(['player']), {
        wc: [scoreWin(-5)],
      });
      expect(report.winnable).toBe(false);
      expect(report.issues.map(i => i.code)).toContain('INVALID_TARGET_SCORE');
    });
  });

  describe('multiple win conditions', () => {
    it('is winnable when any single condition is satisfiable', () => {
      const report = validateWinnability(graph(['player', 'goal']), {
        player: [player],
        good: [reachGoal('goal')],
        bad: [collectAll()], // no collectibles → unsatisfiable
      });
      expect(report.winnable).toBe(true);
      expect(report.issues).toHaveLength(0);
    });

    it('is not winnable only when every condition fails', () => {
      const report = validateWinnability(graph(['player']), {
        player: [player],
        bad1: [reachGoal('ghost')],
        bad2: [collectAll()],
      });
      expect(report.winnable).toBe(false);
      const codes = report.issues.map(i => i.code);
      expect(codes).toContain('GOAL_TARGET_MISSING');
      expect(codes).toContain('NO_COLLECTIBLES');
    });
  });

  describe('defensive input handling', () => {
    it('treats a missing scene graph as empty', () => {
      const report = validateWinnability(
        undefined as unknown as SceneGraph,
        { wc: [reachGoal('goal')], player: [player] },
      );
      expect(report.winnable).toBe(false);
      expect(report.issues.map(i => i.code)).toContain('GOAL_TARGET_MISSING');
    });

    it('treats missing components map as no win condition', () => {
      const report = validateWinnability(
        graph(['a']),
        undefined as unknown as Record<string, GameComponentData[]>,
      );
      expect(report.winnable).toBe(false);
      expect(report.issues[0].code).toBe('NO_WIN_CONDITION');
    });
  });
});

describe('formatWinnabilityMessage', () => {
  it('returns an empty string when winnable', () => {
    expect(formatWinnabilityMessage({ winnable: true, issues: [] })).toBe('');
  });

  it('renders each issue as a bullet plus a remediation prompt', () => {
    const report = validateWinnability(graph(['player']), {
      player: [player],
      wc: [reachGoal('ghost')],
    });
    const message = formatWinnabilityMessage(report);
    expect(message).toContain("This game can't be won yet:");
    expect(message).toContain('•');
    expect(message).toContain('no longer exists');
    expect(message).toContain('ask me to add or repair it');
  });
});
