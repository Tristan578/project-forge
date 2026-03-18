import { describe, it, expect } from 'vitest';
import { parseSvg } from '../svgImporter';
import type { SvgImportResult } from '../svgImporter';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wrap(inner: string, attrs = ''): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${inner}</svg>`;
}

// ---------------------------------------------------------------------------
// viewBox parsing
// ---------------------------------------------------------------------------

describe('parseSvg - viewBox', () => {
  it('returns null viewBox when absent', () => {
    const result = parseSvg(wrap('<rect width="10" height="10"/>'));
    expect(result.viewBox).toBeNull();
  });

  it('parses a standard viewBox attribute', () => {
    const result = parseSvg(wrap('', 'viewBox="0 0 100 200"'));
    expect(result.viewBox).toEqual({ minX: 0, minY: 0, width: 100, height: 200 });
  });

  it('parses a viewBox with non-zero origin', () => {
    const result = parseSvg(wrap('', 'viewBox="-10 -20 300 400"'));
    expect(result.viewBox).toEqual({ minX: -10, minY: -20, width: 300, height: 400 });
  });

  it('parses a comma-separated viewBox', () => {
    const result = parseSvg(wrap('', 'viewBox="0,0,50,50"'));
    expect(result.viewBox).toEqual({ minX: 0, minY: 0, width: 50, height: 50 });
  });
});

// ---------------------------------------------------------------------------
// <rect> parsing
// ---------------------------------------------------------------------------

describe('parseSvg - rect', () => {
  it('extracts 4 corner points from a basic rect', () => {
    const result = parseSvg(wrap('<rect x="10" y="20" width="30" height="40"/>'));
    expect(result.shapes).toHaveLength(1);
    const shape = result.shapes[0];
    expect(shape.type).toBe('rect');
    expect(shape.points).toHaveLength(4);
    expect(shape.points[0]).toEqual([10, 20]);
    expect(shape.points[1]).toEqual([40, 20]);
    expect(shape.points[2]).toEqual([40, 60]);
    expect(shape.points[3]).toEqual([10, 60]);
  });

  it('defaults x and y to 0 when omitted', () => {
    const result = parseSvg(wrap('<rect width="50" height="50"/>'));
    const shape = result.shapes[0];
    expect(shape.points[0]).toEqual([0, 0]);
    expect(shape.points[2]).toEqual([50, 50]);
  });

  it('preserves the id attribute', () => {
    const result = parseSvg(wrap('<rect id="my-rect" width="10" height="10"/>'));
    expect(result.shapes[0].id).toBe('my-rect');
  });

  it('auto-generates an id when absent', () => {
    const result = parseSvg(wrap('<rect width="10" height="10"/>'));
    expect(result.shapes[0].id).toMatch(/rect-\d+/);
  });

  it('ignores a rect with zero width', () => {
    const result = parseSvg(wrap('<rect width="0" height="10"/>'));
    expect(result.shapes).toHaveLength(0);
  });

  it('ignores a rect with zero height', () => {
    const result = parseSvg(wrap('<rect width="10" height="0"/>'));
    expect(result.shapes).toHaveLength(0);
  });

  it('preserves fill and stroke', () => {
    const result = parseSvg(wrap('<rect width="10" height="10" fill="red" stroke="blue"/>'));
    const shape = result.shapes[0];
    expect(shape.fill).toBe('red');
    expect(shape.stroke).toBe('blue');
  });

  it('preserves transform attribute', () => {
    const result = parseSvg(wrap('<rect width="10" height="10" transform="rotate(45)"/>'));
    expect(result.shapes[0].transform).toBe('rotate(45)');
  });
});

// ---------------------------------------------------------------------------
// <circle> parsing
// ---------------------------------------------------------------------------

describe('parseSvg - circle', () => {
  it('produces at least 16 points for a circle', () => {
    const result = parseSvg(wrap('<circle cx="50" cy="50" r="25"/>'));
    expect(result.shapes).toHaveLength(1);
    const shape = result.shapes[0];
    expect(shape.type).toBe('circle');
    expect(shape.points.length).toBeGreaterThanOrEqual(16);
  });

  it('produces exactly 24 points (default segments)', () => {
    const result = parseSvg(wrap('<circle cx="0" cy="0" r="10"/>'));
    expect(result.shapes[0].points).toHaveLength(24);
  });

  it('first point is approximately (cx+r, cy) for angle=0', () => {
    const result = parseSvg(wrap('<circle cx="10" cy="20" r="5"/>'));
    const pts = result.shapes[0].points;
    expect(pts[0][0]).toBeCloseTo(15, 5);
    expect(pts[0][1]).toBeCloseTo(20, 5);
  });

  it('ignores a circle with zero radius', () => {
    const result = parseSvg(wrap('<circle cx="0" cy="0" r="0"/>'));
    expect(result.shapes).toHaveLength(0);
  });

  it('defaults cx/cy to 0 when omitted', () => {
    const result = parseSvg(wrap('<circle r="10"/>'));
    const pts = result.shapes[0].points;
    // first point should be at (r, 0) = (10, 0)
    expect(pts[0][0]).toBeCloseTo(10, 5);
    expect(pts[0][1]).toBeCloseTo(0, 5);
  });
});

// ---------------------------------------------------------------------------
// <ellipse> parsing
// ---------------------------------------------------------------------------

describe('parseSvg - ellipse', () => {
  it('produces 24 points for an ellipse', () => {
    const result = parseSvg(wrap('<ellipse cx="50" cy="50" rx="30" ry="20"/>'));
    expect(result.shapes[0].points).toHaveLength(24);
  });

  it('has correct semi-axes in the generated points', () => {
    const result = parseSvg(wrap('<ellipse cx="0" cy="0" rx="10" ry="5"/>'));
    const pts = result.shapes[0].points;
    // angle=0 -> (rx, 0)
    expect(pts[0][0]).toBeCloseTo(10, 5);
    expect(pts[0][1]).toBeCloseTo(0, 5);
    // angle=PI/2 (6th segment out of 24) -> (0, ry)
    const quarterIdx = 6;
    expect(pts[quarterIdx][0]).toBeCloseTo(0, 4);
    expect(pts[quarterIdx][1]).toBeCloseTo(5, 4);
  });

  it('ignores an ellipse with zero rx', () => {
    const result = parseSvg(wrap('<ellipse cx="0" cy="0" rx="0" ry="5"/>'));
    expect(result.shapes).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// <polygon> / <polyline> parsing
// ---------------------------------------------------------------------------

describe('parseSvg - polygon', () => {
  it('extracts points directly from polygon', () => {
    const result = parseSvg(wrap('<polygon points="0,0 10,0 10,10 0,10"/>'));
    expect(result.shapes).toHaveLength(1);
    const shape = result.shapes[0];
    expect(shape.type).toBe('polygon');
    expect(shape.points).toEqual([[0, 0], [10, 0], [10, 10], [0, 10]]);
  });

  it('handles space-separated pairs', () => {
    const result = parseSvg(wrap('<polygon points="1 2 3 4 5 6"/>'));
    expect(result.shapes[0].points).toEqual([[1, 2], [3, 4], [5, 6]]);
  });

  it('extracts points from polyline', () => {
    const result = parseSvg(wrap('<polyline points="0,0 100,100 200,0"/>'));
    const shape = result.shapes[0];
    expect(shape.type).toBe('polyline');
    expect(shape.points).toHaveLength(3);
  });

  it('ignores a polygon with fewer than 2 points', () => {
    const result = parseSvg(wrap('<polygon points="0,0"/>'));
    expect(result.shapes).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// <path> parsing
// ---------------------------------------------------------------------------

describe('parseSvg - path', () => {
  it('parses a simple M L Z triangle', () => {
    const result = parseSvg(wrap('<path d="M 0 0 L 10 0 L 5 10 Z"/>'));
    expect(result.shapes).toHaveLength(1);
    const pts = result.shapes[0].points;
    // M(0,0) -> L(10,0) -> L(5,10) -> Z(back to 0,0)
    expect(pts[0]).toEqual([0, 0]);
    expect(pts[1]).toEqual([10, 0]);
    expect(pts[2]).toEqual([5, 10]);
    expect(pts[3]).toEqual([0, 0]);
  });

  it('parses a closed rectangle via path', () => {
    const result = parseSvg(wrap('<path d="M 0 0 L 20 0 L 20 10 L 0 10 Z"/>'));
    const pts = result.shapes[0].points;
    expect(pts).toHaveLength(5); // 4 corners + closing point
  });

  it('parses lowercase m and l (relative)', () => {
    const result = parseSvg(wrap('<path d="m 0 0 l 10 0 l 0 10 z"/>'));
    const pts = result.shapes[0].points;
    expect(pts[0]).toEqual([0, 0]);
    expect(pts[1]).toEqual([10, 0]);
    expect(pts[2]).toEqual([10, 10]);
  });

  it('parses H (horizontal lineto)', () => {
    const result = parseSvg(wrap('<path d="M 0 5 H 10 Z"/>'));
    const pts = result.shapes[0].points;
    expect(pts[1]).toEqual([10, 5]);
  });

  it('parses V (vertical lineto)', () => {
    const result = parseSvg(wrap('<path d="M 5 0 V 10 Z"/>'));
    const pts = result.shapes[0].points;
    expect(pts[1]).toEqual([5, 10]);
  });

  it('treats coordinates after M as implicit lineto (SVG spec)', () => {
    // SVG spec: "M 0 0 10 0 10 10" is equivalent to "M 0 0 L 10 0 L 10 10"
    const result = parseSvg(wrap('<path d="M 0 0 10 0 10 10 Z"/>'));
    expect(result.shapes).toHaveLength(1);
    const pts = result.shapes[0].points;
    expect(pts[0]).toEqual([0, 0]);
    expect(pts[1]).toEqual([10, 0]);
    expect(pts[2]).toEqual([10, 10]);
    expect(pts[3]).toEqual([0, 0]); // Z closes back
  });

  it('treats coordinates after m as implicit relative lineto', () => {
    const result = parseSvg(wrap('<path d="m 0 0 10 0 0 10 Z"/>'));
    expect(result.shapes).toHaveLength(1);
    const pts = result.shapes[0].points;
    expect(pts[0]).toEqual([0, 0]);
    expect(pts[1]).toEqual([10, 0]);
    expect(pts[2]).toEqual([10, 10]);
  });

  it('ignores a path with only one point', () => {
    const result = parseSvg(wrap('<path d="M 10 10"/>'));
    expect(result.shapes).toHaveLength(0);
  });

  it('ignores a path with empty d attribute', () => {
    const result = parseSvg(wrap('<path d=""/>'));
    expect(result.shapes).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Multiple shapes
// ---------------------------------------------------------------------------

describe('parseSvg - multiple shapes', () => {
  it('parses multiple shapes in one SVG', () => {
    const svg = wrap(`
      <rect id="r1" x="0" y="0" width="10" height="10"/>
      <circle id="c1" cx="50" cy="50" r="25"/>
      <polygon id="p1" points="0,0 10,0 5,10"/>
    `, 'viewBox="0 0 100 100"');

    const result = parseSvg(svg);
    expect(result.shapes).toHaveLength(3);
    expect(result.shapes.map((s) => s.id)).toEqual(['r1', 'c1', 'p1']);
    expect(result.shapes.map((s) => s.type)).toEqual(['rect', 'circle', 'polygon']);
    expect(result.viewBox).toEqual({ minX: 0, minY: 0, width: 100, height: 100 });
  });

  it('handles all supported element types in one SVG', () => {
    const svg = wrap(`
      <rect width="10" height="10"/>
      <circle r="5"/>
      <ellipse rx="5" ry="3"/>
      <polygon points="0,0 5,0 5,5"/>
      <polyline points="0,0 10,10"/>
      <path d="M 0 0 L 5 5 Z"/>
    `);
    const result = parseSvg(svg);
    expect(result.shapes).toHaveLength(6);
  });
});

// ---------------------------------------------------------------------------
// Edge cases / invalid input
// ---------------------------------------------------------------------------

describe('parseSvg - edge cases', () => {
  it('returns empty result for empty string', () => {
    const result = parseSvg('');
    expect(result.shapes).toHaveLength(0);
    expect(result.viewBox).toBeNull();
  });

  it('returns empty result for non-SVG input', () => {
    const result = parseSvg('<html><body>hello</body></html>');
    expect(result.shapes).toHaveLength(0);
    expect(result.viewBox).toBeNull();
  });

  it('returns empty result for whitespace-only string', () => {
    const result = parseSvg('   \n   ');
    expect(result.shapes).toHaveLength(0);
  });

  it('handles SVG with no shapes', () => {
    const result = parseSvg(wrap('<g id="empty"></g>'));
    expect(result.shapes).toHaveLength(0);
  });

  it('result conforms to SvgImportResult shape', () => {
    const result: SvgImportResult = parseSvg(wrap('<rect width="5" height="5"/>'));
    expect(result).toHaveProperty('shapes');
    expect(result).toHaveProperty('viewBox');
    expect(Array.isArray(result.shapes)).toBe(true);
  });
});
