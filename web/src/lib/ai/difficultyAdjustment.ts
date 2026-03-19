/**
 * Dynamic Difficulty Adjustment (DDA) system.
 *
 * Pure functions that analyse player performance metrics and produce
 * updated difficulty profiles.  The module is runtime-agnostic — it
 * never touches DOM, React state, or engine internals.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DifficultyProfile {
  level: number;
  enemyHealthMultiplier: number;
  enemyDamageMultiplier: number;
  enemySpeedMultiplier: number;
  resourceDropRate: number;
  checkpointFrequency: number;
  hintDelay: number;
}

export interface PlayerPerformance {
  deathsPerMinute: number;
  averageHealthOnDeath: number;
  timePerLevel: number;
  itemUsageRate: number;
  skillRating: number;
}

export interface DDAConfig {
  enabled: boolean;
  sensitivity: number;
  minDifficulty: number;
  maxDifficulty: number;
  adjustmentSpeed: number;
  cooldownSeconds: number;
  /** When true, difficulty only increases — never decreases (competitive mode) */
  neverDecrease?: boolean;
}

export interface EngineCommand {
  cmd: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

export const DDA_PRESETS: Record<string, DDAConfig> = {
  gentle: {
    enabled: true,
    sensitivity: 0.3,
    minDifficulty: 0.2,
    maxDifficulty: 0.8,
    adjustmentSpeed: 0.05,
    cooldownSeconds: 30,
  },
  standard: {
    enabled: true,
    sensitivity: 0.5,
    minDifficulty: 0.3,
    maxDifficulty: 1.0,
    adjustmentSpeed: 0.1,
    cooldownSeconds: 15,
  },
  hardcore: {
    enabled: true,
    sensitivity: 0.8,
    minDifficulty: 0.6,
    maxDifficulty: 1.0,
    adjustmentSpeed: 0.15,
    cooldownSeconds: 5,
  },
  adaptive_story: {
    enabled: true,
    sensitivity: 0.6,
    minDifficulty: 0.1,
    maxDifficulty: 0.7,
    adjustmentSpeed: 0.12,
    cooldownSeconds: 20,
  },
  competitive: {
    enabled: true,
    sensitivity: 0.7,
    minDifficulty: 0.5,
    maxDifficulty: 1.0,
    adjustmentSpeed: 0.08,
    cooldownSeconds: 10,
    neverDecrease: true,
  },
};

// ---------------------------------------------------------------------------
// Default profile
// ---------------------------------------------------------------------------

export function createDefaultProfile(): DifficultyProfile {
  return {
    level: 0.5,
    enemyHealthMultiplier: 1.0,
    enemyDamageMultiplier: 1.0,
    enemySpeedMultiplier: 1.0,
    resourceDropRate: 1.0,
    checkpointFrequency: 1.0,
    hintDelay: 5.0,
  };
}

// ---------------------------------------------------------------------------
// Skill rating
// ---------------------------------------------------------------------------

/**
 * Map raw performance metrics to a 0-100 skill rating.
 *
 * Higher deaths and longer times reduce the rating; higher item usage
 * and higher health-on-death increase it.
 */
export function performanceToSkillRating(performance: PlayerPerformance): number {
  // Death penalty: each death/minute lowers score significantly
  const deathScore = Math.max(0, 100 - performance.deathsPerMinute * 40);

  // Health-on-death: dying at high health => less skilled (rushed in),
  // dying at low health => fought hard.  Invert so low health => higher.
  const healthScore = Math.max(0, 100 - performance.averageHealthOnDeath);

  // Speed bonus: faster level completion indicates skill (cap at 5 min baseline)
  const timeBaseline = 300; // seconds
  const speedScore = Math.min(100, (timeBaseline / Math.max(1, performance.timePerLevel)) * 50);

  // Item efficiency: using more items may mean struggling (0-1 rate)
  const itemScore = Math.max(0, 100 - performance.itemUsageRate * 60);

  const raw = deathScore * 0.35 + healthScore * 0.15 + speedScore * 0.3 + itemScore * 0.2;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

// ---------------------------------------------------------------------------
// Difficulty calculation
// ---------------------------------------------------------------------------

/**
 * Pure function: given current performance and profile, return an
 * adjusted difficulty profile.
 *
 * For the `competitive` preset the difficulty never decreases — the
 * `adjustmentSpeed` is clamped to >= 0 when performance suggests easing.
 */
export function calculateDifficultyAdjustment(
  performance: PlayerPerformance,
  currentProfile: DifficultyProfile,
  config: DDAConfig,
): DifficultyProfile {
  if (!config.enabled) {
    return { ...currentProfile };
  }

  const skill = performanceToSkillRating(performance);

  // Target difficulty is a normalised version of skill (0-1)
  const targetDifficulty = skill / 100;

  // Delta between where we want to be and where we are
  const delta = targetDifficulty - currentProfile.level;

  // Competitive mode: difficulty only increases, never decreases
  const effectiveDelta = config.neverDecrease ? Math.max(0, delta) : delta;

  // Apply adjustment speed and sensitivity
  const adjustment = effectiveDelta * config.adjustmentSpeed * config.sensitivity;

  // Clamp new level
  const newLevel = Math.max(
    config.minDifficulty,
    Math.min(config.maxDifficulty, currentProfile.level + adjustment),
  );

  // Derive multipliers from the normalised level
  return {
    level: Number(newLevel.toFixed(4)),
    enemyHealthMultiplier: Number((0.5 + newLevel * 1.0).toFixed(4)),
    enemyDamageMultiplier: Number((0.5 + newLevel * 1.0).toFixed(4)),
    enemySpeedMultiplier: Number((0.7 + newLevel * 0.6).toFixed(4)),
    resourceDropRate: Number((1.5 - newLevel * 1.0).toFixed(4)),
    checkpointFrequency: Number((1.5 - newLevel * 1.0).toFixed(4)),
    hintDelay: Number((2.0 + newLevel * 8.0).toFixed(4)),
  };
}

// ---------------------------------------------------------------------------
// Engine command generation
// ---------------------------------------------------------------------------

/**
 * Convert a difficulty profile into engine commands that can be
 * dispatched to game component entities (e.g. enemies, pickups).
 */
export function difficultyToCommands(
  profile: DifficultyProfile,
  entityIds: string[],
): EngineCommand[] {
  return entityIds.map((entityId) => ({
    cmd: 'update_game_component',
    entityId,
    properties: {
      healthMultiplier: profile.enemyHealthMultiplier,
      damageMultiplier: profile.enemyDamageMultiplier,
      speedMultiplier: profile.enemySpeedMultiplier,
    },
  }));
}

// ---------------------------------------------------------------------------
// Runtime script generation
// ---------------------------------------------------------------------------

/**
 * Generate a self-contained forge.* script that performs DDA at runtime.
 *
 * The script tracks deaths and level completion time within the worker,
 * periodically recalculates difficulty, and issues engine commands.
 */
export function generateDDAScript(config: DDAConfig): string {
  return `// Dynamic Difficulty Adjustment — auto-generated
// Preset: sensitivity=${config.sensitivity}, range=[${config.minDifficulty}, ${config.maxDifficulty}]

const DDA_CONFIG = ${JSON.stringify(config, null, 2)};

let currentLevel = 0.5;
let deaths = 0;
let levelStartTime = 0;
let lastAdjustTime = 0;

function onStart() {
  levelStartTime = forge.time.elapsed;
  lastAdjustTime = levelStartTime;
  deaths = 0;
}

function onUpdate(dt) {
  if (!DDA_CONFIG.enabled) return;

  const now = forge.time.elapsed;
  const elapsed = now - lastAdjustTime;
  if (elapsed < DDA_CONFIG.cooldownSeconds) return;
  lastAdjustTime = now;

  const minutesPlayed = Math.max(0.01, (now - levelStartTime) / 60);
  const deathsPerMinute = deaths / minutesPlayed;

  // Simple skill estimate: fewer deaths => higher skill
  const skill = Math.max(0, Math.min(100, 100 - deathsPerMinute * 40));
  const target = skill / 100;
  const delta = target - currentLevel;
  const adjustment = delta * DDA_CONFIG.adjustmentSpeed * DDA_CONFIG.sensitivity;

  currentLevel = Math.max(
    DDA_CONFIG.minDifficulty,
    Math.min(DDA_CONFIG.maxDifficulty, currentLevel + adjustment)
  );

  // Apply multipliers via HUD so the player can see the current difficulty
  forge.ui.setText('dda-level', 'Difficulty: ' + Math.round(currentLevel * 100) + '%');
}

// Hook into the collision system to detect player deaths
const playerIds = forge.scene.findByName('Player');
if (playerIds.length > 0) {
  forge.physics.onCollisionEnter(playerIds[0], (otherId) => {
    // Increment death counter when player collides with a hazard
    const name = (forge.scene.getEntityName(otherId) || '').toLowerCase();
    if (name.includes('damage') || name.includes('hazard') || name.includes('spike') || name.includes('lava')) {
      deaths++;
    }
  });
}
`;
}
