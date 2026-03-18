/**
 * Procedural animation generation system.
 *
 * Generates walk, run, idle, jump, attack, and other animation types
 * algorithmically from skeleton bone names. Outputs can be converted to
 * the engine's AnimationClipData format for playback.
 */

import type { AnimationClipData, AnimationTrack, AnimationKeyframe as ClipKeyframe } from '@/stores/slices/types';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type AnimationType =
  | 'walk'
  | 'run'
  | 'idle'
  | 'jump'
  | 'attack_melee'
  | 'attack_ranged'
  | 'death'
  | 'hit_react'
  | 'climb'
  | 'swim';

export const ANIMATION_TYPES: readonly AnimationType[] = [
  'walk', 'run', 'idle', 'jump', 'attack_melee', 'attack_ranged',
  'death', 'hit_react', 'climb', 'swim',
] as const;

export interface BoneRotation {
  x: number;
  y: number;
  z: number;
}

export interface ProceduralKeyframe {
  /** Normalised time in [0, 1] */
  time: number;
  boneRotations: Record<string, BoneRotation>;
}

export interface ProceduralAnimation {
  name: string;
  type: AnimationType;
  /** Duration in seconds */
  duration: number;
  loop: boolean;
  keyframes: ProceduralKeyframe[];
  /** Blend-in time in seconds */
  blendIn: number;
  /** Blend-out time in seconds */
  blendOut: number;
}

export interface AnimationParams {
  /** Playback speed multiplier (default 1) */
  speed: number;
  /** Movement amplitude multiplier (default 1) */
  amplitude: number;
  /** Visual style hint */
  style: 'realistic' | 'cartoon' | 'mechanical' | 'ethereal';
  /** Blend weight when layering (0-1) */
  weight: number;
}

// ---------------------------------------------------------------------------
// Bone classification helpers
// ---------------------------------------------------------------------------

/** Known bone role keywords used to classify generic bone names. */
const BONE_ROLES = {
  leftLeg: ['left_leg', 'left_thigh', 'l_leg', 'l_thigh', 'leftleg', 'leftupperleg'],
  rightLeg: ['right_leg', 'right_thigh', 'r_leg', 'r_thigh', 'rightleg', 'rightupperleg'],
  leftShin: ['left_shin', 'left_calf', 'l_shin', 'l_calf', 'leftshin', 'leftlowerleg'],
  rightShin: ['right_shin', 'right_calf', 'r_shin', 'r_calf', 'rightshin', 'rightlowerleg'],
  leftFoot: ['left_foot', 'l_foot', 'leftfoot'],
  rightFoot: ['right_foot', 'r_foot', 'rightfoot'],
  leftArm: ['left_arm', 'left_upper_arm', 'l_arm', 'l_upper_arm', 'leftarm', 'leftupperarm'],
  rightArm: ['right_arm', 'right_upper_arm', 'r_arm', 'r_upper_arm', 'rightarm', 'rightupperarm'],
  leftForearm: ['left_forearm', 'left_lower_arm', 'l_forearm', 'leftforearm', 'leftlowerarm'],
  rightForearm: ['right_forearm', 'right_lower_arm', 'r_forearm', 'rightforearm', 'rightlowerarm'],
  leftHand: ['left_hand', 'l_hand', 'lefthand'],
  rightHand: ['right_hand', 'r_hand', 'righthand'],
  spine: ['spine', 'torso', 'chest', 'upper_body'],
  hips: ['hips', 'pelvis', 'root'],
  head: ['head', 'skull'],
  neck: ['neck'],
} as const;

type BoneRole = keyof typeof BONE_ROLES;

export function classifyBones(boneNames: string[]): Record<BoneRole, string | null> {
  const result: Record<string, string | null> = {};
  for (const role of Object.keys(BONE_ROLES) as BoneRole[]) {
    result[role] = null;
  }

  for (const name of boneNames) {
    const lower = name.toLowerCase();
    for (const [role, keywords] of Object.entries(BONE_ROLES)) {
      if (result[role] !== null) continue;
      for (const kw of keywords) {
        if (lower.includes(kw) || lower === kw) {
          result[role] = name;
          break;
        }
      }
    }
  }

  return result as Record<BoneRole, string | null>;
}

// ---------------------------------------------------------------------------
// Style modifiers
// ---------------------------------------------------------------------------

function styleMultiplier(style: AnimationParams['style']): { amp: number; sharpness: number } {
  switch (style) {
    case 'cartoon': return { amp: 1.4, sharpness: 1.3 };
    case 'mechanical': return { amp: 0.7, sharpness: 0.5 };
    case 'ethereal': return { amp: 0.6, sharpness: 0.8 };
    case 'realistic':
    default: return { amp: 1.0, sharpness: 1.0 };
  }
}

function rot(x: number, y: number, z: number): BoneRotation {
  return { x, y, z };
}

// ---------------------------------------------------------------------------
// Walk template — 8 keyframes per cycle
// ---------------------------------------------------------------------------

function generateWalkKeyframes(
  bones: Record<BoneRole, string | null>,
  amp: number,
  sharpness: number,
): ProceduralKeyframe[] {
  const s = sharpness;
  const a = amp;

  // 8 evenly spaced keyframes over one cycle
  const frames: ProceduralKeyframe[] = [];
  const steps = 8;

  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    const phase = t * Math.PI * 2;
    const sin = Math.sin(phase);
    const cos = Math.cos(phase);

    const rotations: Record<string, BoneRotation> = {};

    // Legs alternate
    if (bones.leftLeg) rotations[bones.leftLeg] = rot(sin * 25 * a * s, 0, 0);
    if (bones.rightLeg) rotations[bones.rightLeg] = rot(-sin * 25 * a * s, 0, 0);
    if (bones.leftShin) rotations[bones.leftShin] = rot(Math.max(0, -sin) * 30 * a * s, 0, 0);
    if (bones.rightShin) rotations[bones.rightShin] = rot(Math.max(0, sin) * 30 * a * s, 0, 0);
    if (bones.leftFoot) rotations[bones.leftFoot] = rot(sin * 8 * a, 0, 0);
    if (bones.rightFoot) rotations[bones.rightFoot] = rot(-sin * 8 * a, 0, 0);

    // Arm counterswing
    if (bones.leftArm) rotations[bones.leftArm] = rot(-sin * 18 * a * s, 0, 0);
    if (bones.rightArm) rotations[bones.rightArm] = rot(sin * 18 * a * s, 0, 0);
    if (bones.leftForearm) rotations[bones.leftForearm] = rot(-12 * a, 0, 0);
    if (bones.rightForearm) rotations[bones.rightForearm] = rot(-12 * a, 0, 0);

    // Torso bob
    if (bones.spine) rotations[bones.spine] = rot(0, sin * 3 * a, cos * 2 * a);
    if (bones.hips) rotations[bones.hips] = rot(0, -sin * 2 * a, 0);
    if (bones.head) rotations[bones.head] = rot(0, sin * 1.5 * a, 0);

    frames.push({ time: t, boneRotations: rotations });
  }

  return frames;
}

// ---------------------------------------------------------------------------
// Run template
// ---------------------------------------------------------------------------

function generateRunKeyframes(
  bones: Record<BoneRole, string | null>,
  amp: number,
  sharpness: number,
): ProceduralKeyframe[] {
  const s = sharpness;
  const a = amp;
  const frames: ProceduralKeyframe[] = [];
  const steps = 8;

  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    const phase = t * Math.PI * 2;
    const sin = Math.sin(phase);
    const cos = Math.cos(phase);

    const rotations: Record<string, BoneRotation> = {};

    if (bones.leftLeg) rotations[bones.leftLeg] = rot(sin * 40 * a * s, 0, 0);
    if (bones.rightLeg) rotations[bones.rightLeg] = rot(-sin * 40 * a * s, 0, 0);
    if (bones.leftShin) rotations[bones.leftShin] = rot(Math.max(0, -sin) * 50 * a * s, 0, 0);
    if (bones.rightShin) rotations[bones.rightShin] = rot(Math.max(0, sin) * 50 * a * s, 0, 0);
    if (bones.leftFoot) rotations[bones.leftFoot] = rot(sin * 12 * a, 0, 0);
    if (bones.rightFoot) rotations[bones.rightFoot] = rot(-sin * 12 * a, 0, 0);

    // Wider arm swing
    if (bones.leftArm) rotations[bones.leftArm] = rot(-sin * 30 * a * s, 0, sin * 5 * a);
    if (bones.rightArm) rotations[bones.rightArm] = rot(sin * 30 * a * s, 0, -sin * 5 * a);
    if (bones.leftForearm) rotations[bones.leftForearm] = rot(-25 * a, 0, 0);
    if (bones.rightForearm) rotations[bones.rightForearm] = rot(-25 * a, 0, 0);

    // Forward lean + bounce
    if (bones.spine) rotations[bones.spine] = rot(-8 * a, sin * 5 * a, cos * 3 * a);
    if (bones.hips) rotations[bones.hips] = rot(0, -sin * 4 * a, 0);
    if (bones.head) rotations[bones.head] = rot(5 * a, sin * 2 * a, 0);

    frames.push({ time: t, boneRotations: rotations });
  }

  return frames;
}

// ---------------------------------------------------------------------------
// Idle template — subtle breathing and weight shift
// ---------------------------------------------------------------------------

function generateIdleKeyframes(
  bones: Record<BoneRole, string | null>,
  amp: number,
  _sharpness: number,
): ProceduralKeyframe[] {
  const a = amp;
  const frames: ProceduralKeyframe[] = [];
  const steps = 8;

  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    const phase = t * Math.PI * 2;
    const sin = Math.sin(phase);
    const cos = Math.cos(phase);

    const rotations: Record<string, BoneRotation> = {};

    // Breathing
    if (bones.spine) rotations[bones.spine] = rot(sin * 1.5 * a, 0, cos * 0.5 * a);
    if (bones.hips) rotations[bones.hips] = rot(0, sin * 0.8 * a, 0);
    if (bones.head) rotations[bones.head] = rot(sin * 1 * a, cos * 2 * a, 0);

    // Slight arm sway
    if (bones.leftArm) rotations[bones.leftArm] = rot(0, 0, sin * 1 * a);
    if (bones.rightArm) rotations[bones.rightArm] = rot(0, 0, -sin * 1 * a);

    frames.push({ time: t, boneRotations: rotations });
  }

  return frames;
}

// ---------------------------------------------------------------------------
// Jump template — 8 keyframes: crouch -> launch -> air -> land -> recover
// ---------------------------------------------------------------------------

function generateJumpKeyframes(
  bones: Record<BoneRole, string | null>,
  amp: number,
  _sharpness: number,
): ProceduralKeyframe[] {
  const a = amp;
  // Fixed phases: crouch, launch, rise, peak, fall, land, absorb, recover
  const phases = [0, 0.1, 0.2, 0.35, 0.5, 0.65, 0.8, 0.95];
  const legAngles = [-20, -35, 10, 5, 0, -15, -25, -5]; // knee flex pattern
  const spineAngles = [-5, -10, 5, 3, 0, -8, -10, 0]; // spine lean
  const armAngles = [0, -30, -60, -45, -20, 10, 5, 0]; // arms up on launch

  return phases.map((t, i) => {
    const rotations: Record<string, BoneRotation> = {};

    if (bones.leftLeg) rotations[bones.leftLeg] = rot(legAngles[i] * a, 0, 0);
    if (bones.rightLeg) rotations[bones.rightLeg] = rot(legAngles[i] * a, 0, 0);
    if (bones.leftShin) rotations[bones.leftShin] = rot(Math.max(0, -legAngles[i]) * 1.2 * a, 0, 0);
    if (bones.rightShin) rotations[bones.rightShin] = rot(Math.max(0, -legAngles[i]) * 1.2 * a, 0, 0);
    if (bones.spine) rotations[bones.spine] = rot(spineAngles[i] * a, 0, 0);
    if (bones.leftArm) rotations[bones.leftArm] = rot(armAngles[i] * a, 0, -15 * a);
    if (bones.rightArm) rotations[bones.rightArm] = rot(armAngles[i] * a, 0, 15 * a);
    if (bones.head) rotations[bones.head] = rot(-spineAngles[i] * 0.3 * a, 0, 0);

    return { time: t, boneRotations: rotations };
  });
}

// ---------------------------------------------------------------------------
// Attack melee — wind-up -> swing -> follow-through -> return
// ---------------------------------------------------------------------------

function generateAttackMeleeKeyframes(
  bones: Record<BoneRole, string | null>,
  amp: number,
  sharpness: number,
): ProceduralKeyframe[] {
  const a = amp;
  const s = sharpness;
  const phases = [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.85, 1.0];
  // Wind-up then fast swing
  const rightArmX = [0, -40, -60, 30, 50, 20, 5, 0];
  const rightArmY = [0, -20, -30, 10, 30, 15, 5, 0];
  const spineY = [0, -15, -25, 20, 30, 10, 0, 0];

  return phases.map((t, i) => {
    const rotations: Record<string, BoneRotation> = {};

    if (bones.rightArm) rotations[bones.rightArm] = rot(rightArmX[i] * a * s, rightArmY[i] * a * s, 0);
    if (bones.rightForearm) rotations[bones.rightForearm] = rot(rightArmX[i] * 0.5 * a, 0, 0);
    if (bones.leftArm) rotations[bones.leftArm] = rot(-rightArmX[i] * 0.2 * a, 0, 0);
    if (bones.spine) rotations[bones.spine] = rot(0, spineY[i] * a * s, 0);
    if (bones.hips) rotations[bones.hips] = rot(0, -spineY[i] * 0.3 * a, 0);
    if (bones.leftLeg) rotations[bones.leftLeg] = rot(-5 * a, 0, 0);
    if (bones.rightLeg) rotations[bones.rightLeg] = rot(5 * a, 0, 0);

    return { time: t, boneRotations: rotations };
  });
}

// ---------------------------------------------------------------------------
// Attack ranged — draw -> aim -> release -> follow-through
// ---------------------------------------------------------------------------

function generateAttackRangedKeyframes(
  bones: Record<BoneRole, string | null>,
  amp: number,
  _sharpness: number,
): ProceduralKeyframe[] {
  const a = amp;
  const phases = [0, 0.2, 0.4, 0.5, 0.6, 0.7, 0.85, 1.0];
  const rightArmX = [0, -30, -50, -55, -20, 10, 5, 0];
  const leftArmX = [0, -20, -40, -45, -15, 5, 0, 0];

  return phases.map((t, i) => {
    const rotations: Record<string, BoneRotation> = {};

    if (bones.rightArm) rotations[bones.rightArm] = rot(rightArmX[i] * a, 0, -10 * a);
    if (bones.leftArm) rotations[bones.leftArm] = rot(leftArmX[i] * a, 0, 10 * a);
    if (bones.rightForearm) rotations[bones.rightForearm] = rot(rightArmX[i] * 0.6 * a, 0, 0);
    if (bones.leftForearm) rotations[bones.leftForearm] = rot(leftArmX[i] * 0.6 * a, 0, 0);
    if (bones.spine) rotations[bones.spine] = rot(rightArmX[i] * 0.1 * a, 0, 0);

    return { time: t, boneRotations: rotations };
  });
}

// ---------------------------------------------------------------------------
// Death — collapse sequence
// ---------------------------------------------------------------------------

function generateDeathKeyframes(
  bones: Record<BoneRole, string | null>,
  amp: number,
  _sharpness: number,
): ProceduralKeyframe[] {
  const a = amp;
  const phases = [0, 0.1, 0.25, 0.4, 0.55, 0.7, 0.85, 1.0];
  const spineX = [0, -5, -15, -30, -50, -70, -80, -85];

  return phases.map((t, i) => {
    const rotations: Record<string, BoneRotation> = {};
    const progress = i / (phases.length - 1);

    if (bones.spine) rotations[bones.spine] = rot(spineX[i] * a, progress * 10 * a, progress * 15 * a);
    if (bones.head) rotations[bones.head] = rot(spineX[i] * 0.4 * a, progress * 5 * a, 0);
    if (bones.leftArm) rotations[bones.leftArm] = rot(-progress * 40 * a, 0, progress * 30 * a);
    if (bones.rightArm) rotations[bones.rightArm] = rot(-progress * 35 * a, 0, -progress * 35 * a);
    if (bones.leftLeg) rotations[bones.leftLeg] = rot(-progress * 20 * a, 0, 0);
    if (bones.rightLeg) rotations[bones.rightLeg] = rot(-progress * 15 * a, progress * 10 * a, 0);
    if (bones.hips) rotations[bones.hips] = rot(spineX[i] * 0.3 * a, 0, progress * 10 * a);

    return { time: t, boneRotations: rotations };
  });
}

// ---------------------------------------------------------------------------
// Hit react — flinch and recover
// ---------------------------------------------------------------------------

function generateHitReactKeyframes(
  bones: Record<BoneRole, string | null>,
  amp: number,
  sharpness: number,
): ProceduralKeyframe[] {
  const a = amp;
  const s = sharpness;
  const phases = [0, 0.08, 0.2, 0.35, 0.5, 0.65, 0.8, 1.0];
  const spineX = [0, -15, -25, -15, -8, -3, -1, 0];

  return phases.map((t, i) => {
    const rotations: Record<string, BoneRotation> = {};

    if (bones.spine) rotations[bones.spine] = rot(spineX[i] * a * s, 0, spineX[i] * 0.3 * a);
    if (bones.head) rotations[bones.head] = rot(spineX[i] * 0.6 * a, 0, 0);
    if (bones.leftArm) rotations[bones.leftArm] = rot(spineX[i] * 0.5 * a, 0, spineX[i] * -0.3 * a);
    if (bones.rightArm) rotations[bones.rightArm] = rot(spineX[i] * 0.5 * a, 0, spineX[i] * 0.3 * a);
    if (bones.hips) rotations[bones.hips] = rot(spineX[i] * 0.2 * a, 0, 0);

    return { time: t, boneRotations: rotations };
  });
}

// ---------------------------------------------------------------------------
// Climb — alternating reach and pull
// ---------------------------------------------------------------------------

function generateClimbKeyframes(
  bones: Record<BoneRole, string | null>,
  amp: number,
  sharpness: number,
): ProceduralKeyframe[] {
  const a = amp;
  const s = sharpness;
  const frames: ProceduralKeyframe[] = [];
  const steps = 8;

  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    const phase = t * Math.PI * 2;
    const sin = Math.sin(phase);

    const rotations: Record<string, BoneRotation> = {};

    // Arms alternate reaching up
    if (bones.leftArm) rotations[bones.leftArm] = rot(-90 + sin * 30 * a * s, 0, -10 * a);
    if (bones.rightArm) rotations[bones.rightArm] = rot(-90 - sin * 30 * a * s, 0, 10 * a);
    if (bones.leftForearm) rotations[bones.leftForearm] = rot((-20 + sin * 15) * a, 0, 0);
    if (bones.rightForearm) rotations[bones.rightForearm] = rot((-20 - sin * 15) * a, 0, 0);

    // Legs alternate
    if (bones.leftLeg) rotations[bones.leftLeg] = rot(-30 + sin * 20 * a * s, 0, 0);
    if (bones.rightLeg) rotations[bones.rightLeg] = rot(-30 - sin * 20 * a * s, 0, 0);
    if (bones.leftShin) rotations[bones.leftShin] = rot(Math.max(0, sin) * 25 * a, 0, 0);
    if (bones.rightShin) rotations[bones.rightShin] = rot(Math.max(0, -sin) * 25 * a, 0, 0);

    if (bones.spine) rotations[bones.spine] = rot(-5 * a, sin * 3 * a, 0);

    frames.push({ time: t, boneRotations: rotations });
  }

  return frames;
}

// ---------------------------------------------------------------------------
// Swim — breaststroke-like
// ---------------------------------------------------------------------------

function generateSwimKeyframes(
  bones: Record<BoneRole, string | null>,
  amp: number,
  _sharpness: number,
): ProceduralKeyframe[] {
  const a = amp;
  const frames: ProceduralKeyframe[] = [];
  const steps = 8;

  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    const phase = t * Math.PI * 2;
    const sin = Math.sin(phase);
    const cos = Math.cos(phase);

    const rotations: Record<string, BoneRotation> = {};

    // Arms sweep outward and back
    if (bones.leftArm) rotations[bones.leftArm] = rot(-60 * a + cos * 30 * a, 0, sin * 40 * a);
    if (bones.rightArm) rotations[bones.rightArm] = rot(-60 * a + cos * 30 * a, 0, -sin * 40 * a);
    if (bones.leftForearm) rotations[bones.leftForearm] = rot(cos * 15 * a, 0, 0);
    if (bones.rightForearm) rotations[bones.rightForearm] = rot(cos * 15 * a, 0, 0);

    // Flutter kick
    if (bones.leftLeg) rotations[bones.leftLeg] = rot(sin * 15 * a, 0, 0);
    if (bones.rightLeg) rotations[bones.rightLeg] = rot(-sin * 15 * a, 0, 0);
    if (bones.leftShin) rotations[bones.leftShin] = rot(Math.max(0, sin) * 10 * a, 0, 0);
    if (bones.rightShin) rotations[bones.rightShin] = rot(Math.max(0, -sin) * 10 * a, 0, 0);

    // Body undulation
    if (bones.spine) rotations[bones.spine] = rot(-70 * a + sin * 5 * a, 0, cos * 2 * a);
    if (bones.head) rotations[bones.head] = rot(20 * a + sin * 3 * a, 0, 0);

    frames.push({ time: t, boneRotations: rotations });
  }

  return frames;
}

// ---------------------------------------------------------------------------
// Generator dispatch
// ---------------------------------------------------------------------------

type KeyframeGenerator = (
  bones: Record<BoneRole, string | null>,
  amp: number,
  sharpness: number,
) => ProceduralKeyframe[];

const GENERATORS: Record<AnimationType, KeyframeGenerator> = {
  walk: generateWalkKeyframes,
  run: generateRunKeyframes,
  idle: generateIdleKeyframes,
  jump: generateJumpKeyframes,
  attack_melee: generateAttackMeleeKeyframes,
  attack_ranged: generateAttackRangedKeyframes,
  death: generateDeathKeyframes,
  hit_react: generateHitReactKeyframes,
  climb: generateClimbKeyframes,
  swim: generateSwimKeyframes,
};

const DURATIONS: Record<AnimationType, number> = {
  walk: 1.0,
  run: 0.6,
  idle: 3.0,
  jump: 1.2,
  attack_melee: 0.8,
  attack_ranged: 1.0,
  death: 1.5,
  hit_react: 0.5,
  climb: 1.2,
  swim: 1.4,
};

const LOOPING: Record<AnimationType, boolean> = {
  walk: true,
  run: true,
  idle: true,
  jump: false,
  attack_melee: false,
  attack_ranged: false,
  death: false,
  hit_react: false,
  climb: true,
  swim: true,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function defaultParams(): AnimationParams {
  return { speed: 1, amplitude: 1, style: 'realistic', weight: 1 };
}

/**
 * Algorithmically generate a ProceduralAnimation of the given type,
 * mapping bone names from the skeleton to animation roles.
 */
export function generateAnimation(
  type: AnimationType,
  boneNames: string[],
  params: AnimationParams = defaultParams(),
): ProceduralAnimation {
  const bones = classifyBones(boneNames);
  const { amp, sharpness } = styleMultiplier(params.style);
  const generator = GENERATORS[type];
  const keyframes = generator(bones, params.amplitude * amp, sharpness);

  const baseDuration = DURATIONS[type];
  const duration = baseDuration / Math.max(0.1, params.speed);

  return {
    name: `procedural_${type}`,
    type,
    duration,
    loop: LOOPING[type],
    keyframes,
    blendIn: Math.min(0.2, duration * 0.15),
    blendOut: Math.min(0.2, duration * 0.15),
  };
}

/**
 * Convert a ProceduralAnimation into the engine's AnimationClipData format.
 *
 * Each bone rotation axis (x/y/z) becomes a separate AnimationTrack targeting
 * `rotation_<axis>` on that bone. Values are in degrees.
 */
export function animationToClipData(anim: ProceduralAnimation): AnimationClipData {
  // Collect all bone names across all keyframes
  const boneNameSet = new Set<string>();
  for (const kf of anim.keyframes) {
    for (const boneName of Object.keys(kf.boneRotations)) {
      boneNameSet.add(boneName);
    }
  }

  const tracks: AnimationTrack[] = [];

  for (const boneName of boneNameSet) {
    for (const axis of ['x', 'y', 'z'] as const) {
      const keyframes: ClipKeyframe[] = [];

      for (const kf of anim.keyframes) {
        const boneRot = kf.boneRotations[boneName];
        if (!boneRot) continue;
        const value = boneRot[axis];
        if (value === 0 && keyframes.length === 0) continue; // Skip leading zeros for compactness

        keyframes.push({
          time: kf.time * anim.duration,
          value,
          interpolation: 'linear',
        });
      }

      if (keyframes.length > 0) {
        tracks.push({
          target: `${boneName}.rotation_${axis}`,
          keyframes,
        });
      }
    }
  }

  return {
    tracks,
    duration: anim.duration,
    playMode: anim.loop ? 'loop' : 'once',
    playing: false,
    speed: 1,
    currentTime: 0,
    forward: true,
    autoplay: false,
  };
}

/**
 * Get display metadata for each animation type.
 */
export function getAnimationTypeInfo(type: AnimationType): {
  label: string;
  description: string;
  looping: boolean;
  defaultDuration: number;
} {
  const info: Record<AnimationType, { label: string; description: string }> = {
    walk: { label: 'Walk', description: 'Alternating leg swing with arm counterswing' },
    run: { label: 'Run', description: 'Faster gait with forward lean and bounce' },
    idle: { label: 'Idle', description: 'Subtle breathing and weight shift' },
    jump: { label: 'Jump', description: 'Crouch, launch, airborne, land, recover' },
    attack_melee: { label: 'Melee Attack', description: 'Wind-up, swing, follow-through' },
    attack_ranged: { label: 'Ranged Attack', description: 'Draw, aim, release, follow-through' },
    death: { label: 'Death', description: 'Collapse to the ground' },
    hit_react: { label: 'Hit React', description: 'Flinch and recover from impact' },
    climb: { label: 'Climb', description: 'Alternating hand-over-hand with leg push' },
    swim: { label: 'Swim', description: 'Breaststroke-like arm sweep with flutter kick' },
  };

  return {
    ...info[type],
    looping: LOOPING[type],
    defaultDuration: DURATIONS[type],
  };
}
