/**
 * Physics feel profiler — auto-tune game physics to match a target genre feel.
 *
 * Provides 8 built-in presets (floaty platformer, snappy platformer, weighty RPG, etc.),
 * analysis of current physics settings, profile blending, and AI-powered custom profile generation.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PhysicsProfile {
  name: string;
  description: string;
  gravity: number;
  jumpForce: number;
  moveSpeed: number;
  friction: number;
  restitution: number;
  airControl: number;
  terminalVelocity: number;
  acceleration: number;
  deceleration: number;
}

export interface PhysicsAnalysis {
  currentFeel: string;
  closestPreset: string;
  similarity: number;
  suggestions: string[];
}

/** Minimal scene context subset needed for analysis. */
export interface PhysicsSceneContext {
  entities: Array<{
    entityId: string;
    physics?: {
      gravityScale: number;
      friction: number;
    } | null;
    gameComponents?: Array<{
      type: string;
      characterController?: {
        speed: number;
        jumpHeight: number;
        gravityScale: number;
      };
    }>;
  }>;
}

/** A dispatcher that can send engine commands. */
export type CommandDispatcher = (command: string, payload: unknown) => void;

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

export const PHYSICS_PRESETS: Record<string, PhysicsProfile> = {
  platformer_floaty: {
    name: 'Floaty Platformer',
    description: 'Low gravity, high air control — like Celeste or Ori.',
    gravity: 5,
    jumpForce: 8,
    moveSpeed: 6,
    friction: 0.3,
    restitution: 0.1,
    airControl: 0.9,
    terminalVelocity: 15,
    acceleration: 20,
    deceleration: 15,
  },
  platformer_snappy: {
    name: 'Snappy Platformer',
    description: 'Medium gravity, instant acceleration — like Super Meat Boy.',
    gravity: 15,
    jumpForce: 14,
    moveSpeed: 10,
    friction: 0.5,
    restitution: 0.05,
    airControl: 0.7,
    terminalVelocity: 30,
    acceleration: 100,
    deceleration: 100,
  },
  rpg_weighty: {
    name: 'Weighty Action RPG',
    description: 'High gravity, slow acceleration, momentum-based — like Dark Souls.',
    gravity: 20,
    jumpForce: 12,
    moveSpeed: 4,
    friction: 0.6,
    restitution: 0.1,
    airControl: 0.2,
    terminalVelocity: 25,
    acceleration: 8,
    deceleration: 6,
  },
  arcade_classic: {
    name: 'Classic Arcade',
    description: 'Medium gravity, instant direction changes — like Pac-Man or Mega Man.',
    gravity: 10,
    jumpForce: 10,
    moveSpeed: 7,
    friction: 0.4,
    restitution: 0.3,
    airControl: 0.5,
    terminalVelocity: 20,
    acceleration: 50,
    deceleration: 50,
  },
  space_zero_g: {
    name: 'Zero Gravity / Space',
    description: 'Near-zero gravity, full air control, drift physics — like Asteroids.',
    gravity: 0.5,
    jumpForce: 3,
    moveSpeed: 5,
    friction: 0.05,
    restitution: 0.8,
    airControl: 1.0,
    terminalVelocity: 50,
    acceleration: 10,
    deceleration: 2,
  },
  underwater: {
    name: 'Underwater',
    description: 'Low gravity, high friction, slow movement — like Ecco the Dolphin.',
    gravity: 3,
    jumpForce: 5,
    moveSpeed: 3,
    friction: 0.8,
    restitution: 0.05,
    airControl: 0.8,
    terminalVelocity: 8,
    acceleration: 12,
    deceleration: 18,
  },
  racing: {
    name: 'Racing',
    description: 'No gravity effect on gameplay, high speed, low friction — like racing games.',
    gravity: 10,
    jumpForce: 0,
    moveSpeed: 30,
    friction: 0.15,
    restitution: 0.2,
    airControl: 0.1,
    terminalVelocity: 60,
    acceleration: 25,
    deceleration: 10,
  },
  puzzle_precise: {
    name: 'Precise Puzzle',
    description: 'Medium gravity, instant stop, pixel-perfect control — like Baba Is You.',
    gravity: 10,
    jumpForce: 8,
    moveSpeed: 5,
    friction: 0.9,
    restitution: 0.0,
    airControl: 0.6,
    terminalVelocity: 15,
    acceleration: 80,
    deceleration: 80,
  },
};

export const PRESET_KEYS = Object.keys(PHYSICS_PRESETS) as Array<keyof typeof PHYSICS_PRESETS>;

// ---------------------------------------------------------------------------
// Profile parameters used for distance calculations
// ---------------------------------------------------------------------------

const PROFILE_FIELDS: (keyof PhysicsProfile)[] = [
  'gravity',
  'jumpForce',
  'moveSpeed',
  'friction',
  'airControl',
  'terminalVelocity',
  'acceleration',
  'deceleration',
];

/**
 * Normalization ranges for each parameter used in distance calculations.
 * Range = typical max value for the field, used to normalize to 0-1 scale.
 */
const NORMALIZATION_RANGES: Record<string, number> = {
  gravity: 25,
  jumpForce: 20,
  moveSpeed: 35,
  friction: 1,
  airControl: 1,
  terminalVelocity: 60,
  acceleration: 100,
  deceleration: 100,
};

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

/**
 * Weights for each parameter in distance calculations.
 * Observable parameters (gravity, friction, moveSpeed, jumpForce) are weighted higher
 * because they are directly readable from the scene. Inferred parameters (airControl,
 * acceleration, deceleration, terminalVelocity) use defaults and are weighted lower.
 */
const PARAMETER_WEIGHTS: Record<string, number> = {
  gravity: 3,
  jumpForce: 2,
  moveSpeed: 2,
  friction: 3,
  airControl: 1,
  terminalVelocity: 1,
  acceleration: 1,
  deceleration: 1,
};

/** Compute weighted normalized Euclidean distance between two profiles (0 = identical). */
function profileDistance(a: PhysicsProfile, b: PhysicsProfile): number {
  let sumSq = 0;
  let totalWeight = 0;
  for (const field of PROFILE_FIELDS) {
    const va = a[field] as number;
    const vb = b[field] as number;
    const range = NORMALIZATION_RANGES[field] ?? 1;
    const weight = PARAMETER_WEIGHTS[field] ?? 1;
    const diff = (va - vb) / range;
    sumSq += weight * diff * diff;
    totalWeight += weight;
  }
  return Math.sqrt(sumSq / totalWeight);
}

/** Convert distance to a 0-1 similarity score. */
function distanceToSimilarity(dist: number): number {
  // Use exponential decay so small differences still read as "high similarity"
  return Math.max(0, Math.min(1, Math.exp(-dist * 3)));
}

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Interpolate (blend) between two physics profiles.
 * @param a - First profile
 * @param b - Second profile
 * @param t - Blend factor: 0 = fully a, 1 = fully b
 */
export function interpolateProfiles(
  a: PhysicsProfile,
  b: PhysicsProfile,
  t: number,
): PhysicsProfile {
  const clampedT = Math.max(0, Math.min(1, t));
  const lerp = (va: number, vb: number) => va + (vb - va) * clampedT;

  return {
    name: clampedT < 0.5 ? a.name : b.name,
    description:
      clampedT === 0
        ? a.description
        : clampedT === 1
          ? b.description
          : `Blend of ${a.name} and ${b.name}`,
    gravity: lerp(a.gravity, b.gravity),
    jumpForce: lerp(a.jumpForce, b.jumpForce),
    moveSpeed: lerp(a.moveSpeed, b.moveSpeed),
    friction: lerp(a.friction, b.friction),
    restitution: lerp(a.restitution, b.restitution),
    airControl: lerp(a.airControl, b.airControl),
    terminalVelocity: lerp(a.terminalVelocity, b.terminalVelocity),
    acceleration: lerp(a.acceleration, b.acceleration),
    deceleration: lerp(a.deceleration, b.deceleration),
  };
}

/**
 * Analyze current scene physics and classify the feel.
 * Extracts physics properties from entities that have physics and/or game components,
 * then compares against known presets.
 */
export function analyzePhysicsFeel(ctx: PhysicsSceneContext): PhysicsAnalysis {
  // Extract an average "virtual profile" from the scene
  let frictionSum = 0;
  let speedSum = 0;
  let jumpSum = 0;
  let gravityScaleSum = 0;
  let count = 0;

  for (const entity of ctx.entities) {
    if (entity.physics) {
      gravityScaleSum += entity.physics.gravityScale;
      frictionSum += entity.physics.friction;
      count++;
    }
    if (entity.gameComponents) {
      for (const gc of entity.gameComponents) {
        if (gc.type === 'characterController' && gc.characterController) {
          speedSum += gc.characterController.speed;
          jumpSum += gc.characterController.jumpHeight;
        }
      }
    }
  }

  // Build a virtual profile from scene data (fall back to arcade defaults)
  const avgGravityScale = count > 0 ? gravityScaleSum / count : 1;
  const avgFriction = count > 0 ? frictionSum / count : 0.4;
  const avgSpeed = speedSum > 0 ? speedSum : 7;
  const avgJump = jumpSum > 0 ? jumpSum : 10;
  const absGravity = avgGravityScale * 10; // Convert scale to absolute

  // Infer non-observable parameters from observable ones for better classification.
  // Low gravity -> high air control, low terminal velocity. High friction -> high deceleration.
  const inferredAirControl = Math.max(0, Math.min(1, 1 - absGravity / 25));
  const inferredTerminalVelocity = 10 + absGravity * 1.5;
  const inferredAcceleration = avgFriction > 0.6 ? 70 : avgFriction < 0.2 ? 15 : 40;
  const inferredDeceleration = avgFriction > 0.6 ? 70 : avgFriction < 0.2 ? 5 : 40;

  const virtualProfile: PhysicsProfile = {
    name: 'Current Scene',
    description: 'Derived from scene entities',
    gravity: absGravity,
    jumpForce: avgJump,
    moveSpeed: avgSpeed,
    friction: avgFriction,
    restitution: 0.3,
    airControl: inferredAirControl,
    terminalVelocity: inferredTerminalVelocity,
    acceleration: inferredAcceleration,
    deceleration: inferredDeceleration,
  };

  // Find closest preset
  let closestKey = PRESET_KEYS[0];
  let closestDist = Infinity;

  for (const key of PRESET_KEYS) {
    const dist = profileDistance(virtualProfile, PHYSICS_PRESETS[key]);
    if (dist < closestDist) {
      closestDist = dist;
      closestKey = key;
    }
  }

  const similarity = distanceToSimilarity(closestDist);
  const closestPreset = PHYSICS_PRESETS[closestKey];

  // Generate suggestions
  const suggestions: string[] = [];

  if (count === 0) {
    suggestions.push('No physics entities found. Add physics components to entities to get meaningful analysis.');
  }

  if (virtualProfile.gravity < 3) {
    suggestions.push('Gravity is very low. Consider increasing for more grounded gameplay, or embrace the floaty feel for space/underwater themes.');
  }
  if (virtualProfile.gravity > 18) {
    suggestions.push('Gravity is very high. Characters may feel sluggish. Consider reducing for more responsive movement.');
  }
  if (virtualProfile.friction > 0.7) {
    suggestions.push('High friction detected. Movement may feel "sticky". Lower friction for smoother sliding.');
  }
  if (virtualProfile.friction < 0.1) {
    suggestions.push('Very low friction. Characters will slide on surfaces. Increase friction for tighter control.');
  }
  if (virtualProfile.moveSpeed > 20) {
    suggestions.push('High move speed. Ensure your level design accounts for fast traversal.');
  }

  return {
    currentFeel: closestPreset.name,
    closestPreset: closestKey,
    similarity,
    suggestions,
  };
}

/**
 * Apply a physics profile to all physics entities in the scene via dispatch commands.
 * Updates gravity scale and friction on physics-enabled entities, and character controller
 * properties on entities with that game component.
 */
export function applyPhysicsProfile(
  profile: PhysicsProfile,
  dispatch: CommandDispatcher,
  entityIds: string[],
): void {
  // Convert absolute gravity to gravity scale (relative to default ~10)
  const gravityScale = profile.gravity / 10;

  for (const entityId of entityIds) {
    dispatch('update_physics', {
      entityId,
      gravityScale,
      friction: profile.friction,
      restitution: profile.restitution,
    });

    dispatch('update_game_component', {
      entityId,
      componentType: 'character_controller',
      speed: profile.moveSpeed,
      jumpHeight: profile.jumpForce,
      gravityScale,
    });
  }
}

/**
 * Generate a custom physics profile from a natural-language description.
 * Uses heuristic keyword matching for deterministic output.
 * Returns a profile tuned to the description.
 */
export function generateCustomProfile(description: string): PhysicsProfile {
  const lower = description.toLowerCase();

  // Start from arcade_classic as a balanced baseline
  const base = { ...PHYSICS_PRESETS.arcade_classic };

  // Keyword modifiers
  if (lower.includes('floaty') || lower.includes('float') || lower.includes('moon')) {
    base.gravity = 4;
    base.airControl = 0.9;
    base.terminalVelocity = 12;
  }
  if (lower.includes('heavy') || lower.includes('weighty') || lower.includes('tank')) {
    base.gravity = 22;
    base.acceleration = 6;
    base.deceleration = 4;
    base.airControl = 0.15;
  }
  if (lower.includes('fast') || lower.includes('speed') || lower.includes('sonic')) {
    base.moveSpeed = 25;
    base.acceleration = 60;
    base.terminalVelocity = 50;
  }
  if (lower.includes('slow') || lower.includes('methodical') || lower.includes('careful')) {
    base.moveSpeed = 3;
    base.acceleration = 10;
  }
  if (lower.includes('snappy') || lower.includes('responsive') || lower.includes('tight')) {
    base.acceleration = 100;
    base.deceleration = 100;
    base.airControl = 0.7;
  }
  if (lower.includes('slippery') || lower.includes('ice') || lower.includes('slide')) {
    base.friction = 0.05;
    base.deceleration = 3;
  }
  if (lower.includes('sticky') || lower.includes('precise') || lower.includes('grid')) {
    base.friction = 0.9;
    base.deceleration = 80;
    base.acceleration = 80;
  }
  if (lower.includes('space') || lower.includes('zero') || lower.includes('drift')) {
    base.gravity = 0.5;
    base.friction = 0.05;
    base.airControl = 1.0;
    base.terminalVelocity = 50;
  }
  if (lower.includes('water') || lower.includes('swim') || lower.includes('underwater')) {
    base.gravity = 3;
    base.friction = 0.8;
    base.moveSpeed = 3;
    base.terminalVelocity = 8;
  }
  if (lower.includes('bouncy') || lower.includes('spring') || lower.includes('trampoline')) {
    base.jumpForce = 18;
    base.gravity = 8;
  }
  if (lower.includes('no jump') || lower.includes('racing') || lower.includes('vehicle')) {
    base.jumpForce = 0;
    base.moveSpeed = 30;
    base.friction = 0.15;
  }

  base.name = 'Custom';
  base.description = description;

  return base;
}
