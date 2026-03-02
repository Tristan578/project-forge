import { describe, it, expect } from 'vitest';
import { linearToHex, hexToLinear, radToDeg, degToRad } from '../colorUtils';

describe('linearToHex', () => {
  it('should convert black (0,0,0) to #000000', () => {
    expect(linearToHex(0, 0, 0)).toBe('#000000');
  });

  it('should convert white (1,1,1) to #ffffff', () => {
    expect(linearToHex(1, 1, 1)).toBe('#ffffff');
  });

  it('should apply gamma correction (sRGB)', () => {
    // Linear 0.5 → sRGB ~0.73 → hex ~0xBA
    const hex = linearToHex(0.5, 0.5, 0.5);
    // With gamma 1/2.2, 0.5^(1/2.2) ≈ 0.7297 → round(0.7297*255) = 186 = 0xBA
    expect(hex).toBe('#bababa');
  });

  it('should clamp values above 1', () => {
    expect(linearToHex(2, 1, 0)).toBe('#ff' + 'ff' + '00');
  });

  it('should clamp values below 0', () => {
    expect(linearToHex(-1, 0, 0)).toBe('#000000');
  });

  it('should handle pure red', () => {
    const hex = linearToHex(1, 0, 0);
    expect(hex).toBe('#ff0000');
  });

  it('should handle pure green', () => {
    const hex = linearToHex(0, 1, 0);
    expect(hex).toBe('#00ff00');
  });

  it('should handle pure blue', () => {
    const hex = linearToHex(0, 0, 1);
    expect(hex).toBe('#0000ff');
  });
});

describe('hexToLinear', () => {
  it('should convert #000000 to [0, 0, 0]', () => {
    const [r, g, b] = hexToLinear('#000000');
    expect(r).toBeCloseTo(0);
    expect(g).toBeCloseTo(0);
    expect(b).toBeCloseTo(0);
  });

  it('should convert #ffffff to [1, 1, 1]', () => {
    const [r, g, b] = hexToLinear('#ffffff');
    expect(r).toBeCloseTo(1);
    expect(g).toBeCloseTo(1);
    expect(b).toBeCloseTo(1);
  });

  it('should convert #ff0000 to linear red', () => {
    const [r, g, b] = hexToLinear('#ff0000');
    expect(r).toBeCloseTo(1);
    expect(g).toBeCloseTo(0);
    expect(b).toBeCloseTo(0);
  });

  it('should apply inverse gamma (to linear)', () => {
    // sRGB 0xBA/255 ≈ 0.7294 → linear = 0.7294^2.2 ≈ 0.5
    const [r] = hexToLinear('#bababa');
    expect(r).toBeCloseTo(0.5, 1);
  });

  it('should roundtrip with linearToHex', () => {
    const original = [0.3, 0.6, 0.9] as const;
    const hex = linearToHex(original[0], original[1], original[2]);
    const [r, g, b] = hexToLinear(hex);
    expect(r).toBeCloseTo(original[0], 1);
    expect(g).toBeCloseTo(original[1], 1);
    expect(b).toBeCloseTo(original[2], 1);
  });
});

describe('radToDeg', () => {
  it('should convert 0 radians to 0 degrees', () => {
    expect(radToDeg(0)).toBe(0);
  });

  it('should convert PI to 180 degrees', () => {
    expect(radToDeg(Math.PI)).toBeCloseTo(180);
  });

  it('should convert PI/2 to 90 degrees', () => {
    expect(radToDeg(Math.PI / 2)).toBeCloseTo(90);
  });

  it('should convert 2*PI to 360 degrees', () => {
    expect(radToDeg(2 * Math.PI)).toBeCloseTo(360);
  });

  it('should handle negative radians', () => {
    expect(radToDeg(-Math.PI)).toBeCloseTo(-180);
  });
});

describe('degToRad', () => {
  it('should convert 0 degrees to 0 radians', () => {
    expect(degToRad(0)).toBe(0);
  });

  it('should convert 180 degrees to PI', () => {
    expect(degToRad(180)).toBeCloseTo(Math.PI);
  });

  it('should convert 90 degrees to PI/2', () => {
    expect(degToRad(90)).toBeCloseTo(Math.PI / 2);
  });

  it('should convert 360 degrees to 2*PI', () => {
    expect(degToRad(360)).toBeCloseTo(2 * Math.PI);
  });

  it('should roundtrip with radToDeg', () => {
    expect(radToDeg(degToRad(45))).toBeCloseTo(45);
    expect(degToRad(radToDeg(1.5))).toBeCloseTo(1.5);
  });
});
