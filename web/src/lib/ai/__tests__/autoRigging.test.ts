import { describe, it, expect } from 'vitest';
import {
  RIG_TEMPLATES,
  detectRigType,
  validateRig,
  rigToCommands,
  generateRig,
} from '../autoRigging';
import type { RigType, RigTemplate, BoneDefinition } from '../autoRigging';

// ---------------------------------------------------------------------------
// Template Validity Tests
// ---------------------------------------------------------------------------

describe('RIG_TEMPLATES', () => {
  const templateTypes: RigType[] = [
    'humanoid', 'quadruped', 'bird', 'fish', 'serpent', 'mechanical', 'custom',
  ];

  it('contains all 7 rig types', () => {
    expect(Object.keys(RIG_TEMPLATES)).toHaveLength(7);
    for (const type of templateTypes) {
      expect(RIG_TEMPLATES[type]).toBeDefined();
    }
  });

  describe.each(templateTypes.filter((t) => t !== 'custom'))('template: %s', (type) => {
    const template = RIG_TEMPLATES[type]();

    it('has correct type field', () => {
      expect(template.type).toBe(type);
    });

    it('has at least one bone', () => {
      expect(template.bones.length).toBeGreaterThan(0);
    });

    it('has a valid bone hierarchy (no cycles, root exists)', () => {
      const result = validateRig(template);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('has exactly one root bone', () => {
      const roots = template.bones.filter((b) => !b.parent);
      expect(roots.length).toBe(1);
    });

    it('has all bones with positive length', () => {
      for (const bone of template.bones) {
        expect(bone.length).toBeGreaterThan(0);
      }
    });

    it('has no duplicate bone names', () => {
      const names = template.bones.map((b) => b.name);
      expect(new Set(names).size).toBe(names.length);
    });

    it('has all parent references pointing to existing bones', () => {
      const names = new Set(template.bones.map((b) => b.name));
      for (const bone of template.bones) {
        if (bone.parent) {
          expect(names.has(bone.parent)).toBe(true);
        }
      }
    });

    it('has IK chains referencing existing bones', () => {
      const names = new Set(template.bones.map((b) => b.name));
      for (const chain of template.ik_chains) {
        expect(names.has(chain.startBone)).toBe(true);
        expect(names.has(chain.endBone)).toBe(true);
        if (chain.poleTarget) {
          expect(names.has(chain.poleTarget)).toBe(true);
        }
      }
    });

    it('has constraints referencing existing bones', () => {
      const names = new Set(template.bones.map((b) => b.name));
      for (const constraint of template.constraints) {
        expect(names.has(constraint.bone)).toBe(true);
      }
    });
  });

  it('custom template is empty', () => {
    const template = RIG_TEMPLATES.custom();
    expect(template.type).toBe('custom');
    expect(template.bones).toHaveLength(0);
    expect(template.ik_chains).toHaveLength(0);
    expect(template.constraints).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Bone Count Tests
// ---------------------------------------------------------------------------

describe('template bone counts', () => {
  it('humanoid has 23 bones', () => {
    expect(RIG_TEMPLATES.humanoid().bones).toHaveLength(23);
  });

  it('quadruped has 19 bones', () => {
    expect(RIG_TEMPLATES.quadruped().bones).toHaveLength(19);
  });

  it('bird has 14 bones', () => {
    expect(RIG_TEMPLATES.bird().bones).toHaveLength(14);
  });

  it('fish has 8 bones', () => {
    expect(RIG_TEMPLATES.fish().bones).toHaveLength(8);
  });

  it('serpent has 12 bones', () => {
    expect(RIG_TEMPLATES.serpent().bones).toHaveLength(12);
  });

  it('mechanical has 10 bones', () => {
    expect(RIG_TEMPLATES.mechanical().bones).toHaveLength(10);
  });
});

// ---------------------------------------------------------------------------
// Rig Type Detection
// ---------------------------------------------------------------------------

describe('detectRigType', () => {
  it('detects humanoid from character descriptions', () => {
    expect(detectRigType('a medieval knight in armor')).toBe('humanoid');
    expect(detectRigType('zombie warrior')).toBe('humanoid');
    expect(detectRigType('female wizard character')).toBe('humanoid');
  });

  it('detects quadruped from animal descriptions', () => {
    expect(detectRigType('a brown horse')).toBe('quadruped');
    expect(detectRigType('wild wolf pack leader')).toBe('quadruped');
    expect(detectRigType('large bear in the forest')).toBe('quadruped');
  });

  it('detects bird from flying creature descriptions', () => {
    expect(detectRigType('golden eagle soaring')).toBe('bird');
    expect(detectRigType('phoenix rising from ashes')).toBe('bird');
  });

  it('detects fish from aquatic descriptions', () => {
    expect(detectRigType('great white shark')).toBe('fish');
    expect(detectRigType('tropical fish underwater')).toBe('fish');
  });

  it('detects serpent from snake-like descriptions', () => {
    expect(detectRigType('a coiled snake')).toBe('serpent');
    expect(detectRigType('ancient wyrm serpent')).toBe('serpent');
  });

  it('detects mechanical from robot descriptions', () => {
    expect(detectRigType('industrial robot arm')).toBe('mechanical');
    expect(detectRigType('combat mech walker')).toBe('mechanical');
  });

  it('defaults to humanoid for ambiguous descriptions', () => {
    expect(detectRigType('mysterious entity')).toBe('humanoid');
    expect(detectRigType('')).toBe('humanoid');
  });

  it('is case-insensitive', () => {
    expect(detectRigType('A GIANT DRAGON')).toBe('bird');
    expect(detectRigType('ROBOT TANK')).toBe('mechanical');
  });
});

// ---------------------------------------------------------------------------
// Rig Validation
// ---------------------------------------------------------------------------

describe('validateRig', () => {
  it('accepts valid rig templates', () => {
    const rig = RIG_TEMPLATES.humanoid();
    const result = validateRig(rig);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('accepts empty custom template', () => {
    const rig = RIG_TEMPLATES.custom();
    const result = validateRig(rig);
    expect(result.valid).toBe(true);
  });

  it('rejects non-custom rig with no bones', () => {
    const rig: RigTemplate = { type: 'humanoid', bones: [], ik_chains: [], constraints: [] };
    const result = validateRig(rig);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Rig must have at least one bone');
  });

  it('catches duplicate bone names', () => {
    const rig: RigTemplate = {
      type: 'custom',
      bones: [
        { name: 'root', position: { x: 0, y: 0, z: 0 }, length: 1 },
        { name: 'root', position: { x: 0, y: 1, z: 0 }, length: 1 },
      ],
      ik_chains: [],
      constraints: [],
    };
    const result = validateRig(rig);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Duplicate bone name'))).toBe(true);
  });

  it('catches invalid parent references', () => {
    const rig: RigTemplate = {
      type: 'custom',
      bones: [
        { name: 'root', position: { x: 0, y: 0, z: 0 }, length: 1 },
        { name: 'child', parent: 'nonexistent', position: { x: 0, y: 1, z: 0 }, length: 1 },
      ],
      ik_chains: [],
      constraints: [],
    };
    const result = validateRig(rig);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('non-existent parent'))).toBe(true);
  });

  it('catches cycles in bone hierarchy', () => {
    const bones: BoneDefinition[] = [
      { name: 'a', parent: 'c', position: { x: 0, y: 0, z: 0 }, length: 1 },
      { name: 'b', parent: 'a', position: { x: 0, y: 1, z: 0 }, length: 1 },
      { name: 'c', parent: 'b', position: { x: 0, y: 2, z: 0 }, length: 1 },
    ];
    const rig: RigTemplate = { type: 'custom', bones, ik_chains: [], constraints: [] };
    const result = validateRig(rig);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Cycle detected'))).toBe(true);
  });

  it('catches non-positive bone length', () => {
    const rig: RigTemplate = {
      type: 'custom',
      bones: [{ name: 'root', position: { x: 0, y: 0, z: 0 }, length: 0 }],
      ik_chains: [],
      constraints: [],
    };
    const result = validateRig(rig);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('non-positive length'))).toBe(true);
  });

  it('catches IK chain referencing non-existent bones', () => {
    const rig: RigTemplate = {
      type: 'custom',
      bones: [{ name: 'root', position: { x: 0, y: 0, z: 0 }, length: 1 }],
      ik_chains: [
        { name: 'ik_test', startBone: 'root', endBone: 'missing', iterations: 5 },
      ],
      constraints: [],
    };
    const result = validateRig(rig);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('non-existent end bone'))).toBe(true);
  });

  it('catches IK chain with non-existent pole target', () => {
    const rig: RigTemplate = {
      type: 'custom',
      bones: [
        { name: 'root', position: { x: 0, y: 0, z: 0 }, length: 1 },
        { name: 'end', parent: 'root', position: { x: 0, y: 1, z: 0 }, length: 1 },
      ],
      ik_chains: [
        { name: 'ik_test', startBone: 'root', endBone: 'end', poleTarget: 'missing', iterations: 5 },
      ],
      constraints: [],
    };
    const result = validateRig(rig);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('non-existent pole target'))).toBe(true);
  });

  it('catches IK chain with non-positive iterations', () => {
    const rig: RigTemplate = {
      type: 'custom',
      bones: [
        { name: 'root', position: { x: 0, y: 0, z: 0 }, length: 1 },
        { name: 'end', parent: 'root', position: { x: 0, y: 1, z: 0 }, length: 1 },
      ],
      ik_chains: [
        { name: 'ik_test', startBone: 'root', endBone: 'end', iterations: 0 },
      ],
      constraints: [],
    };
    const result = validateRig(rig);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('non-positive iterations'))).toBe(true);
  });

  it('catches constraint referencing non-existent bone', () => {
    const rig: RigTemplate = {
      type: 'custom',
      bones: [{ name: 'root', position: { x: 0, y: 0, z: 0 }, length: 1 }],
      ik_chains: [],
      constraints: [
        { bone: 'ghost', type: 'limit_rotation', params: {} },
      ],
    };
    const result = validateRig(rig);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('non-existent bone "ghost"'))).toBe(true);
  });

  it('reports no-root error when all bones have parents', () => {
    const rig: RigTemplate = {
      type: 'custom',
      bones: [
        { name: 'a', parent: 'b', position: { x: 0, y: 0, z: 0 }, length: 1 },
        { name: 'b', parent: 'a', position: { x: 0, y: 1, z: 0 }, length: 1 },
      ],
      ik_chains: [],
      constraints: [],
    };
    const result = validateRig(rig);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('No root bone found'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Command Generation
// ---------------------------------------------------------------------------

describe('rigToCommands', () => {
  it('generates commands for a rig template', () => {
    const rig = RIG_TEMPLATES.humanoid();
    const commands = rigToCommands(rig, 'entity-123');
    expect(commands.length).toBeGreaterThan(0);
  });

  it('first command is set_skeleton_2d', () => {
    const rig = RIG_TEMPLATES.fish();
    const commands = rigToCommands(rig, 'entity-456');
    expect(commands[0].command).toBe('set_skeleton_2d');
    expect(commands[0].payload.entityId).toBe('entity-456');
  });

  it('includes all bones in the payload', () => {
    const rig = RIG_TEMPLATES.fish();
    const commands = rigToCommands(rig, 'eid');
    const payload = commands[0].payload as { bones: unknown[] };
    expect(payload.bones).toHaveLength(8);
  });

  it('maps IK chains into ikConstraints', () => {
    const rig = RIG_TEMPLATES.humanoid();
    const commands = rigToCommands(rig, 'eid');
    const payload = commands[0].payload as { ikConstraints: unknown[] };
    expect(payload.ikConstraints).toHaveLength(4); // 2 arms + 2 legs
  });

  it('produces valid bone format with localPosition tuple', () => {
    const rig: RigTemplate = {
      type: 'custom',
      bones: [{ name: 'root', position: { x: 1, y: 2, z: 3 }, length: 0.5 }],
      ik_chains: [],
      constraints: [],
    };
    const commands = rigToCommands(rig, 'e1');
    const payload = commands[0].payload as {
      bones: Array<{ name: string; localPosition: [number, number]; length: number }>;
    };
    expect(payload.bones[0].name).toBe('root');
    expect(payload.bones[0].localPosition).toEqual([1, 2]);
    expect(payload.bones[0].length).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// generateRig (async)
// ---------------------------------------------------------------------------

describe('generateRig', () => {
  it('returns a humanoid rig for character descriptions', async () => {
    const rig = await generateRig('medieval knight');
    expect(rig.type).toBe('humanoid');
    expect(rig.bones.length).toBeGreaterThan(0);
  });

  it('respects explicit rigType override', async () => {
    const rig = await generateRig('some model', 'fish');
    expect(rig.type).toBe('fish');
    expect(rig.bones).toHaveLength(8);
  });

  it('returns a valid rig', async () => {
    const rig = await generateRig('robot arm');
    const result = validateRig(rig);
    expect(result.valid).toBe(true);
  });
});
