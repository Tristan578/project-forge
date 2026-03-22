/**
 * SVG Importer — parses SVG markup into collision-ready polygon shapes.
 *
 * Supports: rect, circle, ellipse, polygon, polyline, and basic path (M/L/Z).
 * All coordinates are mapped into viewBox space if a viewBox is present.
 */

export type SvgShapeType = 'rect' | 'circle' | 'ellipse' | 'polygon' | 'polyline' | 'path';

export interface SvgShape {
  /** Unique identifier (uses the element's `id` attribute or an auto-generated index). */
  id: string;
  type: SvgShapeType;
  /** Clockwise polygon points in viewBox coordinate space. */
  points: [number, number][];
  /** Raw CSS/SVG fill value, if present on the element. */
  fill?: string;
  /** Raw CSS/SVG stroke value, if present on the element. */
  stroke?: string;
  /** Serialised transform string, if present on the element. */
  transform?: string;
}

export interface SvgViewBox {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

export interface SvgImportResult {
  shapes: SvgShape[];
  viewBox: SvgViewBox | null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Parse a `viewBox="minX minY width height"` string. */
function parseViewBox(raw: string): SvgViewBox | null {
  const parts = raw.trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some(isNaN)) return null;
  return { minX: parts[0], minY: parts[1], width: parts[2], height: parts[3] };
}

/** Extract a single attribute value from an SVG tag string. */
function attr(tag: string, name: string): string | undefined {
  // Match both `name="value"` and `name='value'`
  const re = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i');
  const m = re.exec(tag);
  return m ? m[1] : undefined;
}

/** Parse a numeric attribute, returning NaN when absent. */
function numAttr(tag: string, name: string): number {
  const v = attr(tag, name);
  return v !== undefined ? parseFloat(v) : NaN;
}

/** Generate an approximate polygon for a circle/ellipse with `segments` points. */
function ellipsePoints(cx: number, cy: number, rx: number, ry: number, segments = 24): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    pts.push([cx + rx * Math.cos(angle), cy + ry * Math.sin(angle)]);
  }
  return pts;
}

/** Parse a space/comma-separated list of coordinate pairs: "x1,y1 x2,y2 …" */
function parsePairList(raw: string): [number, number][] {
  const nums = raw.trim().split(/[\s,]+/).map(Number);
  const pts: [number, number][] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    if (!isNaN(nums[i]) && !isNaN(nums[i + 1])) {
      pts.push([nums[i], nums[i + 1]]);
    }
  }
  return pts;
}

/**
 * Minimal path parser: handles M/m (moveto), L/l (lineto), H/h (horizontal),
 * V/v (vertical), Z/z (closepath).
 * Each sub-path between M and Z (or next M) becomes its own set of points.
 * We concatenate all sub-paths into one array for single-shape simplicity.
 */
function parsePathData(d: string): [number, number][] {
  const result: [number, number][] = [];

  // Tokenise: split on command letters while keeping them
  const tokens = d
    .trim()
    .replace(/([MmLlZzHhVvCcSsQqTtAa])/g, ' $1 ')
    .split(/\s+/)
    .filter(Boolean);

  let i = 0;
  let currentX = 0;
  let currentY = 0;
  let subPathStart: [number, number] | null = null;

  while (i < tokens.length) {
    const cmd = tokens[i];
    i++;

    if (cmd === 'M' || cmd === 'm') {
      const x = parseFloat(tokens[i] ?? 'NaN');
      const y = parseFloat(tokens[i + 1] ?? 'NaN');
      i += 2;
      if (isNaN(x) || isNaN(y)) continue;
      if (cmd === 'm') {
        currentX += x;
        currentY += y;
      } else {
        currentX = x;
        currentY = y;
      }
      subPathStart = [currentX, currentY];
      result.push([currentX, currentY]);

      // SVG spec: coordinates after M/m are treated as implicit L/l commands
      while (i < tokens.length && !isNaN(parseFloat(tokens[i]))) {
        const ix = parseFloat(tokens[i] ?? 'NaN');
        const iy = parseFloat(tokens[i + 1] ?? 'NaN');
        i += 2;
        if (isNaN(ix) || isNaN(iy)) break;
        if (cmd === 'm') {
          currentX += ix;
          currentY += iy;
        } else {
          currentX = ix;
          currentY = iy;
        }
        result.push([currentX, currentY]);
      }
    } else if (cmd === 'L' || cmd === 'l') {
      // SVG spec: repeated coordinate pairs after L/l are implicit lineto commands
      while (i < tokens.length && !isNaN(parseFloat(tokens[i]))) {
        const x = parseFloat(tokens[i] ?? 'NaN');
        const y = parseFloat(tokens[i + 1] ?? 'NaN');
        i += 2;
        if (isNaN(x) || isNaN(y)) break;
        if (cmd === 'l') {
          currentX += x;
          currentY += y;
        } else {
          currentX = x;
          currentY = y;
        }
        result.push([currentX, currentY]);
      }
    } else if (cmd === 'H' || cmd === 'h') {
      const x = parseFloat(tokens[i] ?? 'NaN');
      i++;
      if (isNaN(x)) continue;
      currentX = cmd === 'h' ? currentX + x : x;
      result.push([currentX, currentY]);
    } else if (cmd === 'V' || cmd === 'v') {
      const y = parseFloat(tokens[i] ?? 'NaN');
      i++;
      if (isNaN(y)) continue;
      currentY = cmd === 'v' ? currentY + y : y;
      result.push([currentX, currentY]);
    } else if (cmd === 'Z' || cmd === 'z') {
      if (subPathStart) {
        const last = result[result.length - 1];
        if (!last || last[0] !== subPathStart[0] || last[1] !== subPathStart[1]) {
          result.push([subPathStart[0], subPathStart[1]]);
        }
        currentX = subPathStart[0];
        currentY = subPathStart[1];
      }
    }
    // Unknown/unsupported commands (C, S, Q, T, A) are skipped.
  }

  return result;
}

// ---------------------------------------------------------------------------
// Tag-level parsers
// ---------------------------------------------------------------------------

function parseRect(tag: string, index: number): SvgShape | null {
  const x = numAttr(tag, 'x') || 0;
  const y = numAttr(tag, 'y') || 0;
  const w = numAttr(tag, 'width');
  const h = numAttr(tag, 'height');
  if (isNaN(w) || isNaN(h) || w <= 0 || h <= 0) return null;

  const points: [number, number][] = [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ];

  return {
    id: attr(tag, 'id') ?? `rect-${index}`,
    type: 'rect',
    points,
    fill: attr(tag, 'fill'),
    stroke: attr(tag, 'stroke'),
    transform: attr(tag, 'transform'),
  };
}

function parseCircle(tag: string, index: number): SvgShape | null {
  const cx = numAttr(tag, 'cx') || 0;
  const cy = numAttr(tag, 'cy') || 0;
  const r = numAttr(tag, 'r');
  if (isNaN(r) || r <= 0) return null;

  return {
    id: attr(tag, 'id') ?? `circle-${index}`,
    type: 'circle',
    points: ellipsePoints(cx, cy, r, r, 24),
    fill: attr(tag, 'fill'),
    stroke: attr(tag, 'stroke'),
    transform: attr(tag, 'transform'),
  };
}

function parseEllipse(tag: string, index: number): SvgShape | null {
  const cx = numAttr(tag, 'cx') || 0;
  const cy = numAttr(tag, 'cy') || 0;
  const rx = numAttr(tag, 'rx');
  const ry = numAttr(tag, 'ry');
  if (isNaN(rx) || isNaN(ry) || rx <= 0 || ry <= 0) return null;

  return {
    id: attr(tag, 'id') ?? `ellipse-${index}`,
    type: 'ellipse',
    points: ellipsePoints(cx, cy, rx, ry, 24),
    fill: attr(tag, 'fill'),
    stroke: attr(tag, 'stroke'),
    transform: attr(tag, 'transform'),
  };
}

function parsePolygon(tag: string, index: number, type: 'polygon' | 'polyline'): SvgShape | null {
  const pointsAttr = attr(tag, 'points');
  if (!pointsAttr) return null;
  const points = parsePairList(pointsAttr);
  if (points.length < 2) return null;

  return {
    id: attr(tag, 'id') ?? `${type}-${index}`,
    type,
    points,
    fill: attr(tag, 'fill'),
    stroke: attr(tag, 'stroke'),
    transform: attr(tag, 'transform'),
  };
}

function parsePath(tag: string, index: number): SvgShape | null {
  const d = attr(tag, 'd');
  if (!d) return null;
  const points = parsePathData(d);
  if (points.length < 2) return null;

  return {
    id: attr(tag, 'id') ?? `path-${index}`,
    type: 'path',
    points,
    fill: attr(tag, 'fill'),
    stroke: attr(tag, 'stroke'),
    transform: attr(tag, 'transform'),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse an SVG string and extract all supported shapes as collision polygons.
 *
 * @param svgContent - Raw SVG markup (UTF-8 string).
 * @returns Parsed shapes and optional viewBox metadata.
 */
export function parseSvg(svgContent: string): SvgImportResult {
  if (!svgContent || typeof svgContent !== 'string') {
    return { shapes: [], viewBox: null };
  }

  // Extract viewBox from the root <svg> element
  const svgTagMatch = /<svg\b([^>]*)>/i.exec(svgContent);
  let viewBox: SvgViewBox | null = null;
  if (svgTagMatch) {
    const vbRaw = attr(svgTagMatch[0], 'viewBox');
    if (vbRaw) viewBox = parseViewBox(vbRaw);
  }

  // Match self-closing and open tags for supported element types.
  // Note: regex-based parsing is intentional here to keep this module
  // dependency-free and usable in both Node (Vitest) and browser environments.
  const tagRe = /<(rect|circle|ellipse|polygon|polyline|path)\b([^>]*?)\/?>|<(rect|circle|ellipse|polygon|polyline|path)\b([^>]*)>/gi;

  const shapes: SvgShape[] = [];
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = tagRe.exec(svgContent)) !== null) {
    const elementName = (match[1] ?? match[3] ?? '').toLowerCase() as SvgShapeType;
    const tagBody = match[0];

    let shape: SvgShape | null = null;

    switch (elementName) {
      case 'rect':
        shape = parseRect(tagBody, index);
        break;
      case 'circle':
        shape = parseCircle(tagBody, index);
        break;
      case 'ellipse':
        shape = parseEllipse(tagBody, index);
        break;
      case 'polygon':
        shape = parsePolygon(tagBody, index, 'polygon');
        break;
      case 'polyline':
        shape = parsePolygon(tagBody, index, 'polyline');
        break;
      case 'path':
        shape = parsePath(tagBody, index);
        break;
    }

    if (shape) {
      shapes.push(shape);
    }
    index++;
  }

  return { shapes, viewBox };
}
