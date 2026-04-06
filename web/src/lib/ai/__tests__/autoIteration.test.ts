import { describe, it, expect, vi } from 'vitest';
import {
  diagnoseIssues,
  generateFixes,
  applyFixes,
  severityColor,
  severityLabel,
  categoryLabel,
  ITERATION_SYSTEM_PROMPT,
} from '../autoIteration';
import type {
  GameMetrics,
  SceneContext,
  GameIssue,
  IssueFix,
  IterationReport,
  SceneEntity,
} from '../autoIteration';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeMetrics(overrides: Partial<GameMetrics> = {}): GameMetrics {
  return {
    avgPlayTime: 300,
    completionRate: 65,
    quitPoints: [],
    difficultySpikes: [],
    engagementScore: 70,
    ...overrides,
  };
}

function makeSceneContext(overrides: Partial<SceneContext> = {}): SceneContext {
  return {
    sceneName: 'Level 1',
    entityCount: 5,
    entities: [],
    ...overrides,
  };
}

function makeEntity(overrides: Partial<SceneEntity> = {}): SceneEntity {
  return {
    id: 'entity-1',
    name: 'Test Entity',
    type: 'mesh',
    components: [],
    properties: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// diagnoseIssues
// ---------------------------------------------------------------------------

describe('diagnoseIssues', () => {
  it('returns empty array for healthy metrics', () => {
    const issues = diagnoseIssues(makeMetrics(), makeSceneContext());
    expect(issues).toEqual([]);
  });

  it('detects critical quit points (>=40%)', () => {
    const metrics = makeMetrics({
      quitPoints: [{ scene: 'Level 3', percentage: 45 }],
    });
    const issues = diagnoseIssues(metrics, makeSceneContext());
    expect(issues.length).toBeGreaterThanOrEqual(1);
    const quitIssue = issues.find((i) => i.affectedArea === 'Level 3');
    expect(quitIssue).not.toBeNull();
    expect(quitIssue!.severity).toBe('critical');
    expect(quitIssue!.category).toBe('engagement');
  });

  it('detects major quit points (>=25%, <40%)', () => {
    const metrics = makeMetrics({
      quitPoints: [{ scene: 'Level 2', percentage: 30 }],
    });
    const issues = diagnoseIssues(metrics, makeSceneContext());
    const quitIssue = issues.find((i) => i.affectedArea === 'Level 2');
    expect(quitIssue).not.toBeNull();
    expect(quitIssue!.severity).toBe('major');
  });

  it('ignores low quit percentages (<25%)', () => {
    const metrics = makeMetrics({
      quitPoints: [{ scene: 'Level 1', percentage: 10 }],
    });
    const issues = diagnoseIssues(metrics, makeSceneContext());
    const quitIssue = issues.find((i) => i.category === 'engagement' && i.affectedArea === 'Level 1');
    expect(quitIssue).toBeUndefined();
  });

  it('detects critical difficulty spikes (>=70% death rate)', () => {
    const metrics = makeMetrics({
      difficultySpikes: [{ scene: 'Boss Room', deathRate: 0.85 }],
    });
    const issues = diagnoseIssues(metrics, makeSceneContext());
    const spike = issues.find((i) => i.affectedArea === 'Boss Room');
    expect(spike).not.toBeNull();
    expect(spike!.severity).toBe('critical');
    expect(spike!.category).toBe('difficulty');
  });

  it('detects major difficulty spikes (>=50%, <70%)', () => {
    const metrics = makeMetrics({
      difficultySpikes: [{ scene: 'Lava Pit', deathRate: 0.55 }],
    });
    const issues = diagnoseIssues(metrics, makeSceneContext());
    const spike = issues.find((i) => i.affectedArea === 'Lava Pit');
    expect(spike).not.toBeNull();
    expect(spike!.severity).toBe('major');
  });

  it('ignores mild difficulty (<50% death rate)', () => {
    const metrics = makeMetrics({
      difficultySpikes: [{ scene: 'Easy Zone', deathRate: 0.3 }],
    });
    const issues = diagnoseIssues(metrics, makeSceneContext());
    const spike = issues.find((i) => i.category === 'difficulty');
    expect(spike).toBeUndefined();
  });

  it('detects low engagement score', () => {
    const metrics = makeMetrics({ engagementScore: 20 });
    const issues = diagnoseIssues(metrics, makeSceneContext());
    const engagement = issues.find((i) => i.category === 'engagement' && i.description.includes('engagement score'));
    expect(engagement).not.toBeNull();
    expect(engagement!.severity).toBe('major');
  });

  it('detects critical low completion rate (<20%)', () => {
    const metrics = makeMetrics({ completionRate: 10 });
    const issues = diagnoseIssues(metrics, makeSceneContext());
    const progression = issues.find((i) => i.category === 'progression');
    expect(progression).not.toBeNull();
    expect(progression!.severity).toBe('critical');
  });

  it('detects major low completion rate (20-50%)', () => {
    const metrics = makeMetrics({ completionRate: 35 });
    const issues = diagnoseIssues(metrics, makeSceneContext());
    const progression = issues.find((i) => i.category === 'progression');
    expect(progression).not.toBeNull();
    expect(progression!.severity).toBe('major');
  });

  it('detects short play time as UX issue', () => {
    const metrics = makeMetrics({ avgPlayTime: 30 });
    const issues = diagnoseIssues(metrics, makeSceneContext());
    const ux = issues.find((i) => i.category === 'ux');
    expect(ux).not.toBeNull();
    expect(ux!.severity).toBe('major');
  });

  it('sorts issues by severity (critical first)', () => {
    const metrics = makeMetrics({
      completionRate: 10, // critical
      engagementScore: 20, // major
      quitPoints: [{ scene: 'X', percentage: 50 }], // critical
    });
    const issues = diagnoseIssues(metrics, makeSceneContext());
    expect(issues.length).toBeGreaterThanOrEqual(2);
    // All criticals should come before majors
    const criticalIdx = issues.findIndex((i) => i.severity === 'critical');
    const majorIdx = issues.findIndex((i) => i.severity === 'major');
    if (criticalIdx !== -1 && majorIdx !== -1) {
      expect(criticalIdx).toBeLessThan(majorIdx);
    }
  });

  it('handles multiple quit points and spikes', () => {
    const metrics = makeMetrics({
      quitPoints: [
        { scene: 'A', percentage: 45 },
        { scene: 'B', percentage: 30 },
      ],
      difficultySpikes: [
        { scene: 'C', deathRate: 0.8 },
      ],
    });
    const issues = diagnoseIssues(metrics, makeSceneContext());
    expect(issues.length).toBeGreaterThanOrEqual(3);
  });

  it('assigns unique IDs to each issue', () => {
    const metrics = makeMetrics({
      quitPoints: [
        { scene: 'A', percentage: 50 },
        { scene: 'B', percentage: 40 },
      ],
      completionRate: 10,
    });
    const issues = diagnoseIssues(metrics, makeSceneContext());
    const ids = issues.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('includes evidence strings for all issues', () => {
    const metrics = makeMetrics({
      completionRate: 10,
      engagementScore: 20,
      avgPlayTime: 30,
    });
    const issues = diagnoseIssues(metrics, makeSceneContext());
    for (const issue of issues) {
      expect(issue.evidence).not.toBe('');
      expect(typeof issue.evidence).toBe('string');
    }
  });
});

// ---------------------------------------------------------------------------
// generateFixes
// ---------------------------------------------------------------------------

describe('generateFixes', () => {
  it('returns empty array for empty issues', () => {
    const fixes = generateFixes([], makeSceneContext());
    expect(fixes).toEqual([]);
  });

  it('generates damage reduction fix for difficulty issues with damageZone entities', () => {
    const issue: GameIssue = {
      id: 'issue-1',
      category: 'difficulty',
      severity: 'critical',
      description: 'High death rate',
      evidence: 'Death rate 80%',
      affectedArea: 'Level 3',
    };
    const ctx = makeSceneContext({
      entities: [
        makeEntity({
          id: 'dz-1',
          components: ['damageZone'],
          properties: { damagePerSecond: 25 },
        }),
      ],
    });
    const fixes = generateFixes([issue], ctx);
    const damageFix = fixes.find((f) => f.description.includes('damage'));
    expect(damageFix).not.toBeNull();
    expect(damageFix!.issueId).toBe('issue-1');
    expect(damageFix!.confidence).toBeGreaterThan(0);
    expect(damageFix!.changes.length).toBeGreaterThan(0);
    // Damage should be reduced
    const change = damageFix!.changes[0];
    expect(change.command).toBe('update_game_component');
    expect((change.newValue as number)).toBeLessThan(25);
  });

  it('generates health increase fix for difficulty issues with health entities', () => {
    const issue: GameIssue = {
      id: 'issue-2',
      category: 'difficulty',
      severity: 'major',
      description: 'Difficulty spike',
      evidence: 'Death rate 60%',
      affectedArea: 'Level 2',
    };
    const ctx = makeSceneContext({
      entities: [
        makeEntity({
          id: 'player-1',
          components: ['health'],
          properties: { maxHp: 100 },
        }),
      ],
    });
    const fixes = generateFixes([issue], ctx);
    const healthFix = fixes.find((f) => f.description.includes('health'));
    expect(healthFix).not.toBeNull();
    expect(healthFix!.changes[0].newValue).toBe(150);
  });

  it('generates checkpoint fix when no checkpoints exist', () => {
    const issue: GameIssue = {
      id: 'issue-3',
      category: 'difficulty',
      severity: 'critical',
      description: 'High death rate',
      evidence: 'Death rate 85%',
      affectedArea: 'Level 5',
    };
    const ctx = makeSceneContext({ entities: [] });
    const fixes = generateFixes([issue], ctx);
    const checkpointFix = fixes.find((f) => f.description.includes('checkpoint'));
    expect(checkpointFix).not.toBeNull();
    expect(checkpointFix!.confidence).toBeGreaterThan(0);
  });

  it('generates engagement fixes for engagement issues', () => {
    const issue: GameIssue = {
      id: 'issue-4',
      category: 'engagement',
      severity: 'major',
      description: 'Low engagement',
      evidence: 'Score 20/100',
      affectedArea: 'Level 1',
    };
    const fixes = generateFixes([issue], makeSceneContext());
    expect(fixes.length).toBeGreaterThan(0);
    expect(fixes.some((f) => f.issueId === 'issue-4')).toBe(true);
  });

  it('generates progression fixes for progression issues', () => {
    const issue: GameIssue = {
      id: 'issue-5',
      category: 'progression',
      severity: 'major',
      description: 'Low completion',
      evidence: 'Only 30% complete',
      affectedArea: 'Game',
    };
    const ctx = makeSceneContext({
      entities: [
        makeEntity({
          id: 'mp-1',
          components: ['movingPlatform'],
          properties: { speed: 4 },
        }),
      ],
    });
    const fixes = generateFixes([issue], ctx);
    const platformFix = fixes.find((f) => f.description.includes('platform'));
    expect(platformFix).not.toBeNull();
    expect(platformFix!.changes[0].newValue).toBeLessThan(4);
  });

  it('generates balance fixes for spawner entities', () => {
    const issue: GameIssue = {
      id: 'issue-6',
      category: 'balance',
      severity: 'major',
      description: 'Unbalanced spawning',
      evidence: 'Too many enemies',
      affectedArea: 'Arena',
    };
    const ctx = makeSceneContext({
      entities: [
        makeEntity({
          id: 'sp-1',
          components: ['spawner'],
          properties: { intervalSecs: 2 },
        }),
      ],
    });
    const fixes = generateFixes([issue], ctx);
    const spawnerFix = fixes.find((f) => f.description.includes('spawner'));
    expect(spawnerFix).not.toBeNull();
    expect((spawnerFix!.changes[0].newValue as number)).toBeGreaterThan(2);
  });

  it('generates UX fixes', () => {
    const issue: GameIssue = {
      id: 'issue-7',
      category: 'ux',
      severity: 'major',
      description: 'Short play time',
      evidence: 'Under 1 minute average',
      affectedArea: 'Game',
    };
    const fixes = generateFixes([issue], makeSceneContext());
    expect(fixes.length).toBeGreaterThan(0);
  });

  it('all fixes have valid confidence between 0 and 1', () => {
    const issues: GameIssue[] = [
      {
        id: 'i-1',
        category: 'difficulty',
        severity: 'critical',
        description: 'test',
        evidence: 'test',
        affectedArea: 'test',
      },
      {
        id: 'i-2',
        category: 'engagement',
        severity: 'major',
        description: 'test',
        evidence: 'test',
        affectedArea: 'test',
      },
    ];
    const ctx = makeSceneContext({
      entities: [
        makeEntity({ components: ['damageZone'], properties: { damagePerSecond: 30 } }),
      ],
    });
    const fixes = generateFixes(issues, ctx);
    for (const fix of fixes) {
      expect(fix.confidence).toBeGreaterThanOrEqual(0);
      expect(fix.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('all fixes have non-empty estimatedImpact', () => {
    const issues: GameIssue[] = [
      {
        id: 'i-1',
        category: 'difficulty',
        severity: 'critical',
        description: 'test',
        evidence: 'test',
        affectedArea: 'test',
      },
    ];
    const fixes = generateFixes(issues, makeSceneContext());
    for (const fix of fixes) {
      expect(fix.estimatedImpact).not.toBe('');
    }
  });
});

// ---------------------------------------------------------------------------
// applyFixes
// ---------------------------------------------------------------------------

describe('applyFixes', () => {
  it('dispatches commands for each change in each fix', () => {
    const dispatch = vi.fn();
    const fixes: IssueFix[] = [
      {
        issueId: 'issue-1',
        description: 'Reduce damage',
        changes: [
          {
            entityId: 'dz-1',
            component: 'game_component',
            property: 'damagePerSecond',
            oldValue: 25,
            newValue: 15,
            command: 'update_game_component',
          },
          {
            entityId: 'dz-2',
            component: 'game_component',
            property: 'damagePerSecond',
            oldValue: 30,
            newValue: 18,
            command: 'update_game_component',
          },
        ],
        confidence: 0.75,
        estimatedImpact: 'Reduce death rate',
      },
    ];

    applyFixes(fixes, dispatch, 1);
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch).toHaveBeenCalledWith('update_game_component', {
      entityId: 'dz-1',
      componentType: 'game_component',
      properties: { damagePerSecond: 15 },
    });
  });

  it('returns correct iteration report structure', () => {
    const dispatch = vi.fn();
    const fixes: IssueFix[] = [
      {
        issueId: 'issue-1',
        description: 'Test fix',
        changes: [
          {
            entityId: 'e-1',
            component: 'test',
            property: 'val',
            oldValue: 1,
            newValue: 2,
            command: 'update_test',
          },
        ],
        confidence: 0.8,
        estimatedImpact: 'Improve things',
      },
    ];

    const report: IterationReport = applyFixes(fixes, dispatch, 3);
    expect(report.iterationNumber).toBe(3);
    expect(report.fixesApplied).toHaveLength(1);
    expect(report.summary).toContain('1 fix');
    expect(report.summary).toContain('1 change');
    expect(typeof report.timestamp).toBe('number');
  });

  it('returns empty report when no fixes provided', () => {
    const dispatch = vi.fn();
    const report = applyFixes([], dispatch, 1);
    expect(dispatch).not.toHaveBeenCalled();
    expect(report.fixesApplied).toHaveLength(0);
    expect(report.summary).toBe('No fixes applied.');
  });

  it('correctly pluralizes in summary', () => {
    const dispatch = vi.fn();
    const fixes: IssueFix[] = [
      {
        issueId: 'i-1',
        description: 'Fix 1',
        changes: [
          { component: 'a', property: 'x', oldValue: 0, newValue: 1, command: 'cmd1' },
          { component: 'b', property: 'y', oldValue: 0, newValue: 1, command: 'cmd2' },
        ],
        confidence: 0.5,
        estimatedImpact: 'test',
      },
      {
        issueId: 'i-2',
        description: 'Fix 2',
        changes: [
          { component: 'c', property: 'z', oldValue: 0, newValue: 1, command: 'cmd3' },
        ],
        confidence: 0.5,
        estimatedImpact: 'test',
      },
    ];
    const report = applyFixes(fixes, dispatch, 1);
    expect(report.summary).toContain('2 fixes');
    expect(report.summary).toContain('3 changes');
  });

  it('includes all applied fixes in the report', () => {
    const dispatch = vi.fn();
    const fixes: IssueFix[] = Array.from({ length: 5 }, (_, i) => ({
      issueId: `issue-${i}`,
      description: `Fix ${i}`,
      changes: [
        { component: 'c', property: 'p', oldValue: i, newValue: i + 1, command: 'cmd' },
      ],
      confidence: 0.5,
      estimatedImpact: 'test',
    }));
    const report = applyFixes(fixes, dispatch, 2);
    expect(report.fixesApplied).toHaveLength(5);
    expect(dispatch).toHaveBeenCalledTimes(5);
  });

  it('dispatches spawn_entity with entityType and name', () => {
    const dispatch = vi.fn();
    const fixes: IssueFix[] = [
      {
        issueId: 'issue-spawn',
        description: 'Add checkpoint',
        changes: [
          {
            component: 'checkpoint',
            property: 'autoSave',
            oldValue: undefined,
            newValue: true,
            command: 'spawn_entity',
          },
        ],
        confidence: 0.8,
        estimatedImpact: 'test',
      },
    ];
    applyFixes(fixes, dispatch, 1);
    expect(dispatch).toHaveBeenCalledWith('spawn_entity', {
      entityType: 'cube',
      name: 'checkpoint',
    });
  });

  it('dispatches update_ambient_light with property directly', () => {
    const dispatch = vi.fn();
    const fixes: IssueFix[] = [
      {
        issueId: 'issue-light',
        description: 'Improve lighting',
        changes: [
          {
            component: 'environment',
            property: 'ambientBrightness',
            oldValue: 0.3,
            newValue: 0.5,
            command: 'update_ambient_light',
          },
        ],
        confidence: 0.5,
        estimatedImpact: 'test',
      },
    ];
    applyFixes(fixes, dispatch, 1);
    expect(dispatch).toHaveBeenCalledWith('update_ambient_light', {
      ambientBrightness: 0.5,
    });
  });
});

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

describe('severityColor', () => {
  it('returns red for critical', () => {
    expect(severityColor('critical')).toBe('text-red-400');
  });

  it('returns yellow for major', () => {
    expect(severityColor('major')).toBe('text-yellow-400');
  });

  it('returns blue for minor', () => {
    expect(severityColor('minor')).toBe('text-blue-400');
  });
});

describe('severityLabel', () => {
  it('returns capitalized labels', () => {
    expect(severityLabel('critical')).toBe('Critical');
    expect(severityLabel('major')).toBe('Major');
    expect(severityLabel('minor')).toBe('Minor');
  });
});

describe('categoryLabel', () => {
  it('returns human-readable labels for all categories', () => {
    expect(categoryLabel('difficulty')).toBe('Difficulty');
    expect(categoryLabel('engagement')).toBe('Engagement');
    expect(categoryLabel('progression')).toBe('Progression');
    expect(categoryLabel('balance')).toBe('Balance');
    expect(categoryLabel('ux')).toBe('UX');
  });
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('ITERATION_SYSTEM_PROMPT', () => {
  it('is a non-empty string', () => {
    expect(typeof ITERATION_SYSTEM_PROMPT).toBe('string');
    expect(ITERATION_SYSTEM_PROMPT.length).toBeGreaterThan(100);
  });

  it('mentions key analysis areas', () => {
    expect(ITERATION_SYSTEM_PROMPT).toContain('Difficulty');
    expect(ITERATION_SYSTEM_PROMPT).toContain('Engagement');
    expect(ITERATION_SYSTEM_PROMPT).toContain('Progression');
    expect(ITERATION_SYSTEM_PROMPT).toContain('Balance');
    expect(ITERATION_SYSTEM_PROMPT).toContain('UX');
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('handles empty metrics with no issues', () => {
    const metrics = makeMetrics({
      quitPoints: [],
      difficultySpikes: [],
    });
    const issues = diagnoseIssues(metrics, makeSceneContext());
    expect(Array.isArray(issues)).toBe(true);
  });

  it('handles entity with missing properties gracefully', () => {
    const issue: GameIssue = {
      id: 'edge-1',
      category: 'difficulty',
      severity: 'critical',
      description: 'test',
      evidence: 'test',
      affectedArea: 'test',
    };
    const ctx = makeSceneContext({
      entities: [
        makeEntity({
          id: 'e-no-props',
          components: ['damageZone'],
          properties: {},
        }),
      ],
    });
    // Should not throw
    const fixes = generateFixes([issue], ctx);
    expect(fixes.length).toBeGreaterThan(0);
    // Should use default value
    const damageFix = fixes.find((f) => f.description.includes('damage'));
    expect(damageFix).not.toBeNull();
    expect(damageFix!.changes[0].oldValue).toBe(25); // default
  });

  it('handles scene context with zero entities', () => {
    const ctx = makeSceneContext({ entities: [], entityCount: 0 });
    const issues = diagnoseIssues(
      makeMetrics({ completionRate: 10 }),
      ctx,
    );
    expect(issues.length).toBeGreaterThan(0);

    const fixes = generateFixes(issues, ctx);
    // Should still produce some fixes (e.g., checkpoint, hints)
    expect(Array.isArray(fixes)).toBe(true);
  });

  it('damage reduction never goes below minimum of 5', () => {
    const issue: GameIssue = {
      id: 'min-1',
      category: 'difficulty',
      severity: 'critical',
      description: 'test',
      evidence: 'test',
      affectedArea: 'test',
    };
    const ctx = makeSceneContext({
      entities: [
        makeEntity({
          id: 'dz-low',
          components: ['damageZone'],
          properties: { damagePerSecond: 5 },
        }),
      ],
    });
    const fixes = generateFixes([issue], ctx);
    const damageFix = fixes.find((f) => f.description.includes('damage'));
    expect(damageFix).not.toBeNull();
    expect((damageFix!.changes[0].newValue as number)).toBeGreaterThanOrEqual(5);
  });

  it('platform speed reduction never goes below 0.5', () => {
    const issue: GameIssue = {
      id: 'plat-1',
      category: 'progression',
      severity: 'major',
      description: 'test',
      evidence: 'test',
      affectedArea: 'test',
    };
    const ctx = makeSceneContext({
      entities: [
        makeEntity({
          id: 'mp-slow',
          components: ['movingPlatform'],
          properties: { speed: 0.5 },
        }),
      ],
    });
    const fixes = generateFixes([issue], ctx);
    const platFix = fixes.find((f) => f.description.includes('platform'));
    expect(platFix).not.toBeNull();
    expect((platFix!.changes[0].newValue as number)).toBeGreaterThanOrEqual(0.5);
  });
});
