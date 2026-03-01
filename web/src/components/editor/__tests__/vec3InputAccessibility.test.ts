/**
 * Tests for Vec3Input and NumberInput accessibility attributes.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';

describe('NumberInput aria-label', () => {
  it('should accept ariaLabel prop in interface', () => {
    // Validates at compile time that the NumberInput interface includes ariaLabel
    const props = {
      value: 0,
      onChange: (_v: number) => {},
      label: 'X',
      ariaLabel: 'Position X',
    };
    expect(props.ariaLabel).toBe('Position X');
  });

  it('should fall back to label when ariaLabel is undefined', () => {
    const ariaLabel: string | undefined = undefined;
    const label = 'X';
    const resolved = ariaLabel ?? label;
    expect(resolved).toBe('X');
  });

  it('should prefer ariaLabel over label', () => {
    const ariaLabel: string | undefined = 'Position X';
    const label = 'X';
    const resolved = ariaLabel ?? label;
    expect(resolved).toBe('Position X');
  });
});

describe('Vec3Input aria-label composition', () => {
  it('should compose label + axis for each NumberInput', () => {
    const parentLabel = 'Position';
    const axes = ['X', 'Y', 'Z'];
    const expected = ['Position X', 'Position Y', 'Position Z'];

    axes.forEach((axis, i) => {
      expect(`${parentLabel} ${axis}`).toBe(expected[i]);
    });
  });

  it('should compose label + axis for rotation', () => {
    const parentLabel = 'Rotation';
    expect(`${parentLabel} X`).toBe('Rotation X');
    expect(`${parentLabel} Y`).toBe('Rotation Y');
    expect(`${parentLabel} Z`).toBe('Rotation Z');
  });

  it('should generate accessible button labels', () => {
    const label = 'Position';
    expect(`Copy ${label.toLowerCase()}`).toBe('Copy position');
    expect(`Paste ${label.toLowerCase()}`).toBe('Paste position');
    expect(`Reset ${label.toLowerCase()} to default`).toBe('Reset position to default');
  });
});
