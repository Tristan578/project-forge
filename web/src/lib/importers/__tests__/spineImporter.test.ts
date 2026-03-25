import { describe, it, expect, beforeAll } from 'vitest';
import { parseSpineJson } from '../spineImporter';
import type { SpineImportResult } from '../spineImporter';
import type { SkeletonData2d, BoneKeyframe2d } from '@/stores/slices/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function minimalSkeleton(boneOverride?: object): object {
  return {
    skeleton: { hash: 'abc123', width: 100, height: 200 },
    bones: [{ name: 'root', ...(boneOverride ?? {}) }],
    skins: [{ name: 'default', attachments: {} }],
  };
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

describe('parseSpineJson - input validation', () => {
  it('throws on null input', () => {
    expect(() => parseSpineJson(null)).toThrow('Invalid Spine JSON');
  });

  it('throws on array input', () => {
    expect(() => parseSpineJson([])).toThrow('Invalid Spine JSON');
  });

  it('throws on primitive string input', () => {
    expect(() => parseSpineJson('not json')).toThrow('Invalid Spine JSON');
  });

  it('throws when bones array is missing', () => {
    expect(() => parseSpineJson({ skeleton: {} })).toThrow('Invalid Spine JSON');
  });

  it('throws when bones array is empty', () => {
    expect(() => parseSpineJson({ bones: [] })).toThrow('Invalid Spine JSON');
  });

  it('returns a result for minimal valid input', () => {
    const result = parseSpineJson(minimalSkeleton());
    expect(result).not.toBeUndefined();
    expect(result.skeleton).not.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Minimal skeleton (single root bone)
// ---------------------------------------------------------------------------

describe('parseSpineJson - minimal skeleton', () => {
  let result: SpineImportResult;
  beforeAll(() => {
    result = parseSpineJson(minimalSkeleton());
  });

  it('produces exactly 1 bone', () => {
    expect(result.skeleton.bones).toHaveLength(1);
  });

  it('root bone has correct name', () => {
    expect(result.skeleton.bones[0].name).toBe('root');
  });

  it('root bone has null parentBone', () => {
    expect(result.skeleton.bones[0].parentBone).toBeNull();
  });

  it('root bone defaults to zero position', () => {
    expect(result.skeleton.bones[0].localPosition).toEqual([0, 0]);
  });

  it('root bone defaults to zero rotation', () => {
    expect(result.skeleton.bones[0].localRotation).toBe(0);
  });

  it('root bone defaults to unit scale', () => {
    expect(result.skeleton.bones[0].localScale).toEqual([1, 1]);
  });

  it('root bone defaults white color', () => {
    expect(result.skeleton.bones[0].color).toEqual([1, 1, 1, 1]);
  });

  it('produces no animations', () => {
    expect(result.animations).toHaveLength(0);
  });

  it('has no warnings', () => {
    expect(result.warnings).toHaveLength(0);
  });

  it('default skin is created automatically', () => {
    expect(result.skeleton.skins['default']).not.toBeUndefined();
  });

  it('activeSkin is "default"', () => {
    expect(result.skeleton.activeSkin).toBe('default');
  });

  it('ikConstraints is empty', () => {
    expect(result.skeleton.ikConstraints).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Bone with explicit values
// ---------------------------------------------------------------------------

describe('parseSpineJson - bone with explicit values', () => {
  it('maps bone position correctly', () => {
    const result = parseSpineJson({
      bones: [{ name: 'root', x: 10, y: -5 }],
    });
    expect(result.skeleton.bones[0].localPosition).toEqual([10, -5]);
  });

  it('maps bone rotation correctly', () => {
    const result = parseSpineJson({
      bones: [{ name: 'root', rotation: 45 }],
    });
    expect(result.skeleton.bones[0].localRotation).toBe(45);
  });

  it('maps bone length correctly', () => {
    const result = parseSpineJson({
      bones: [{ name: 'root', length: 60 }],
    });
    expect(result.skeleton.bones[0].length).toBe(60);
  });

  it('maps bone scale correctly', () => {
    const result = parseSpineJson({
      bones: [{ name: 'root', scaleX: 2, scaleY: 0.5 }],
    });
    expect(result.skeleton.bones[0].localScale).toEqual([2, 0.5]);
  });

  it('parses Spine color hex into 0-1 RGBA float array', () => {
    // FF8040FF = r=255, g=128, b=64, a=255
    const result = parseSpineJson({
      bones: [{ name: 'root', color: 'ff8040ff' }],
    });
    const [r, g, b, a] = result.skeleton.bones[0].color;
    expect(r).toBeCloseTo(1.0, 1);
    expect(g).toBeCloseTo(0.502, 1);
    expect(b).toBeCloseTo(0.251, 1);
    expect(a).toBeCloseTo(1.0, 1);
  });
});

// ---------------------------------------------------------------------------
// Bone hierarchy (parent-child)
// ---------------------------------------------------------------------------

describe('parseSpineJson - bone hierarchy', () => {
  const json = {
    bones: [
      { name: 'root' },
      { name: 'torso', parent: 'root', x: 0, y: 50 },
      { name: 'head', parent: 'torso', x: 0, y: 80 },
      { name: 'arm_l', parent: 'torso', x: -30, y: 60 },
      { name: 'arm_r', parent: 'torso', x: 30, y: 60 },
    ],
  };

  let skeleton: SkeletonData2d;
  beforeAll(() => {
    skeleton = parseSpineJson(json).skeleton;
  });

  it('produces 5 bones', () => {
    expect(skeleton.bones).toHaveLength(5);
  });

  it('root has null parent', () => {
    const root = skeleton.bones.find((b) => b.name === 'root');
    expect(root?.parentBone).toBeNull();
  });

  it('torso parent is root', () => {
    const torso = skeleton.bones.find((b) => b.name === 'torso');
    expect(torso?.parentBone).toBe('root');
  });

  it('head parent is torso', () => {
    const head = skeleton.bones.find((b) => b.name === 'head');
    expect(head?.parentBone).toBe('torso');
  });

  it('arm_l parent is torso', () => {
    const armL = skeleton.bones.find((b) => b.name === 'arm_l');
    expect(armL?.parentBone).toBe('torso');
  });

  it('arm_r parent is torso', () => {
    const armR = skeleton.bones.find((b) => b.name === 'arm_r');
    expect(armR?.parentBone).toBe('torso');
  });

  it('preserves bone order from source', () => {
    const names = skeleton.bones.map((b) => b.name);
    expect(names).toEqual(['root', 'torso', 'head', 'arm_l', 'arm_r']);
  });
});

// ---------------------------------------------------------------------------
// Slot parsing
// ---------------------------------------------------------------------------

describe('parseSpineJson - slot parsing', () => {
  const json = {
    bones: [{ name: 'root' }, { name: 'body', parent: 'root' }],
    slots: [
      { name: 'body_slot', bone: 'body', attachment: 'body_sprite' },
      { name: 'glow_slot', bone: 'body', blend: 'additive' },
      { name: 'mult_slot', bone: 'root', blend: 'multiply' },
    ],
  };

  let skeleton: SkeletonData2d;
  beforeAll(() => {
    skeleton = parseSpineJson(json).skeleton;
  });

  it('parses all 3 slots', () => {
    expect(skeleton.slots).toHaveLength(3);
  });

  it('slot attachment is preserved', () => {
    const slot = skeleton.slots.find((s) => s.name === 'body_slot');
    expect(slot?.attachment).toBe('body_sprite');
    expect(slot?.spritePart).toBe('body_sprite');
  });

  it('slot with no attachment has null attachment', () => {
    const slot = skeleton.slots.find((s) => s.name === 'glow_slot');
    expect(slot?.attachment).toBeNull();
  });

  it('maps additive blend mode', () => {
    const slot = skeleton.slots.find((s) => s.name === 'glow_slot');
    expect(slot?.blendMode).toBe('additive');
  });

  it('maps multiply blend mode', () => {
    const slot = skeleton.slots.find((s) => s.name === 'mult_slot');
    expect(slot?.blendMode).toBe('multiply');
  });

  it('defaults to normal blend mode', () => {
    const slot = skeleton.slots.find((s) => s.name === 'body_slot');
    expect(slot?.blendMode).toBe('normal');
  });

  it('slot boneName is preserved', () => {
    const slot = skeleton.slots.find((s) => s.name === 'body_slot');
    expect(slot?.boneName).toBe('body');
  });
});

// ---------------------------------------------------------------------------
// Skin parsing
// ---------------------------------------------------------------------------

describe('parseSpineJson - skin parsing', () => {
  const json = {
    bones: [{ name: 'root' }],
    slots: [{ name: 'body', bone: 'root', attachment: 'body' }],
    skins: [
      {
        name: 'default',
        attachments: {
          body: {
            body: { x: 0, y: 10, rotation: 0 },
          },
        },
      },
      {
        name: 'armor',
        attachments: {
          body: {
            armor_body: { type: 'region', x: 5, y: 0 },
          },
        },
      },
    ],
  };

  let skeleton: SkeletonData2d;
  beforeAll(() => {
    skeleton = parseSpineJson(json).skeleton;
  });

  it('parses both skins', () => {
    expect(Object.keys(skeleton.skins)).toHaveLength(2);
    expect(skeleton.skins['default']).not.toBeUndefined();
    expect(skeleton.skins['armor']).not.toBeUndefined();
  });

  it('activeSkin is default', () => {
    expect(skeleton.activeSkin).toBe('default');
  });

  it('default skin has body/body attachment', () => {
    const attach = skeleton.skins['default'].attachments['body/body'];
    expect(attach).not.toBeUndefined();
    expect(attach.type).toBe('sprite');
  });

  it('armor skin has correct attachment key', () => {
    const attach = skeleton.skins['armor'].attachments['body/armor_body'];
    expect(attach).not.toBeUndefined();
  });

  it('attachment offset is mapped', () => {
    const attach = skeleton.skins['default'].attachments['body/body'];
    expect(attach.offset).toEqual([0, 10]);
  });

  it('armor attachment offset is mapped', () => {
    const attach = skeleton.skins['armor'].attachments['body/armor_body'];
    expect(attach.offset).toEqual([5, 0]);
  });
});

// ---------------------------------------------------------------------------
// Mesh attachment
// ---------------------------------------------------------------------------

describe('parseSpineJson - mesh attachment', () => {
  const json = {
    bones: [{ name: 'root' }],
    skins: [
      {
        name: 'default',
        attachments: {
          mesh_slot: {
            mesh_attach: {
              type: 'mesh',
              vertices: [0, 0, 1, 0, 0.5, 1],
              uvs: [0, 0, 1, 0, 0.5, 1],
              triangles: [0, 1, 2],
              path: 'my_texture',
            },
          },
        },
      },
    ],
  };

  it('maps mesh attachment type', () => {
    const result = parseSpineJson(json);
    const attach = result.skeleton.skins['default'].attachments['mesh_slot/mesh_attach'];
    expect(attach.type).toBe('mesh');
  });

  it('maps vertices into [x, y] pairs', () => {
    const result = parseSpineJson(json);
    const attach = result.skeleton.skins['default'].attachments['mesh_slot/mesh_attach'];
    expect(attach.vertices).toEqual([[0, 0], [1, 0], [0.5, 1]]);
  });

  it('maps uvs into [u, v] pairs', () => {
    const result = parseSpineJson(json);
    const attach = result.skeleton.skins['default'].attachments['mesh_slot/mesh_attach'];
    expect(attach.uvs).toEqual([[0, 0], [1, 0], [0.5, 1]]);
  });

  it('maps triangles array directly', () => {
    const result = parseSpineJson(json);
    const attach = result.skeleton.skins['default'].attachments['mesh_slot/mesh_attach'];
    expect(attach.triangles).toEqual([0, 1, 2]);
  });

  it('uses path as textureId', () => {
    const result = parseSpineJson(json);
    const attach = result.skeleton.skins['default'].attachments['mesh_slot/mesh_attach'];
    expect(attach.textureId).toBe('my_texture');
  });
});

// ---------------------------------------------------------------------------
// Animation keyframe extraction
// ---------------------------------------------------------------------------

describe('parseSpineJson - animation keyframe extraction', () => {
  const json = {
    bones: [{ name: 'root' }, { name: 'arm', parent: 'root' }],
    animations: {
      walk: {
        bones: {
          root: {
            rotate: [
              { time: 0, angle: 0, curve: 'linear' },
              { time: 0.5, angle: 45 },
              { time: 1.0, angle: 0 },
            ],
            translate: [
              { time: 0, x: 0, y: 0 },
              { time: 1.0, x: 10, y: 0 },
            ],
          },
          arm: {
            scale: [
              { time: 0, x: 1, y: 1 },
              { time: 0.5, x: 1.2, y: 0.8 },
            ],
          },
        },
      },
      idle: {
        bones: {
          root: {
            rotate: [{ time: 0, angle: 5 }, { time: 2.0, angle: -5 }],
          },
        },
      },
    },
  };

  let result: SpineImportResult;
  beforeAll(() => {
    result = parseSpineJson(json);
  });

  it('produces 2 animations', () => {
    expect(result.animations).toHaveLength(2);
  });

  it('animation names are preserved', () => {
    const names = result.animations.map((a) => a.name);
    expect(names).toContain('walk');
    expect(names).toContain('idle');
  });

  it('walk animation has correct duration', () => {
    const walk = result.animations.find((a) => a.name === 'walk');
    expect(walk?.animation.duration).toBe(1.0);
  });

  it('idle animation has correct duration', () => {
    const idle = result.animations.find((a) => a.name === 'idle');
    expect(idle?.animation.duration).toBe(2.0);
  });

  it('walk root bone has rotation keyframes', () => {
    const walk = result.animations.find((a) => a.name === 'walk');
    const track = walk?.animation.tracks['root'];
    expect(track).not.toBeUndefined();
    const rotKfs = track?.filter((k) => k.rotation !== undefined);
    expect(rotKfs?.length).toBeGreaterThanOrEqual(3);
  });

  it('rotation keyframe angle is preserved', () => {
    const walk = result.animations.find((a) => a.name === 'walk');
    const track = walk?.animation.tracks['root'] ?? [];
    const kf = track.find((k) => k.time === 0.5 && k.rotation !== undefined) as BoneKeyframe2d | undefined;
    expect(kf?.rotation).toBe(45);
  });

  it('walk root bone has translation keyframes', () => {
    const walk = result.animations.find((a) => a.name === 'walk');
    const track = walk?.animation.tracks['root'] ?? [];
    const transKfs = track.filter((k) => k.position !== undefined);
    expect(transKfs.length).toBeGreaterThanOrEqual(2);
  });

  it('translation position is mapped to [x, y]', () => {
    const walk = result.animations.find((a) => a.name === 'walk');
    const track = walk?.animation.tracks['root'] ?? [];
    const kf = track.find((k) => k.time === 1.0 && k.position !== undefined);
    expect(kf?.position).toEqual([10, 0]);
  });

  it('arm bone has scale keyframes', () => {
    const walk = result.animations.find((a) => a.name === 'walk');
    const track = walk?.animation.tracks['arm'] ?? [];
    const scaleKfs = track.filter((k) => k.scale !== undefined);
    expect(scaleKfs.length).toBeGreaterThanOrEqual(2);
  });

  it('scale keyframe is mapped to [scaleX, scaleY]', () => {
    const walk = result.animations.find((a) => a.name === 'walk');
    const track = walk?.animation.tracks['arm'] ?? [];
    const kf = track.find((k) => k.time === 0.5 && k.scale !== undefined);
    expect(kf?.scale).toEqual([1.2, 0.8]);
  });

  it('keyframes are sorted by time', () => {
    const walk = result.animations.find((a) => a.name === 'walk');
    const track = walk?.animation.tracks['root'] ?? [];
    for (let i = 1; i < track.length; i++) {
      expect(track[i].time).toBeGreaterThanOrEqual(track[i - 1].time);
    }
  });

  it('easing defaults to linear for unlabelled curve', () => {
    const walk = result.animations.find((a) => a.name === 'walk');
    const track = walk?.animation.tracks['root'] ?? [];
    const kf = track.find((k) => k.time === 0.5 && k.rotation !== undefined);
    expect(kf?.easing).toBe('linear');
  });
});

// ---------------------------------------------------------------------------
// Curve / easing mapping
// ---------------------------------------------------------------------------

describe('parseSpineJson - curve easing mapping', () => {
  function makeJson(curve: unknown): object {
    return {
      bones: [{ name: 'root' }],
      animations: {
        test: {
          bones: {
            root: {
              rotate: [
                { time: 0, angle: 0, curve },
                { time: 1, angle: 10 },
              ],
            },
          },
        },
      },
    };
  }

  it('maps "linear" to linear easing', () => {
    const result = parseSpineJson(makeJson('linear'));
    const track = result.animations[0].animation.tracks['root'];
    expect(track[0].easing).toBe('linear');
  });

  it('maps "stepped" to step easing', () => {
    const result = parseSpineJson(makeJson('stepped'));
    const track = result.animations[0].animation.tracks['root'];
    expect(track[0].easing).toBe('step');
  });

  it('maps bezier array to ease_in_out', () => {
    const result = parseSpineJson(makeJson([0.25, 0.1, 0.75, 0.9]));
    const track = result.animations[0].animation.tracks['root'];
    expect(track[0].easing).toBe('ease_in_out');
  });

  it('maps undefined curve to linear', () => {
    const result = parseSpineJson(makeJson(undefined));
    const track = result.animations[0].animation.tracks['root'];
    expect(track[0].easing).toBe('linear');
  });
});

// ---------------------------------------------------------------------------
// Warning emission
// ---------------------------------------------------------------------------

describe('parseSpineJson - warnings', () => {
  it('emits warning for non-bone timelines', () => {
    const json = {
      bones: [{ name: 'root' }],
      animations: {
        anim: {
          bones: {
            root: { rotate: [{ time: 0, angle: 0 }, { time: 1, angle: 10 }] },
          },
          slots: { body: {} }, // non-bone timeline
        },
      },
    };
    const result = parseSpineJson(json);
    expect(result.warnings.some((w) => w.includes('non-bone'))).toBe(true);
  });

  it('emits warning for missing skins', () => {
    const result = parseSpineJson({ bones: [{ name: 'root' }] });
    expect(result.warnings.some((w) => w.includes('default skin'))).toBe(true);
  });

  it('does not throw on unknown skin format — just warns or adapts', () => {
    // Legacy Spine 3.x object-format skins
    const json = {
      bones: [{ name: 'root' }],
      skins: {
        default: {
          body: { body_img: { x: 0, y: 0 } },
        },
      },
    };
    expect(() => parseSpineJson(json)).not.toThrow();
    const result = parseSpineJson(json);
    expect(result.skeleton.skins['default']).not.toBeUndefined();
  });

  it('returns no warnings for well-formed input', () => {
    const json = {
      bones: [{ name: 'root' }],
      skins: [{ name: 'default', attachments: {} }],
      animations: {
        idle: {
          bones: {
            root: { rotate: [{ time: 0, angle: 0 }, { time: 1, angle: 5 }] },
          },
        },
      },
    };
    const result = parseSpineJson(json);
    expect(result.warnings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Empty / missing optional fields
// ---------------------------------------------------------------------------

describe('parseSpineJson - missing optional fields', () => {
  it('handles missing slots gracefully', () => {
    const result = parseSpineJson({ bones: [{ name: 'root' }] });
    expect(result.skeleton.slots).toEqual([]);
  });

  it('handles missing animations gracefully', () => {
    const result = parseSpineJson({ bones: [{ name: 'root' }] });
    expect(result.animations).toEqual([]);
  });

  it('handles missing skins gracefully', () => {
    const result = parseSpineJson({ bones: [{ name: 'root' }] });
    expect(result.skeleton.skins['default']).not.toBeUndefined();
  });

  it('handles empty skins array', () => {
    const result = parseSpineJson({ bones: [{ name: 'root' }], skins: [] });
    expect(result.skeleton.activeSkin).toBe('default');
    expect(result.skeleton.skins['default']).not.toBeUndefined();
  });

  it('handles animation with no bones timeline', () => {
    const result = parseSpineJson({
      bones: [{ name: 'root' }],
      animations: { idle: {} },
    });
    const idle = result.animations.find((a) => a.name === 'idle');
    expect(idle).not.toBeUndefined();
    expect(idle?.animation.tracks).toEqual({});
  });
});
