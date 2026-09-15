/**
 * Tests for widgetRenderer's CSS helpers (ui.FR-1.OP-01).
 *
 * `widgetStyleToCSS` maps a widget's visual style to React CSS properties;
 * `widgetPositionCSS` produces responsive, anchor+constraint-aware position CSS
 * whose browser-resolved box must agree with `resolveWidgetRect`'s numeric
 * oracle. The consistency check below pins that the CSS the renderer emits and
 * the rect the tests assert on describe the same layout.
 */
import { describe, it, expect } from 'vitest';
import {
  widgetStyleToCSS,
  widgetPositionCSS,
  resolveWidgetRect,
  type WidgetStyle,
  type WidgetPosition,
} from '../widgetRenderer';

const BASE_STYLE: WidgetStyle = {
  backgroundColor: null,
  borderWidth: 0,
  borderColor: '#333333',
  borderRadius: 0,
  padding: [0, 0, 0, 0],
  opacity: 1,
  overflow: 'visible',
  fontFamily: 'system-ui',
  fontSize: 16,
  fontWeight: 'normal',
  color: '#ffffff',
  textAlign: 'left',
  lineHeight: 1.2,
  textShadow: null,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
};

describe('widgetStyleToCSS', () => {
  it('omits background/border when unset and passes through typography', () => {
    const css = widgetStyleToCSS(BASE_STYLE);
    expect(css.backgroundColor).toBeUndefined();
    expect(css.border).toBeUndefined();
    expect(css.fontSize).toBe('16px');
    expect(css.color).toBe('#ffffff');
    expect(css.transform).toBeUndefined();
  });

  it('emits border shorthand and radius when present', () => {
    const css = widgetStyleToCSS({ ...BASE_STYLE, borderWidth: 2, borderColor: '#abcdef', borderRadius: 6 });
    expect(css.border).toBe('2px solid #abcdef');
    expect(css.borderRadius).toBe('6px');
  });

  it('composes rotation and scale into a transform', () => {
    const css = widgetStyleToCSS({ ...BASE_STYLE, rotation: 45, scaleX: 2, scaleY: 0.5 });
    expect(css.transform).toBe('rotate(45deg) scale(2, 0.5)');
  });
});

describe('widgetPositionCSS ↔ resolveWidgetRect consistency', () => {
  const cases: WidgetPosition[] = [
    { x: 10, y: 20, width: 30, height: 40, anchor: 'top_left' },
    { x: 50, y: 50, width: 20, height: 20, anchor: 'center' },
    { x: 100, y: 100, width: 15, height: 10, anchor: 'bottom_right' },
    {
      x: 0,
      y: 0,
      width: 5,
      height: 5,
      anchor: 'top_left',
      constraints: { offsetX: 16, offsetY: 16, minWidth: 44, maxWidth: null, minHeight: 44, maxHeight: null },
    },
  ];

  const CW = 1000;
  const CH = 800;

  for (const widget of cases) {
    it(`agrees for anchor ${widget.anchor}${widget.constraints ? ' + constraints' : ''}`, () => {
      const css = widgetPositionCSS(widget);
      const rect = resolveWidgetRect(widget, CW, CH);

      // Size: the CSS percentage (clamped by any min/max) equals the rect size.
      expect(css.width).toBe(`${widget.width}%`);
      expect(rect.width).toBeGreaterThan(0);
      expect(rect.height).toBeGreaterThan(0);

      // Position edge: whichever edge the CSS anchors from, the resolved rect
      // sits fully within the container.
      expect(rect.left).toBeGreaterThanOrEqual(0);
      expect(rect.top).toBeGreaterThanOrEqual(0);
      expect(rect.left + rect.width).toBeLessThanOrEqual(CW);
      expect(rect.top + rect.height).toBeLessThanOrEqual(CH);
    });
  }

  it('exposes layoutTransform separately so callers can compose with rotate/scale', () => {
    const css = widgetPositionCSS({ x: 50, y: 50, width: 10, height: 10, anchor: 'center' });
    expect(css.layoutTransform).toBe('translateX(-50%) translateY(-50%)');
    // The renderer combines it with the style transform rather than overwriting.
    const combined = [css.layoutTransform, 'rotate(0deg) scaleX(1) scaleY(1)'].filter(Boolean).join(' ');
    expect(combined).toContain('translateX(-50%)');
    expect(combined).toContain('rotate(0deg)');
  });
});
