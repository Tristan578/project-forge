/**
 * AI Auto-Iteration Engine (PF-553)
 *
 * Analyzes game metrics, diagnoses issues, generates fixes, and applies them
 * through the engine command system. Creates a continuous improvement loop:
 * analytics -> diagnose -> fix -> redeploy.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type IssueCategory =
  | 'difficulty'
  | 'engagement'
  | 'progression'
  | 'balance'
  | 'ux';

export type IssueSeverity = 'critical' | 'major' | 'minor';

export interface GameIssue {
  id: string;
  category: IssueCategory;
  severity: IssueSeverity;
  description: string;
  evidence: string;
  affectedArea: string;
}

export interface FixChange {
  entityId?: string;
  component: string;
  property: string;
  oldValue: unknown;
  newValue: unknown;
  command: string;
}

export interface IssueFix {
  issueId: string;
  description: string;
  changes: FixChange[];
  confidence: number;
  estimatedImpact: string;
}

export interface IterationReport {
  timestamp: number;
  issuesFound: GameIssue[];
  fixesApplied: IssueFix[];
  iterationNumber: number;
  summary: string;
}

export interface QuitPoint {
  scene: string;
  percentage: number;
}

export interface DifficultySpike {
  scene: string;
  deathRate: number;
}

export interface GameMetrics {
  avgPlayTime: number;
  completionRate: number;
  quitPoints: QuitPoint[];
  difficultySpikes: DifficultySpike[];
  engagementScore: number;
}

export interface SceneContext {
  sceneName: string;
  entityCount: number;
  entities: SceneEntity[];
}

export interface SceneEntity {
  id: string;
  name: string;
  type: string;
  components: string[];
  properties: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** System prompt for AI game balance analysis. */
export const ITERATION_SYSTEM_PROMPT = `You are a game design analyst for SpawnForge, an AI-native game engine.
Your job is to analyze player behavior metrics and identify issues that hurt
the player experience. Focus on:
- Difficulty spikes that cause players to quit
- Engagement drops where players lose interest
- Progression blockers that prevent advancement
- Balance issues between game mechanics
- UX problems that confuse players

When proposing fixes, ensure they are small, targeted changes that can be
applied via engine commands. Each fix should have a confidence score (0-1)
indicating how likely it is to improve the situation.`;

// ---------------------------------------------------------------------------
// Severity thresholds
// ---------------------------------------------------------------------------

/** Maps fix component names to engine entity types for spawn_entity. */
const SPAWN_ENTITY_TYPE_MAP: Record<string, string> = {
  checkpoint: 'cube',
  collectible: 'cube',
  triggerZone: 'cube',
  light: 'point_light',
};

const CRITICAL_QUIT_PERCENTAGE = 40;
const MAJOR_QUIT_PERCENTAGE = 25;
const CRITICAL_DEATH_RATE = 0.7;
const MAJOR_DEATH_RATE = 0.5;
const LOW_ENGAGEMENT_THRESHOLD = 30;
const LOW_COMPLETION_THRESHOLD = 20;
const MEDIUM_COMPLETION_THRESHOLD = 50;

// ---------------------------------------------------------------------------
// Issue ID generation (deterministic from content, no Math.random in render)
// ---------------------------------------------------------------------------

function issueId(category: string, area: string, index: number): string {
  return `issue-${category}-${area.replace(/\s+/g, '-').toLowerCase()}-${index}`;
}

// ---------------------------------------------------------------------------
// Diagnosis
// ---------------------------------------------------------------------------

/**
 * Analyze game metrics and scene context to identify problems.
 * Returns a list of GameIssues sorted by severity.
 */
export function diagnoseIssues(
  metrics: GameMetrics,
  sceneContext: SceneContext,
): GameIssue[] {
  const issues: GameIssue[] = [];
  let idx = 0;

  // 1. Quit-point analysis
  for (const qp of metrics.quitPoints) {
    if (qp.percentage >= CRITICAL_QUIT_PERCENTAGE) {
      issues.push({
        id: issueId('engagement', qp.scene, idx++),
        category: 'engagement',
        severity: 'critical',
        description: `${qp.percentage}% of players quit at "${qp.scene}"`,
        evidence: `Quit rate ${qp.percentage}% exceeds critical threshold (${CRITICAL_QUIT_PERCENTAGE}%)`,
        affectedArea: qp.scene,
      });
    } else if (qp.percentage >= MAJOR_QUIT_PERCENTAGE) {
      issues.push({
        id: issueId('engagement', qp.scene, idx++),
        category: 'engagement',
        severity: 'major',
        description: `${qp.percentage}% of players quit at "${qp.scene}"`,
        evidence: `Quit rate ${qp.percentage}% exceeds major threshold (${MAJOR_QUIT_PERCENTAGE}%)`,
        affectedArea: qp.scene,
      });
    }
  }

  // 2. Difficulty-spike analysis
  for (const spike of metrics.difficultySpikes) {
    if (spike.deathRate >= CRITICAL_DEATH_RATE) {
      issues.push({
        id: issueId('difficulty', spike.scene, idx++),
        category: 'difficulty',
        severity: 'critical',
        description: `Extreme difficulty spike in "${spike.scene}" (${(spike.deathRate * 100).toFixed(0)}% death rate)`,
        evidence: `Death rate ${(spike.deathRate * 100).toFixed(0)}% exceeds critical threshold (${CRITICAL_DEATH_RATE * 100}%)`,
        affectedArea: spike.scene,
      });
    } else if (spike.deathRate >= MAJOR_DEATH_RATE) {
      issues.push({
        id: issueId('difficulty', spike.scene, idx++),
        category: 'difficulty',
        severity: 'major',
        description: `Difficulty spike in "${spike.scene}" (${(spike.deathRate * 100).toFixed(0)}% death rate)`,
        evidence: `Death rate ${(spike.deathRate * 100).toFixed(0)}% exceeds major threshold (${MAJOR_DEATH_RATE * 100}%)`,
        affectedArea: spike.scene,
      });
    }
  }

  // 3. Low engagement score
  if (metrics.engagementScore < LOW_ENGAGEMENT_THRESHOLD) {
    issues.push({
      id: issueId('engagement', sceneContext.sceneName, idx++),
      category: 'engagement',
      severity: 'major',
      description: `Low overall engagement score (${metrics.engagementScore}/100)`,
      evidence: `Engagement score ${metrics.engagementScore} is below threshold (${LOW_ENGAGEMENT_THRESHOLD})`,
      affectedArea: sceneContext.sceneName,
    });
  }

  // 4. Low completion rate
  if (metrics.completionRate < LOW_COMPLETION_THRESHOLD) {
    issues.push({
      id: issueId('progression', sceneContext.sceneName, idx++),
      category: 'progression',
      severity: 'critical',
      description: `Very low completion rate (${metrics.completionRate}%)`,
      evidence: `Only ${metrics.completionRate}% of players finish the game (threshold: ${LOW_COMPLETION_THRESHOLD}%)`,
      affectedArea: sceneContext.sceneName,
    });
  } else if (metrics.completionRate < MEDIUM_COMPLETION_THRESHOLD) {
    issues.push({
      id: issueId('progression', sceneContext.sceneName, idx++),
      category: 'progression',
      severity: 'major',
      description: `Low completion rate (${metrics.completionRate}%)`,
      evidence: `Only ${metrics.completionRate}% of players finish the game (threshold: ${MEDIUM_COMPLETION_THRESHOLD}%)`,
      affectedArea: sceneContext.sceneName,
    });
  }

  // 5. Short play time suggests UX or onboarding issues
  if (metrics.avgPlayTime < 60) {
    issues.push({
      id: issueId('ux', sceneContext.sceneName, idx++),
      category: 'ux',
      severity: 'major',
      description: `Very short average play time (${metrics.avgPlayTime}s)`,
      evidence: `Players spend less than 1 minute on average, suggesting confusion or lack of engagement`,
      affectedArea: sceneContext.sceneName,
    });
  }

  // Sort by severity: critical > major > minor
  const severityOrder: Record<IssueSeverity, number> = { critical: 0, major: 1, minor: 2 };
  issues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return issues;
}

// ---------------------------------------------------------------------------
// Fix generation
// ---------------------------------------------------------------------------

/**
 * Generate concrete fixes for diagnosed issues.
 * Maps each issue to engine commands that address the problem.
 */
export function generateFixes(
  issues: GameIssue[],
  sceneContext: SceneContext,
): IssueFix[] {
  const fixes: IssueFix[] = [];

  for (const issue of issues) {
    const fixesForIssue = generateFixForIssue(issue, sceneContext);
    fixes.push(...fixesForIssue);
  }

  return fixes;
}

function generateFixForIssue(
  issue: GameIssue,
  sceneContext: SceneContext,
): IssueFix[] {
  const fixes: IssueFix[] = [];

  switch (issue.category) {
    case 'difficulty': {
      // Find damage zones and reduce damage
      const damageEntities = sceneContext.entities.filter(
        (e) => e.components.includes('damageZone'),
      );
      if (damageEntities.length > 0) {
        fixes.push({
          issueId: issue.id,
          description: `Reduce damage zone intensity in "${issue.affectedArea}" to ease difficulty`,
          changes: damageEntities.map((e) => ({
            entityId: e.id,
            component: 'game_component',
            property: 'damagePerSecond',
            oldValue: (e.properties.damagePerSecond as number) ?? 25,
            newValue: Math.max(5, ((e.properties.damagePerSecond as number) ?? 25) * 0.6),
            command: 'update_game_component',
          })),
          confidence: 0.75,
          estimatedImpact: `Reduce death rate by ~20-30% in ${issue.affectedArea}`,
        });
      }

      // Find health components and increase HP
      const healthEntities = sceneContext.entities.filter(
        (e) => e.components.includes('health'),
      );
      if (healthEntities.length > 0) {
        fixes.push({
          issueId: issue.id,
          description: `Increase player health to compensate for difficulty spike`,
          changes: healthEntities.map((e) => ({
            entityId: e.id,
            component: 'game_component',
            property: 'maxHp',
            oldValue: (e.properties.maxHp as number) ?? 100,
            newValue: Math.round(((e.properties.maxHp as number) ?? 100) * 1.5),
            command: 'update_game_component',
          })),
          confidence: 0.7,
          estimatedImpact: `Give players 50% more survivability`,
        });
      }

      // Add checkpoint if none nearby
      const checkpoints = sceneContext.entities.filter(
        (e) => e.components.includes('checkpoint'),
      );
      if (checkpoints.length === 0) {
        fixes.push({
          issueId: issue.id,
          description: `Add checkpoint before difficult section in "${issue.affectedArea}"`,
          changes: [{
            component: 'checkpoint',
            property: 'autoSave',
            oldValue: undefined,
            newValue: true,
            command: 'spawn_entity',
          }],
          confidence: 0.8,
          estimatedImpact: `Reduce frustration by saving progress before hard sections`,
        });
      }
      break;
    }

    case 'engagement': {
      // Add collectibles to increase engagement
      const collectibles = sceneContext.entities.filter(
        (e) => e.components.includes('collectible'),
      );
      if (collectibles.length < 3) {
        fixes.push({
          issueId: issue.id,
          description: `Add more collectibles to "${issue.affectedArea}" to boost engagement`,
          changes: [{
            component: 'collectible',
            property: 'value',
            oldValue: undefined,
            newValue: 10,
            command: 'spawn_entity',
          }],
          confidence: 0.6,
          estimatedImpact: `Increase engagement through reward mechanics`,
        });
      }

      // Add visual variety with lighting changes
      fixes.push({
        issueId: issue.id,
        description: `Improve visual interest in "${issue.affectedArea}"`,
        changes: [{
          component: 'environment',
          property: 'brightness',
          oldValue: 0.3,
          newValue: 0.5,
          command: 'update_ambient_light',
        }],
        confidence: 0.5,
        estimatedImpact: `Better lighting makes scene more inviting`,
      });
      break;
    }

    case 'progression': {
      // Look for obstacles blocking progression
      const movingPlatforms = sceneContext.entities.filter(
        (e) => e.components.includes('movingPlatform'),
      );
      if (movingPlatforms.length > 0) {
        fixes.push({
          issueId: issue.id,
          description: `Slow down moving platforms to make progression easier`,
          changes: movingPlatforms.map((e) => ({
            entityId: e.id,
            component: 'game_component',
            property: 'speed',
            oldValue: (e.properties.speed as number) ?? 2,
            newValue: Math.max(0.5, ((e.properties.speed as number) ?? 2) * 0.7),
            command: 'update_game_component',
          })),
          confidence: 0.65,
          estimatedImpact: `Easier platforming sections increase completion rate`,
        });
      }

      // Add hints through trigger zones
      fixes.push({
        issueId: issue.id,
        description: `Add guidance triggers to help stuck players`,
        changes: [{
          component: 'triggerZone',
          property: 'eventName',
          oldValue: undefined,
          newValue: 'show_hint',
          command: 'spawn_entity',
        }],
        confidence: 0.55,
        estimatedImpact: `Players receive help when approaching difficult areas`,
      });
      break;
    }

    case 'balance': {
      // Adjust spawner rates
      const spawners = sceneContext.entities.filter(
        (e) => e.components.includes('spawner'),
      );
      if (spawners.length > 0) {
        fixes.push({
          issueId: issue.id,
          description: `Rebalance enemy spawner intervals`,
          changes: spawners.map((e) => ({
            entityId: e.id,
            component: 'game_component',
            property: 'intervalSecs',
            oldValue: (e.properties.intervalSecs as number) ?? 3,
            newValue: ((e.properties.intervalSecs as number) ?? 3) * 1.5,
            command: 'update_game_component',
          })),
          confidence: 0.6,
          estimatedImpact: `More breathing room between enemy spawns`,
        });
      }
      break;
    }

    case 'ux': {
      // Improve onboarding indicators
      fixes.push({
        issueId: issue.id,
        description: `Add visual indicators to guide new players`,
        changes: [{
          component: 'light',
          property: 'intensity',
          oldValue: 800,
          newValue: 1200,
          command: 'spawn_entity',
        }],
        confidence: 0.5,
        estimatedImpact: `Better visual cues help players understand objectives`,
      });
      break;
    }
  }

  return fixes;
}

// ---------------------------------------------------------------------------
// Fix application
// ---------------------------------------------------------------------------

export type CommandDispatcher = (command: string, payload: unknown) => void;

/** Game component types that should be attached after spawning an entity. */
const SPAWN_GAME_COMPONENTS: Record<string, string> = {
  checkpoint: 'Checkpoint',
  collectible: 'Collectible',
  triggerZone: 'TriggerZone',
};

/**
 * Apply selected fixes through the engine command system.
 * Returns an iteration report documenting what was changed.
 *
 * For spawn_entity changes with a game component type (checkpoint, collectible,
 * triggerZone), a follow-up add_game_component dispatch is scheduled on the
 * next animation frame so the engine has time to process the spawn and update
 * the selected entity ID.
 */
export function applyFixes(
  fixes: IssueFix[],
  dispatch: CommandDispatcher,
  iterationNumber: number,
  getSelectedEntityId?: () => string | null,
): IterationReport {
  const appliedFixes: IssueFix[] = [];
  const pendingGameComponents: Array<{ component: string; property: string; value: unknown }> = [];

  for (const fix of fixes) {
    for (const change of fix.changes) {
      if (change.command === 'spawn_entity') {
        dispatch(change.command, {
          entityType: SPAWN_ENTITY_TYPE_MAP[change.component] ?? 'cube',
          name: change.component,
        });
        // Queue game component attachment for the next frame
        const gameComponentType = SPAWN_GAME_COMPONENTS[change.component];
        if (gameComponentType) {
          pendingGameComponents.push({
            component: gameComponentType,
            property: change.property,
            value: change.newValue,
          });
        }
      } else if (change.command === 'update_ambient_light') {
        dispatch(change.command, {
          [change.property]: change.newValue,
        });
      } else {
        dispatch(change.command, {
          entityId: change.entityId,
          componentType: change.component,
          properties: { [change.property]: change.newValue },
        });
      }
    }
    appliedFixes.push(fix);
  }

  // Attach game components after the engine processes the spawns
  if (pendingGameComponents.length > 0 && getSelectedEntityId) {
    requestAnimationFrame(() => {
      for (const pending of pendingGameComponents) {
        const entityId = getSelectedEntityId();
        if (entityId) {
          dispatch('add_game_component', {
            entityId,
            componentType: pending.component,
            properties: { [pending.property]: pending.value },
          });
        }
      }
    });
  }

  const totalChanges = appliedFixes.reduce((sum, f) => sum + f.changes.length, 0);
  const summary = appliedFixes.length === 0
    ? 'No fixes applied.'
    : `Applied ${appliedFixes.length} fix${appliedFixes.length === 1 ? '' : 'es'} with ${totalChanges} change${totalChanges === 1 ? '' : 's'}.`;

  return {
    timestamp: Date.now(),
    issuesFound: [],
    fixesApplied: appliedFixes,
    iterationNumber,
    summary,
  };
}

// ---------------------------------------------------------------------------
// Severity helpers
// ---------------------------------------------------------------------------

export function severityColor(severity: IssueSeverity): string {
  switch (severity) {
    case 'critical':
      return 'text-red-400';
    case 'major':
      return 'text-yellow-400';
    case 'minor':
      return 'text-blue-400';
  }
}

export function severityLabel(severity: IssueSeverity): string {
  switch (severity) {
    case 'critical':
      return 'Critical';
    case 'major':
      return 'Major';
    case 'minor':
      return 'Minor';
  }
}

export function categoryLabel(category: IssueCategory): string {
  switch (category) {
    case 'difficulty':
      return 'Difficulty';
    case 'engagement':
      return 'Engagement';
    case 'progression':
      return 'Progression';
    case 'balance':
      return 'Balance';
    case 'ux':
      return 'UX';
  }
}
