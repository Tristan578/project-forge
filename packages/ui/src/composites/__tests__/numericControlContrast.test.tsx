/** Numeric inspector controls must retain readable labels, values and slider handles. */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Vec3Input } from '../Vec3Input';
import { SliderInput } from '../SliderInput';
import { THEME_DEFINITIONS } from '../../tokens/themes';
  function linearizeChannel(c8bit: number): number {
    const s = c8bit / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }

  function relativeLuminance(hex: string): number {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return 0.2126 * linearizeChannel(r) + 0.7152 * linearizeChannel(g) + 0.0722 * linearizeChannel(b);
  }

  function contrastRatio(hex1: string, hex2: string): number {
    const L1 = relativeLuminance(hex1);
    const L2 = relativeLuminance(hex2);
    const lighter = Math.max(L1, L2);
    const darker = Math.min(L1, L2);
    return (lighter + 0.05) / (darker + 0.05);
  }


describe('numeric control contrast', () => {
  it.each(Object.entries(THEME_DEFINITIONS))('%s labels, readouts and handles meet their contrast floors', (_name, tokens) => {
    render(<><Vec3Input label="Size" value={[1,2,3]} onChange={() => {}} /><SliderInput label="Mix" value={50} onChange={() => {}} /></>);
    for (const text of ['X', 'Y', 'Z', '50']) {
      const element = screen.getByText(text);
      const token = element.style.color.match(/^var\((--sf-[a-z-]+)\)$/)?.[1];
      expect(token).toBeDefined();
      const foreground = tokens[token as keyof typeof tokens];
      expect(foreground).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(contrastRatio(foreground, tokens['--sf-bg-surface'])).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrastRatio(tokens['--sf-text'], tokens['--sf-bg-elevated'])).toBeGreaterThanOrEqual(3);
  });
});
