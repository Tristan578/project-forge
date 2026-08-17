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

interface Node {
  type: string;
  props: Record<string, unknown> & { children?: unknown };
}

function svgOf(size: number) {
  const el = BrandMark({ size }) as unknown as { type: string; props: SvgProps };
  return el;
}

/** Every element below the root `svg`, flattened — the tree is nested now. */
function descendants(root: { props: SvgProps }): Node[] {
  const out: Node[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== 'object' || !('type' in node)) return;
    const el = node as Node;
    out.push(el);
    walk(el.props?.children);
  };
  walk(root.props.children);
  return out;
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
    const types = descendants(svgOf(16)).map((c) => c.type);
    expect(types.sort()).toEqual(['g', 'path']);
    // An `href`/`xlink:href`/`url()` fill would reintroduce exactly the remote
    // fetch this component exists to remove.
    for (const node of descendants(svgOf(16))) {
      expect(JSON.stringify(node.props)).not.toMatch(/href|url\(/);
    }
  });

  it('is a single closed silhouette, not several disjoint shapes', () => {
    // The mark this replaced was a rounded pill with a separate stub beneath
    // it. Every other assertion in this file passed on it, and it rendered as a
    // paint roller — at 16px, a shape whose parts only meet by overlapping is
    // the first thing to fall apart as pixels drop out.
    //
    // This cannot judge whether the silhouette is a GOOD one; only a render can
    // (`scratchpad` script in the PR, satori at all three production sizes).
    // What it can do is fail the class of change that reintroduced the problem:
    // adding a second drawing primitive rather than extending the outline.
    const drawn = descendants(svgOf(16)).filter((c) => c.type !== 'g');
    expect(drawn).toHaveLength(1);
    expect(drawn[0].type).toBe('path');
    // A `d` broken into subpaths is disjoint by another spelling: `M` may open
    // the outline once, and `Z` may close it once.
    const d = String(drawn[0].props.d);
    expect(d.match(/M/gi)).toHaveLength(1);
    expect(d.match(/Z/gi)).toHaveLength(1);
  });
});
