import type { WidgetConstraints } from '@/stores/uiBuilderTypes';

export interface WidgetStyle {
  backgroundColor: string | null;
  borderWidth: number;
  borderColor: string;
  borderRadius: number;
  padding: [number, number, number, number];
  opacity: number;
  overflow: 'visible' | 'hidden' | 'scroll';
  fontFamily: string;
  fontSize: number;
  fontWeight: 'normal' | 'bold';
  color: string;
  textAlign: 'left' | 'center' | 'right';
  lineHeight: number;
  textShadow: string | null;
  rotation: number;
  scaleX: number;
  scaleY: number;
}

/**
 * Minimal shape needed to resolve a widget's on-screen box: percentage
 * position/size, a 9-point anchor, and optional pixel constraints. Both the
 * editor preview and the exported runtime resolve through the SAME rules
 * (mirrored, for the export bundle, in `web/src/lib/export/uiRuntime.ts`) so
 * what a creator sees in the editor is what a played/exported game renders.
 */
export interface WidgetPosition {
  x: number;
  y: number;
  width: number;
  height: number;
  anchor: string;
  constraints?: WidgetConstraints | null;
}

export interface ResolvedRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type { WidgetConstraints };

export const DEFAULT_WIDGET_CONSTRAINTS: WidgetConstraints = {
  offsetX: 0,
  offsetY: 0,
  minWidth: null,
  maxWidth: null,
  minHeight: null,
  maxHeight: null,
};

function finiteOr(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function nonNegBoundOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  // A negative size bound is meaningless; clamp to 0 rather than emit a broken
  // (potentially empty) widget.
  return Math.max(0, n);
}

/**
 * Repair arbitrary/untrusted constraint input into a safe, fully-populated
 * `WidgetConstraints`, or `null` when there are no constraints at all. This is
 * the recovery layer for the "invalid work shows actionable errors instead of
 * empty widgets" scenario: NaN offsets collapse to 0, negative or non-finite
 * size bounds collapse to a safe value/`null`, and a fully-absent input stays
 * `null` (pure percentage positioning).
 */
export function normalizeConstraints(raw: unknown): WidgetConstraints | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object') return null;
  const c = raw as Partial<Record<keyof WidgetConstraints, unknown>>;
  return {
    offsetX: finiteOr(c.offsetX, 0),
    offsetY: finiteOr(c.offsetY, 0),
    minWidth: nonNegBoundOrNull(c.minWidth),
    maxWidth: nonNegBoundOrNull(c.maxWidth),
    minHeight: nonNegBoundOrNull(c.minHeight),
    maxHeight: nonNegBoundOrNull(c.maxHeight),
  };
}

/**
 * Clamp a base pixel size against optional min/max bounds, matching CSS
 * resolution order: max is applied first, then min wins (so `min > max`
 * resolves to `min`, never a collapsed/negative box).
 */
export function clampSize(base: number, min: number | null, max: number | null): number {
  let v = Number.isFinite(base) ? base : 0;
  if (max !== null && Number.isFinite(max)) v = Math.min(v, max);
  if (min !== null && Number.isFinite(min)) v = Math.max(v, min);
  return Math.max(0, v);
}

/**
 * Build a `calc()` expression combining a percentage base with a signed pixel
 * delta, or a bare percentage when the delta is 0. Formats negative deltas as
 * `- Npx` (rather than `+ -Npx`) for clean, valid CSS.
 */
function calcPct(pct: number, px: number): string {
  if (px === 0 || !Number.isFinite(px)) return `${pct}%`;
  const sign = px >= 0 ? '+' : '-';
  return `calc(${pct}% ${sign} ${Math.abs(px)}px)`;
}

/** Horizontal anchor factor: 0 = left edge, 0.5 = centered, 1 = right edge. */
function horizontalFactor(anchor: string): number {
  if (anchor === 'top_center' || anchor === 'center' || anchor === 'bottom_center') return 0.5;
  if (anchor === 'top_right' || anchor === 'center_right' || anchor === 'bottom_right') return 1;
  // Unknown/missing anchor falls back to absolute (top-left) positioning.
  return 0;
}

/** Vertical anchor factor: 0 = top edge, 0.5 = centered, 1 = bottom edge. */
function verticalFactor(anchor: string): number {
  if (anchor === 'center_left' || anchor === 'center' || anchor === 'center_right') return 0.5;
  if (anchor === 'bottom_left' || anchor === 'bottom_center' || anchor === 'bottom_right') return 1;
  return 0;
}

/**
 * Resolve a widget to a concrete pixel rectangle within a container of the
 * given pixel dimensions. This is the numeric oracle for the CSS produced by
 * {@link widgetPositionCSS}: the browser computes the same box from that CSS at
 * any viewport width, and tests assert on these numbers directly (e.g. that a
 * button stays fully on-screen from 360px to 1440px).
 */
export function resolveWidgetRect(
  widget: WidgetPosition,
  containerWidthPx: number,
  containerHeightPx: number
): ResolvedRect {
  const c = normalizeConstraints(widget.constraints);
  const cw = finiteOr(containerWidthPx, 0);
  const ch = finiteOr(containerHeightPx, 0);

  const baseW = (finiteOr(widget.width, 0) / 100) * cw;
  const baseH = (finiteOr(widget.height, 0) / 100) * ch;
  const width = clampSize(baseW, c?.minWidth ?? null, c?.maxWidth ?? null);
  const height = clampSize(baseH, c?.minHeight ?? null, c?.maxHeight ?? null);

  const anchor = widget.anchor || 'top_left';
  const kx = horizontalFactor(anchor);
  const ky = verticalFactor(anchor);
  const offX = c?.offsetX ?? 0;
  const offY = c?.offsetY ?? 0;

  const left = (finiteOr(widget.x, 0) / 100) * cw + offX - kx * width;
  const top = (finiteOr(widget.y, 0) / 100) * ch + offY - ky * height;

  return { left, top, width, height };
}

export function widgetStyleToCSS(style: WidgetStyle): React.CSSProperties {
  const css: React.CSSProperties = {};

  if (style.backgroundColor !== null) {
    css.backgroundColor = style.backgroundColor;
  }

  if (style.borderWidth > 0) {
    css.border = `${style.borderWidth}px solid ${style.borderColor}`;
  }

  if (style.borderRadius > 0) {
    css.borderRadius = `${style.borderRadius}px`;
  }

  if (style.padding) {
    css.padding = `${style.padding[0]}px ${style.padding[1]}px ${style.padding[2]}px ${style.padding[3]}px`;
  }

  css.opacity = style.opacity;
  css.overflow = style.overflow;
  css.fontFamily = style.fontFamily;
  css.fontSize = `${style.fontSize}px`;
  css.fontWeight = style.fontWeight;
  css.color = style.color;
  css.textAlign = style.textAlign;
  css.lineHeight = style.lineHeight;

  if (style.textShadow) {
    css.textShadow = style.textShadow;
  }

  const transforms: string[] = [];
  if (style.rotation !== 0) {
    transforms.push(`rotate(${style.rotation}deg)`);
  }
  if (style.scaleX !== 1 || style.scaleY !== 1) {
    transforms.push(`scale(${style.scaleX}, ${style.scaleY})`);
  }

  if (transforms.length > 0) {
    css.transform = transforms.join(' ');
  }

  return css;
}

/**
 * Container-agnostic CSS for a widget's position and size, honouring anchor and
 * constraints. Percentages keep the layout responsive (the browser re-resolves
 * on every viewport change); pixel offsets are folded into `calc(...)` and
 * pixel size bounds become `min/maxWidth`/`min/maxHeight` so the browser clamps
 * automatically — matching {@link resolveWidgetRect}.
 *
 * Returns any anchor-centering translate in `layoutTransform` rather than
 * `transform`, so callers can compose it with a widget's own rotate/scale
 * transform instead of overwriting one with the other.
 */
export function widgetPositionCSS(
  widget: WidgetPosition
): React.CSSProperties & { layoutTransform?: string } {
  const c = normalizeConstraints(widget.constraints);
  const css: React.CSSProperties & { layoutTransform?: string } = {
    position: 'absolute',
    width: `${widget.width}%`,
    height: `${widget.height}%`,
  };

  if (c) {
    if (c.minWidth !== null) css.minWidth = `${c.minWidth}px`;
    if (c.maxWidth !== null) css.maxWidth = `${c.maxWidth}px`;
    if (c.minHeight !== null) css.minHeight = `${c.minHeight}px`;
    if (c.maxHeight !== null) css.maxHeight = `${c.maxHeight}px`;
  }

  const offX = c?.offsetX ?? 0;
  const offY = c?.offsetY ?? 0;
  const anchor = widget.anchor || 'top_left';
  const kx = horizontalFactor(anchor);
  const ky = verticalFactor(anchor);
  const transforms: string[] = [];

  // Horizontal
  if (kx === 1) {
    // right = (100 - x)% - offX  (positive offX nudges the box rightward)
    css.right = calcPct(100 - widget.x, -offX);
  } else {
    css.left = calcPct(widget.x, offX);
    if (kx === 0.5) transforms.push('translateX(-50%)');
  }

  // Vertical
  if (ky === 1) {
    css.bottom = calcPct(100 - widget.y, -offY);
  } else {
    css.top = calcPct(widget.y, offY);
    if (ky === 0.5) transforms.push('translateY(-50%)');
  }

  if (transforms.length > 0) {
    css.transform = transforms.join(' ');
    css.layoutTransform = transforms.join(' ');
  }

  return css;
}
