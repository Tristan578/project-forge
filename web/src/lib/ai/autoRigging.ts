/**
 * Auto-rigging pipeline for AI-generated 3D models.
 *
 * Provides rig templates, type detection, validation, and command generation
 * so that AI-generated models can be animated without manual rigging work.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RigType =
  | 'humanoid'
  | 'quadruped'
  | 'bird'
  | 'fish'
  | 'serpent'
  | 'mechanical'
  | 'custom';

export interface BoneDefinition {
  name: string;
  parent?: string;
  position: { x: number; y: number; z: number };
  rotation?: { x: number; y: number; z: number };
  length: number;
}

export interface IKChain {
  name: string;
  startBone: string;
  endBone: string;
  poleTarget?: string;
  iterations: number;
}

export interface RigConstraint {
  bone: string;
  type: 'limit_rotation' | 'copy_rotation' | 'track_to';
  params: Record<string, unknown>;
}

export interface RigTemplate {
  type: RigType;
  bones: BoneDefinition[];
  ik_chains: IKChain[];
  constraints: RigConstraint[];
}

export interface EngineCommand {
  command: string;
  payload: Record<string, unknown>;
}

export interface RigValidationResult {
  valid: boolean;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Rig Templates
// ---------------------------------------------------------------------------

function humanoidTemplate(): RigTemplate {
  return {
    type: 'humanoid',
    bones: [
      { name: 'hips', position: { x: 0, y: 1.0, z: 0 }, length: 0.2 },
      { name: 'spine', parent: 'hips', position: { x: 0, y: 1.2, z: 0 }, length: 0.2 },
      { name: 'chest', parent: 'spine', position: { x: 0, y: 1.4, z: 0 }, length: 0.2 },
      { name: 'neck', parent: 'chest', position: { x: 0, y: 1.6, z: 0 }, length: 0.1 },
      { name: 'head', parent: 'neck', position: { x: 0, y: 1.7, z: 0 }, length: 0.2 },
      // Left arm
      { name: 'shoulder_l', parent: 'chest', position: { x: 0.15, y: 1.55, z: 0 }, length: 0.1 },
      { name: 'upper_arm_l', parent: 'shoulder_l', position: { x: 0.25, y: 1.55, z: 0 }, length: 0.28 },
      { name: 'forearm_l', parent: 'upper_arm_l', position: { x: 0.53, y: 1.55, z: 0 }, length: 0.25 },
      { name: 'hand_l', parent: 'forearm_l', position: { x: 0.78, y: 1.55, z: 0 }, length: 0.1 },
      // Right arm
      { name: 'shoulder_r', parent: 'chest', position: { x: -0.15, y: 1.55, z: 0 }, length: 0.1 },
      { name: 'upper_arm_r', parent: 'shoulder_r', position: { x: -0.25, y: 1.55, z: 0 }, length: 0.28 },
      { name: 'forearm_r', parent: 'upper_arm_r', position: { x: -0.53, y: 1.55, z: 0 }, length: 0.25 },
      { name: 'hand_r', parent: 'forearm_r', position: { x: -0.78, y: 1.55, z: 0 }, length: 0.1 },
      // Left leg
      { name: 'upper_leg_l', parent: 'hips', position: { x: 0.1, y: 0.95, z: 0 }, length: 0.4 },
      { name: 'lower_leg_l', parent: 'upper_leg_l', position: { x: 0.1, y: 0.55, z: 0 }, length: 0.4 },
      { name: 'foot_l', parent: 'lower_leg_l', position: { x: 0.1, y: 0.15, z: 0 }, length: 0.15 },
      { name: 'toe_l', parent: 'foot_l', position: { x: 0.1, y: 0.05, z: 0.1 }, length: 0.05 },
      // Right leg
      { name: 'upper_leg_r', parent: 'hips', position: { x: -0.1, y: 0.95, z: 0 }, length: 0.4 },
      { name: 'lower_leg_r', parent: 'upper_leg_r', position: { x: -0.1, y: 0.55, z: 0 }, length: 0.4 },
      { name: 'foot_r', parent: 'lower_leg_r', position: { x: -0.1, y: 0.15, z: 0 }, length: 0.15 },
      { name: 'toe_r', parent: 'foot_r', position: { x: -0.1, y: 0.05, z: 0.1 }, length: 0.05 },
      // Fingers (simplified: one bone per hand)
      { name: 'fingers_l', parent: 'hand_l', position: { x: 0.88, y: 1.55, z: 0 }, length: 0.08 },
      { name: 'fingers_r', parent: 'hand_r', position: { x: -0.88, y: 1.55, z: 0 }, length: 0.08 },
    ],
    ik_chains: [
      { name: 'ik_arm_l', startBone: 'upper_arm_l', endBone: 'hand_l', poleTarget: 'forearm_l', iterations: 10 },
      { name: 'ik_arm_r', startBone: 'upper_arm_r', endBone: 'hand_r', poleTarget: 'forearm_r', iterations: 10 },
      { name: 'ik_leg_l', startBone: 'upper_leg_l', endBone: 'foot_l', poleTarget: 'lower_leg_l', iterations: 10 },
      { name: 'ik_leg_r', startBone: 'upper_leg_r', endBone: 'foot_r', poleTarget: 'lower_leg_r', iterations: 10 },
    ],
    constraints: [
      { bone: 'head', type: 'limit_rotation', params: { minX: -60, maxX: 60, minY: -80, maxY: 80 } },
      { bone: 'spine', type: 'limit_rotation', params: { minX: -30, maxX: 45, minY: -45, maxY: 45 } },
    ],
  };
}

function quadrupedTemplate(): RigTemplate {
  return {
    type: 'quadruped',
    bones: [
      { name: 'root', position: { x: 0, y: 0.6, z: 0 }, length: 0.15 },
      { name: 'spine_front', parent: 'root', position: { x: 0, y: 0.65, z: 0.3 }, length: 0.3 },
      { name: 'spine_back', parent: 'root', position: { x: 0, y: 0.6, z: -0.3 }, length: 0.3 },
      { name: 'neck', parent: 'spine_front', position: { x: 0, y: 0.8, z: 0.5 }, length: 0.2 },
      { name: 'head', parent: 'neck', position: { x: 0, y: 0.9, z: 0.65 }, length: 0.15 },
      { name: 'tail_1', parent: 'spine_back', position: { x: 0, y: 0.6, z: -0.55 }, length: 0.15 },
      { name: 'tail_2', parent: 'tail_1', position: { x: 0, y: 0.55, z: -0.7 }, length: 0.15 },
      // Front legs
      { name: 'front_upper_l', parent: 'spine_front', position: { x: 0.12, y: 0.45, z: 0.3 }, length: 0.25 },
      { name: 'front_lower_l', parent: 'front_upper_l', position: { x: 0.12, y: 0.2, z: 0.3 }, length: 0.2 },
      { name: 'front_hoof_l', parent: 'front_lower_l', position: { x: 0.12, y: 0.0, z: 0.3 }, length: 0.05 },
      { name: 'front_upper_r', parent: 'spine_front', position: { x: -0.12, y: 0.45, z: 0.3 }, length: 0.25 },
      { name: 'front_lower_r', parent: 'front_upper_r', position: { x: -0.12, y: 0.2, z: 0.3 }, length: 0.2 },
      { name: 'front_hoof_r', parent: 'front_lower_r', position: { x: -0.12, y: 0.0, z: 0.3 }, length: 0.05 },
      // Back legs
      { name: 'back_upper_l', parent: 'spine_back', position: { x: 0.12, y: 0.45, z: -0.3 }, length: 0.25 },
      { name: 'back_lower_l', parent: 'back_upper_l', position: { x: 0.12, y: 0.2, z: -0.3 }, length: 0.2 },
      { name: 'back_hoof_l', parent: 'back_lower_l', position: { x: 0.12, y: 0.0, z: -0.3 }, length: 0.05 },
      { name: 'back_upper_r', parent: 'spine_back', position: { x: -0.12, y: 0.45, z: -0.3 }, length: 0.25 },
      { name: 'back_lower_r', parent: 'back_upper_r', position: { x: -0.12, y: 0.2, z: -0.3 }, length: 0.2 },
      { name: 'back_hoof_r', parent: 'back_lower_r', position: { x: -0.12, y: 0.0, z: -0.3 }, length: 0.05 },
    ],
    ik_chains: [
      { name: 'ik_front_l', startBone: 'front_upper_l', endBone: 'front_hoof_l', iterations: 8 },
      { name: 'ik_front_r', startBone: 'front_upper_r', endBone: 'front_hoof_r', iterations: 8 },
      { name: 'ik_back_l', startBone: 'back_upper_l', endBone: 'back_hoof_l', iterations: 8 },
      { name: 'ik_back_r', startBone: 'back_upper_r', endBone: 'back_hoof_r', iterations: 8 },
    ],
    constraints: [
      { bone: 'neck', type: 'limit_rotation', params: { minX: -40, maxX: 60 } },
      { bone: 'head', type: 'track_to', params: { axis: 'y' } },
    ],
  };
}

function birdTemplate(): RigTemplate {
  return {
    type: 'bird',
    bones: [
      { name: 'body', position: { x: 0, y: 0.5, z: 0 }, length: 0.3 },
      { name: 'neck', parent: 'body', position: { x: 0, y: 0.6, z: 0.15 }, length: 0.15 },
      { name: 'head', parent: 'neck', position: { x: 0, y: 0.7, z: 0.2 }, length: 0.1 },
      // Wings
      { name: 'wing_upper_l', parent: 'body', position: { x: 0.15, y: 0.55, z: 0 }, length: 0.25 },
      { name: 'wing_lower_l', parent: 'wing_upper_l', position: { x: 0.4, y: 0.5, z: 0 }, length: 0.2 },
      { name: 'wing_tip_l', parent: 'wing_lower_l', position: { x: 0.6, y: 0.48, z: 0 }, length: 0.15 },
      { name: 'wing_upper_r', parent: 'body', position: { x: -0.15, y: 0.55, z: 0 }, length: 0.25 },
      { name: 'wing_lower_r', parent: 'wing_upper_r', position: { x: -0.4, y: 0.5, z: 0 }, length: 0.2 },
      { name: 'wing_tip_r', parent: 'wing_lower_r', position: { x: -0.6, y: 0.48, z: 0 }, length: 0.15 },
      // Legs
      { name: 'leg_upper_l', parent: 'body', position: { x: 0.08, y: 0.35, z: -0.05 }, length: 0.15 },
      { name: 'leg_lower_l', parent: 'leg_upper_l', position: { x: 0.08, y: 0.2, z: -0.05 }, length: 0.15 },
      { name: 'leg_upper_r', parent: 'body', position: { x: -0.08, y: 0.35, z: -0.05 }, length: 0.15 },
      { name: 'leg_lower_r', parent: 'leg_upper_r', position: { x: -0.08, y: 0.2, z: -0.05 }, length: 0.15 },
      { name: 'tail', parent: 'body', position: { x: 0, y: 0.45, z: -0.2 }, length: 0.15 },
    ],
    ik_chains: [
      { name: 'ik_wing_l', startBone: 'wing_upper_l', endBone: 'wing_tip_l', iterations: 6 },
      { name: 'ik_wing_r', startBone: 'wing_upper_r', endBone: 'wing_tip_r', iterations: 6 },
    ],
    constraints: [
      { bone: 'wing_upper_l', type: 'limit_rotation', params: { minZ: -10, maxZ: 90 } },
      { bone: 'wing_upper_r', type: 'limit_rotation', params: { minZ: -90, maxZ: 10 } },
    ],
  };
}

function fishTemplate(): RigTemplate {
  return {
    type: 'fish',
    bones: [
      { name: 'head', position: { x: 0, y: 0, z: 0.4 }, length: 0.2 },
      { name: 'spine_1', parent: 'head', position: { x: 0, y: 0, z: 0.2 }, length: 0.15 },
      { name: 'spine_2', parent: 'spine_1', position: { x: 0, y: 0, z: 0.05 }, length: 0.15 },
      { name: 'spine_3', parent: 'spine_2', position: { x: 0, y: 0, z: -0.1 }, length: 0.15 },
      { name: 'spine_4', parent: 'spine_3', position: { x: 0, y: 0, z: -0.25 }, length: 0.15 },
      { name: 'spine_5', parent: 'spine_4', position: { x: 0, y: 0, z: -0.4 }, length: 0.12 },
      { name: 'tail_base', parent: 'spine_5', position: { x: 0, y: 0, z: -0.52 }, length: 0.1 },
      { name: 'tail_fin', parent: 'tail_base', position: { x: 0, y: 0, z: -0.62 }, length: 0.12 },
    ],
    ik_chains: [],
    constraints: [
      { bone: 'spine_1', type: 'limit_rotation', params: { minY: -15, maxY: 15 } },
      { bone: 'spine_2', type: 'limit_rotation', params: { minY: -20, maxY: 20 } },
      { bone: 'spine_3', type: 'limit_rotation', params: { minY: -25, maxY: 25 } },
      { bone: 'tail_fin', type: 'limit_rotation', params: { minY: -45, maxY: 45 } },
    ],
  };
}

function serpentTemplate(): RigTemplate {
  const bones: BoneDefinition[] = [];
  for (let i = 0; i < 12; i++) {
    bones.push({
      name: i === 0 ? 'head' : `spine_${i}`,
      parent: i === 0 ? undefined : i === 1 ? 'head' : `spine_${i - 1}`,
      position: { x: 0, y: 0, z: 0.55 - i * 0.1 },
      length: i === 0 ? 0.12 : 0.1,
    });
  }
  return {
    type: 'serpent',
    bones,
    ik_chains: [
      { name: 'ik_body', startBone: 'spine_1', endBone: 'spine_11', iterations: 12 },
    ],
    constraints: bones.slice(1).map((b) => ({
      bone: b.name,
      type: 'limit_rotation' as const,
      params: { minY: -30, maxY: 30, minX: -15, maxX: 15 },
    })),
  };
}

function mechanicalTemplate(): RigTemplate {
  return {
    type: 'mechanical',
    bones: [
      { name: 'base', position: { x: 0, y: 0, z: 0 }, length: 0.2 },
      { name: 'turret', parent: 'base', position: { x: 0, y: 0.2, z: 0 }, length: 0.15 },
      { name: 'arm_1', parent: 'turret', position: { x: 0, y: 0.35, z: 0 }, length: 0.3 },
      { name: 'arm_2', parent: 'arm_1', position: { x: 0, y: 0.65, z: 0 }, length: 0.25 },
      { name: 'piston_base', parent: 'arm_1', position: { x: 0.05, y: 0.4, z: 0 }, length: 0.15 },
      { name: 'piston_rod', parent: 'piston_base', position: { x: 0.05, y: 0.55, z: 0 }, length: 0.12 },
      { name: 'effector', parent: 'arm_2', position: { x: 0, y: 0.9, z: 0 }, length: 0.1 },
      { name: 'gripper_l', parent: 'effector', position: { x: 0.05, y: 1.0, z: 0 }, length: 0.08 },
      { name: 'gripper_r', parent: 'effector', position: { x: -0.05, y: 1.0, z: 0 }, length: 0.08 },
      { name: 'sensor', parent: 'turret', position: { x: 0, y: 0.38, z: 0.1 }, length: 0.05 },
    ],
    ik_chains: [
      { name: 'ik_arm', startBone: 'arm_1', endBone: 'effector', iterations: 8 },
    ],
    constraints: [
      { bone: 'turret', type: 'limit_rotation', params: { minY: -180, maxY: 180, minX: 0, maxX: 0, minZ: 0, maxZ: 0 } },
      { bone: 'arm_1', type: 'limit_rotation', params: { minX: -90, maxX: 90 } },
      { bone: 'gripper_l', type: 'limit_rotation', params: { minZ: 0, maxZ: 45 } },
      { bone: 'gripper_r', type: 'limit_rotation', params: { minZ: -45, maxZ: 0 } },
    ],
  };
}

function customTemplate(): RigTemplate {
  return {
    type: 'custom',
    bones: [],
    ik_chains: [],
    constraints: [],
  };
}

export const RIG_TEMPLATES: Record<RigType, () => RigTemplate> = {
  humanoid: humanoidTemplate,
  quadruped: quadrupedTemplate,
  bird: birdTemplate,
  fish: fishTemplate,
  serpent: serpentTemplate,
  mechanical: mechanicalTemplate,
  custom: customTemplate,
};

// ---------------------------------------------------------------------------
// Rig Type Detection
// ---------------------------------------------------------------------------

const RIG_KEYWORDS: Record<RigType, string[]> = {
  humanoid: [
    'human', 'person', 'character', 'man', 'woman', 'boy', 'girl',
    'zombie', 'skeleton', 'knight', 'warrior', 'wizard', 'npc',
    'soldier', 'humanoid', 'bipedal', 'elf', 'dwarf', 'orc',
    'goblin', 'troll', 'giant', 'android', 'cyborg',
  ],
  quadruped: [
    'dog', 'cat', 'horse', 'wolf', 'lion', 'tiger', 'bear',
    'deer', 'cow', 'pig', 'sheep', 'goat', 'elephant', 'rhino',
    'fox', 'quadruped', 'four-legged', 'animal', 'beast', 'creature',
    'dinosaur', 'raptor', 'buffalo',
  ],
  bird: [
    'bird', 'eagle', 'hawk', 'owl', 'parrot', 'crow', 'raven',
    'phoenix', 'griffin', 'dragon', 'bat', 'flying', 'winged',
    'falcon', 'sparrow', 'penguin', 'chicken', 'duck',
  ],
  fish: [
    'fish', 'shark', 'whale', 'dolphin', 'salmon', 'trout',
    'eel', 'ray', 'aquatic', 'marine', 'underwater', 'sea creature',
  ],
  serpent: [
    'snake', 'serpent', 'worm', 'wyrm', 'centipede', 'caterpillar',
    'tentacle', 'vine', 'rope', 'chain', 'naga', 'basilisk',
  ],
  mechanical: [
    'robot', 'mech', 'machine', 'turret', 'crane', 'arm',
    'industrial', 'mechanical', 'automaton', 'drone', 'vehicle',
    'tank', 'walker', 'spider-bot',
  ],
  custom: [],
};

/** Classify the rig type from a model description string. */
export function detectRigType(entityDescription: string): RigType {
  const lower = entityDescription.toLowerCase();

  let bestType: RigType = 'humanoid';
  let bestScore = 0;

  for (const [rigType, keywords] of Object.entries(RIG_KEYWORDS) as [RigType, string[]][]) {
    if (rigType === 'custom') continue;
    let score = 0;
    for (const keyword of keywords) {
      if (lower.includes(keyword)) {
        score += keyword.length; // longer matches = higher confidence
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestType = rigType;
    }
  }

  return bestType;
}

// ---------------------------------------------------------------------------
// Rig Validation
// ---------------------------------------------------------------------------

/** Validate a rig template for structural correctness. */
export function validateRig(rig: RigTemplate): RigValidationResult {
  const errors: string[] = [];
  const boneNames = new Set(rig.bones.map((b) => b.name));

  // Must have at least one bone (except custom which can be empty)
  if (rig.type !== 'custom' && rig.bones.length === 0) {
    errors.push('Rig must have at least one bone');
  }

  // Check for duplicate bone names
  if (boneNames.size !== rig.bones.length) {
    const seen = new Set<string>();
    for (const bone of rig.bones) {
      if (seen.has(bone.name)) {
        errors.push(`Duplicate bone name: "${bone.name}"`);
      }
      seen.add(bone.name);
    }
  }

  // Check parent references
  for (const bone of rig.bones) {
    if (bone.parent && !boneNames.has(bone.parent)) {
      errors.push(`Bone "${bone.name}" references non-existent parent "${bone.parent}"`);
    }
  }

  // Exactly one root bone (no parent)
  const roots = rig.bones.filter((b) => !b.parent);
  if (rig.bones.length > 0 && roots.length === 0) {
    errors.push('No root bone found (at least one bone must have no parent)');
  }

  // Check for cycles
  for (const bone of rig.bones) {
    const visited = new Set<string>();
    let current: string | undefined = bone.name;
    while (current) {
      if (visited.has(current)) {
        errors.push(`Cycle detected involving bone "${bone.name}"`);
        break;
      }
      visited.add(current);
      const parentBone = rig.bones.find((b) => b.name === current);
      current = parentBone?.parent;
    }
  }

  // Bone length must be positive
  for (const bone of rig.bones) {
    if (bone.length <= 0) {
      errors.push(`Bone "${bone.name}" has non-positive length: ${bone.length}`);
    }
  }

  // Validate IK chains
  for (const chain of rig.ik_chains) {
    if (!boneNames.has(chain.startBone)) {
      errors.push(`IK chain "${chain.name}" references non-existent start bone "${chain.startBone}"`);
    }
    if (!boneNames.has(chain.endBone)) {
      errors.push(`IK chain "${chain.name}" references non-existent end bone "${chain.endBone}"`);
    }
    if (chain.poleTarget && !boneNames.has(chain.poleTarget)) {
      errors.push(`IK chain "${chain.name}" references non-existent pole target "${chain.poleTarget}"`);
    }
    if (chain.iterations <= 0) {
      errors.push(`IK chain "${chain.name}" has non-positive iterations: ${chain.iterations}`);
    }
  }

  // Validate constraints
  for (const constraint of rig.constraints) {
    if (!boneNames.has(constraint.bone)) {
      errors.push(`Constraint references non-existent bone "${constraint.bone}"`);
    }
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Command Generation
// ---------------------------------------------------------------------------

/**
 * Convert a rig template into engine commands that attach a skeleton
 * to the specified entity. Uses the skeleton2d command interface which
 * supports both 2D and 3D bone hierarchies.
 */
export function rigToCommands(rig: RigTemplate, entityId: string): EngineCommand[] {
  const commands: EngineCommand[] = [];

  // Build bones array in the format expected by set_skeleton_2d
  const bones = rig.bones.map((bone) => ({
    name: bone.name,
    parentBone: bone.parent ?? null,
    localPosition: bone.position.z !== undefined && bone.position.z !== 0
      ? [bone.position.x, bone.position.y, bone.position.z] as [number, number, number]
      : [bone.position.x, bone.position.y] as [number, number],
    localRotation: bone.rotation ? bone.rotation.z : 0,
    localScale: [1, 1] as [number, number],
    length: bone.length,
    color: [1, 1, 1, 1] as [number, number, number, number],
  }));

  // Set skeleton data on the entity
  commands.push({
    command: 'set_skeleton_2d',
    payload: {
      entityId,
      bones,
      slots: [],
      skins: {},
      activeSkin: 'default',
      ikConstraints: rig.ik_chains.map((chain) => ({
        name: chain.name,
        boneChain: buildBoneChain(rig.bones, chain.startBone, chain.endBone),
        targetEntityId: 0,
        bendDirection: 1,
        mix: 1.0,
      })),
    },
  });

  return commands;
}

/**
 * Build a bone chain from start to end by traversing the hierarchy.
 * Returns the bone names from start down to end.
 */
function buildBoneChain(
  bones: BoneDefinition[],
  startBone: string,
  endBone: string,
): string[] {
  // Build parent->children map
  const childrenMap = new Map<string, string[]>();
  for (const bone of bones) {
    if (bone.parent) {
      const children = childrenMap.get(bone.parent) ?? [];
      children.push(bone.name);
      childrenMap.set(bone.parent, children);
    }
  }

  // BFS from start to end
  const queue: string[][] = [[startBone]];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const path = queue.shift()!;
    const current = path[path.length - 1];

    if (current === endBone) {
      return path;
    }

    if (visited.has(current)) continue;
    visited.add(current);

    const children = childrenMap.get(current) ?? [];
    for (const child of children) {
      queue.push([...path, child]);
    }
  }

  // Fallback: return just start and end if no path found
  return [startBone, endBone];
}

// ---------------------------------------------------------------------------
// AI-Powered Rig Generation (stub for future AI integration)
// ---------------------------------------------------------------------------

/**
 * Generate a custom rig using AI. For now, this selects the best-matching
 * template and returns it. In the future, this will call the AI backend
 * to generate a fully custom rig.
 */
export async function generateRig(
  modelDescription: string,
  rigType?: RigType,
): Promise<RigTemplate> {
  const type = rigType ?? detectRigType(modelDescription);
  const templateFn = RIG_TEMPLATES[type];
  return templateFn();
}
