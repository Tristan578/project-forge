/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { BrandMark } from '../BrandMark';

interface SvgProps {
  width?: number;
  height?: number;
  viewBox?: string;
  children?: unknown;
}

function svgOf(size: number) {
  const el = BrandMark({ size }) as unknown as { type: string; props: SvgProps };
  return el;
}

describe('BrandMark', () => {
  it('is an svg element', () => {
    expect(svgOf(16).type).toBe('svg');
  });

  it('scales with size', () => {
    // The badges call this at three different sizes to keep the proportions the
    // glyph had. Hardcoding the viewBox dimension would pass every render test
    // in the suite while silently pinning all three to one size.
    for (const size of [16, 44, 52]) {
      const { props } = svgOf(size);
      expect(props.width).toBe(size);
      expect(props.height).toBe(size);
    }
  });

  it('keeps a fixed viewBox so the path coordinates stay meaningful', () => {
    expect(svgOf(16).props.viewBox).toBe('0 0 32 32');
    expect(svgOf(52).props.viewBox).toBe('0 0 32 32');
  });

  it('draws only primitives satori supports, with no remote reference', () => {
    const children = svgOf(16).props.children as { type: string; props: Record<string, unknown> }[];
    const types = children.filter(Boolean).map((c) => c.type);
    expect(types).toEqual(['path', 'rect']);
    // An `href`/`xlink:href`/`url()` fill would reintroduce exactly the remote
    // fetch this component exists to remove.
    for (const child of children) {
      expect(JSON.stringify(child.props)).not.toMatch(/href|url\(/);
    }
  });
});
