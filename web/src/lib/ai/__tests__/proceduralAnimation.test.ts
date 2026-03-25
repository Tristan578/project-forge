import { describe, it, expect } from 'vitest';
import {
  generateAnimation,
  animationToClipData,
  classifyBones,
  defaultParams,
  getAnimationTypeInfo,
  ANIMATION_TYPES,
  type AnimationType,
  type AnimationParams,
  type ProceduralAnimation,
} from '../proceduralAnimation';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const STANDARD_BONES = [
  'hips', 'spine', 'head', 'neck',
  'left_arm', 'left_forearm', 'left_hand',
  'right_arm', 'right_forearm', 'right_hand',
  'left_leg', 'left_shin', 'left_foot',
  'right_leg', 'right_shin', 'right_foot',
];

const MINIMAL_BONES = ['spine', 'left_arm', 'right_arm'];

// ---------------------------------------------------------------------------
// classifyBones
// ---------------------------------------------------------------------------

describe('classifyBones', () => {
  it('maps standard bone names to roles', () => {
    const result = classifyBones(STANDARD_BONES);
    expect(result.hips).toBe('hips');
    expect(result.spine).toBe('spine');
    expect(result.head).toBe('head');
    expect(result.leftArm).toBe('left_arm');
    expect(result.rightArm).toBe('right_arm');
    expect(result.leftLeg).toBe('left_leg');
    expect(result.rightLeg).toBe('right_leg');
    expect(result.leftShin).toBe('left_shin');
    expect(result.rightShin).toBe('right_shin');
    expect(result.leftFoot).toBe('left_foot');
    expect(result.rightFoot).toBe('right_foot');
  });

  it('returns null for unrecognised bones', () => {
    const result = classifyBones(['mystery_bone', 'widget']);
    expect(result.hips).toBeNull();
    expect(result.spine).toBeNull();
    expect(result.leftArm).toBeNull();
  });

  it('handles mixed-case bone names', () => {
    const result = classifyBones(['LeftArm', 'RightLeg', 'Spine']);
    expect(result.leftArm).toBe('LeftArm');
    expect(result.rightLeg).toBe('RightLeg');
    expect(result.spine).toBe('Spine');
  });

  it('returns null for empty input', () => {
    const result = classifyBones([]);
    expect(result.hips).toBeNull();
    expect(result.spine).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// generateAnimation — all 10 types produce valid output
// ---------------------------------------------------------------------------

describe('generateAnimation', () => {
  const params = defaultParams();

  it.each(ANIMATION_TYPES as unknown as AnimationType[])(
    'generates valid keyframes for %s',
    (type) => {
      const anim = generateAnimation(type, STANDARD_BONES, params);

      expect(anim.name).toBe(`procedural_${type}`);
      expect(anim.type).toBe(type);
      expect(anim.duration).toBeGreaterThan(0);
      expect(anim.keyframes.length).toBeGreaterThanOrEqual(8);
      expect(anim.blendIn).toBeGreaterThanOrEqual(0);
      expect(anim.blendOut).toBeGreaterThanOrEqual(0);
    },
  );

  it.each(ANIMATION_TYPES as unknown as AnimationType[])(
    'keyframe times are in [0,1] range for %s',
    (type) => {
      const anim = generateAnimation(type, STANDARD_BONES, params);

      for (const kf of anim.keyframes) {
        expect(kf.time).toBeGreaterThanOrEqual(0);
        expect(kf.time).toBeLessThanOrEqual(1);
      }
    },
  );

  it.each(ANIMATION_TYPES as unknown as AnimationType[])(
    'bone rotation values are finite numbers for %s',
    (type) => {
      const anim = generateAnimation(type, STANDARD_BONES, params);

      for (const kf of anim.keyframes) {
        for (const [_boneName, rotation] of Object.entries(kf.boneRotations)) {
          expect(Number.isFinite(rotation.x)).toBe(true);
          expect(Number.isFinite(rotation.y)).toBe(true);
          expect(Number.isFinite(rotation.z)).toBe(true);
        }
      }
    },
  );

  it('walk cycle is periodic — first and last keyframes have similar bone rotations', () => {
    const anim = generateAnimation('walk', STANDARD_BONES, params);
    const first = anim.keyframes[0];
    const last = anim.keyframes[anim.keyframes.length - 1];

    // Walk is 8-phase cyclic; first frame (phase=0) and a full cycle later should be close
    for (const boneName of Object.keys(first.boneRotations)) {
      const a = first.boneRotations[boneName];
      const b = last.boneRotations[boneName];
      if (!b) continue;
      // Allow reasonable tolerance for sinusoidal near-wrap (8-phase cycle)
      // sin(0) vs sin(7/8 * 2pi) differ by ~sin(pi/4) * amplitude
      expect(Math.abs(a.x - b.x)).toBeLessThan(25);
      expect(Math.abs(a.y - b.y)).toBeLessThan(25);
      expect(Math.abs(a.z - b.z)).toBeLessThan(25);
    }
  });

  it('respects speed parameter — faster speed = shorter duration', () => {
    const slow = generateAnimation('walk', STANDARD_BONES, { ...params, speed: 0.5 });
    const fast = generateAnimation('walk', STANDARD_BONES, { ...params, speed: 2.0 });
    expect(fast.duration).toBeLessThan(slow.duration);
  });

  it('respects amplitude parameter — higher amplitude = larger rotations', () => {
    const low = generateAnimation('walk', STANDARD_BONES, { ...params, amplitude: 0.5 });
    const high = generateAnimation('walk', STANDARD_BONES, { ...params, amplitude: 2.0 });

    // Compare max rotation magnitude
    const maxRot = (anim: ProceduralAnimation) => {
      let max = 0;
      for (const kf of anim.keyframes) {
        for (const r of Object.values(kf.boneRotations)) {
          max = Math.max(max, Math.abs(r.x), Math.abs(r.y), Math.abs(r.z));
        }
      }
      return max;
    };

    expect(maxRot(high)).toBeGreaterThan(maxRot(low));
  });

  it('cartoon style produces larger amplitude than realistic', () => {
    const realistic = generateAnimation('walk', STANDARD_BONES, { ...params, style: 'realistic' });
    const cartoon = generateAnimation('walk', STANDARD_BONES, { ...params, style: 'cartoon' });

    const maxRot = (anim: ProceduralAnimation) => {
      let max = 0;
      for (const kf of anim.keyframes) {
        for (const r of Object.values(kf.boneRotations)) {
          max = Math.max(max, Math.abs(r.x), Math.abs(r.y), Math.abs(r.z));
        }
      }
      return max;
    };

    expect(maxRot(cartoon)).toBeGreaterThan(maxRot(realistic));
  });

  it('mechanical style produces smaller amplitude than realistic', () => {
    const realistic = generateAnimation('run', STANDARD_BONES, { ...params, style: 'realistic' });
    const mechanical = generateAnimation('run', STANDARD_BONES, { ...params, style: 'mechanical' });

    const maxRot = (anim: ProceduralAnimation) => {
      let max = 0;
      for (const kf of anim.keyframes) {
        for (const r of Object.values(kf.boneRotations)) {
          max = Math.max(max, Math.abs(r.x), Math.abs(r.y), Math.abs(r.z));
        }
      }
      return max;
    };

    expect(maxRot(mechanical)).toBeLessThan(maxRot(realistic));
  });

  it('works with minimal bone set', () => {
    const anim = generateAnimation('walk', MINIMAL_BONES, params);
    expect(anim.keyframes.length).toBeGreaterThanOrEqual(8);
    // Only bones present should appear in rotations
    for (const kf of anim.keyframes) {
      for (const name of Object.keys(kf.boneRotations)) {
        expect(MINIMAL_BONES).toContain(name);
      }
    }
  });

  it('works with empty bone set', () => {
    const anim = generateAnimation('idle', [], params);
    expect(anim.keyframes.length).toBeGreaterThanOrEqual(8);
    for (const kf of anim.keyframes) {
      expect(Object.keys(kf.boneRotations).length).toBe(0);
    }
  });

  it('looping types have loop=true, non-looping have loop=false', () => {
    const looping: AnimationType[] = ['walk', 'run', 'idle', 'climb', 'swim'];
    const nonLooping: AnimationType[] = ['jump', 'attack_melee', 'attack_ranged', 'death', 'hit_react'];

    for (const type of looping) {
      expect(generateAnimation(type, STANDARD_BONES, params).loop).toBe(true);
    }
    for (const type of nonLooping) {
      expect(generateAnimation(type, STANDARD_BONES, params).loop).toBe(false);
    }
  });

  it('blendIn and blendOut are reasonable fractions of duration', () => {
    for (const type of ANIMATION_TYPES) {
      const anim = generateAnimation(type, STANDARD_BONES, params);
      expect(anim.blendIn).toBeLessThanOrEqual(anim.duration);
      expect(anim.blendOut).toBeLessThanOrEqual(anim.duration);
      expect(anim.blendIn).toBeLessThanOrEqual(0.2);
      expect(anim.blendOut).toBeLessThanOrEqual(0.2);
    }
  });

  it('uses default params when none provided', () => {
    const anim = generateAnimation('walk', STANDARD_BONES);
    expect(anim.keyframes.length).toBeGreaterThanOrEqual(8);
    expect(anim.duration).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// animationToClipData
// ---------------------------------------------------------------------------

describe('animationToClipData', () => {
  it('converts walk animation to valid clip data', () => {
    const anim = generateAnimation('walk', STANDARD_BONES);
    const clip = animationToClipData(anim);

    expect(clip.duration).toBe(anim.duration);
    expect(clip.playMode).toBe('loop');
    expect(clip.playing).toBe(false);
    expect(clip.speed).toBe(1);
    expect(clip.currentTime).toBe(0);
    expect(clip.forward).toBe(true);
    expect(clip.autoplay).toBe(false);
    expect(clip.tracks.length).toBeGreaterThan(0);
  });

  it('non-looping animation produces playMode once', () => {
    const anim = generateAnimation('jump', STANDARD_BONES);
    const clip = animationToClipData(anim);
    expect(clip.playMode).toBe('once');
  });

  it('track targets follow bone.rotation_axis pattern', () => {
    const anim = generateAnimation('walk', STANDARD_BONES);
    const clip = animationToClipData(anim);

    for (const track of clip.tracks) {
      expect(track.target).toMatch(/^.+\.rotation_(x|y|z)$/);
    }
  });

  it('track keyframe times are scaled by duration', () => {
    const anim = generateAnimation('idle', STANDARD_BONES);
    const clip = animationToClipData(anim);

    for (const track of clip.tracks) {
      for (const kf of track.keyframes) {
        expect(kf.time).toBeGreaterThanOrEqual(0);
        expect(kf.time).toBeLessThanOrEqual(anim.duration + 0.001);
      }
    }
  });

  it('all keyframe interpolation is linear', () => {
    const anim = generateAnimation('run', STANDARD_BONES);
    const clip = animationToClipData(anim);

    for (const track of clip.tracks) {
      for (const kf of track.keyframes) {
        expect(kf.interpolation).toBe('linear');
      }
    }
  });

  it('empty animation produces empty tracks', () => {
    const anim = generateAnimation('idle', []);
    const clip = animationToClipData(anim);
    expect(clip.tracks.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getAnimationTypeInfo
// ---------------------------------------------------------------------------

describe('getAnimationTypeInfo', () => {
  it.each(ANIMATION_TYPES as unknown as AnimationType[])(
    'returns info for %s',
    (type) => {
      const info = getAnimationTypeInfo(type);
      expect(info.label).not.toBeNull();
      expect(info.description).not.toBeNull();
      expect(typeof info.looping).toBe('boolean');
      expect(info.defaultDuration).toBeGreaterThan(0);
    },
  );
});

// ---------------------------------------------------------------------------
// defaultParams
// ---------------------------------------------------------------------------

describe('defaultParams', () => {
  it('returns sensible defaults', () => {
    const p: AnimationParams = defaultParams();
    expect(p.speed).toBe(1);
    expect(p.amplitude).toBe(1);
    expect(p.style).toBe('realistic');
    expect(p.weight).toBe(1);
  });
});
