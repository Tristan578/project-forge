/**
 * Anchor + constraint resolution — ui.FR-1.OP-01 (responsive
 * constraints/anchors/layout editor).
 *
 * Covers the resolution math (edge anchors, 0%/100% edge cases, negative
 * offsets, min/max size clamping, missing-anchor fallback to absolute) and the
 * `ui-score3-v1` responsive fixture: a title/HUD/settings flow whose core
 * actions must adapt from 360px mobile to 1440px desktop without clipping.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveWidgetRect,
  clampSize,
  normalizeConstraints,
  widgetPositionCSS,
  DEFAULT_WIDGET_CONSTRAINTS,
  type WidgetPosition,
} from '../widgetRenderer';
import type { WidgetConstraints } from '@/stores/uiBuilderTypes';

const VIEWPORTS = [
  { name: '360px mobile', w: 360, h: 640 },
  { name: '768px tablet', w: 768, h: 1024 },
  { name: '1440px desktop', w: 1440, h: 900 },
];

function withConstraints(over: Partial<WidgetConstraints>): WidgetConstraints {
  return { ...DEFAULT_WIDGET_CONSTRAINTS, ...over };
}

describe('normalizeConstraints', () => {
  it('returns null for absent constraints (pure percentage/anchor fallback)', () => {
    expect(normalizeConstraints(null)).toBeNull();
    expect(normalizeConstraints(undefined)).toBeNull();
  });

  it('repairs NaN/non-finite offsets to 0', () => {
    const c = normalizeConstraints({ offsetX: NaN, offsetY: Infinity });
    expect(c).not.toBeNull();
    expect(c!.offsetX).toBe(0);
    expect(c!.offsetY).toBe(0);
  });

  it('collapses negative size bounds to 0 rather than emitting a broken box', () => {
    const c = normalizeConstraints({ minWidth: -50, maxHeight: -1 });
    expect(c!.minWidth).toBe(0);
    expect(c!.maxHeight).toBe(0);
  });

  it('keeps missing size bounds as null (unbounded)', () => {
    const c = normalizeConstraints({ offsetX: 10 });
    expect(c!.minWidth).toBeNull();
    expect(c!.maxWidth).toBeNull();
    expect(c!.minHeight).toBeNull();
    expect(c!.maxHeight).toBeNull();
  });
});

describe('clampSize', () => {
  it('is a no-op when unbounded', () => {
    expect(clampSize(120, null, null)).toBe(120);
  });
  it('applies a max upper bound', () => {
    expect(clampSize(200, null, 150)).toBe(150);
  });
  it('applies a min lower bound (keeps a 44px touch target)', () => {
    expect(clampSize(18, 44, null)).toBe(44);
  });
  it('lets min win over max when min > max (CSS order)', () => {
    expect(clampSize(10, 80, 40)).toBe(80);
  });
  it('never returns a negative size', () => {
    expect(clampSize(-10, null, null)).toBe(0);
  });
});

describe('resolveWidgetRect — anchor math', () => {
  const base: WidgetPosition = { x: 0, y: 0, width: 10, height: 10, anchor: 'top_left' };

  it('top_left places the box at the raw percentage origin', () => {
    const r = resolveWidgetRect({ ...base, x: 0, y: 0 }, 1000, 1000);
    expect(r).toEqual({ left: 0, top: 0, width: 100, height: 100 });
  });

  it('missing/unknown anchor falls back to absolute top-left', () => {
    const r = resolveWidgetRect({ ...base, anchor: '' as string, x: 25, y: 25 }, 400, 400);
    expect(r.left).toBe(100);
    expect(r.top).toBe(100);
  });

  it('top_right measures from the right edge (100% keeps the box on-screen)', () => {
    const r = resolveWidgetRect({ ...base, anchor: 'top_right', x: 100, y: 0, width: 20, height: 10 }, 500, 500);
    // right edge at 100% => box hugs the right edge: left = 500 - 100 = 400
    expect(r.left).toBe(400);
    expect(r.left + r.width).toBe(500);
  });

  it('center anchor centers the box on the anchor point', () => {
    const r = resolveWidgetRect({ ...base, anchor: 'center', x: 50, y: 50, width: 20, height: 20 }, 1000, 1000);
    // 50% = 500, minus half of the 200px box
    expect(r.left).toBe(400);
    expect(r.top).toBe(400);
    expect(r.left + r.width / 2).toBe(500);
  });

  it('bottom_center anchors the box to the bottom edge, centered horizontally', () => {
    const r = resolveWidgetRect({ ...base, anchor: 'bottom_center', x: 50, y: 100, width: 40, height: 10 }, 600, 800);
    expect(r.left).toBe(180); // 300 - 120
    expect(r.top).toBe(720); // 800 - 80
    expect(r.top + r.height).toBe(800);
  });
});

describe('resolveWidgetRect — constraints', () => {
  it('applies a positive pixel offset (nudges right/down)', () => {
    const r = resolveWidgetRect(
      { x: 0, y: 0, width: 10, height: 10, anchor: 'top_left', constraints: withConstraints({ offsetX: 16, offsetY: 8 }) },
      1000,
      1000
    );
    expect(r.left).toBe(16);
    expect(r.top).toBe(8);
  });

  it('applies a negative pixel offset', () => {
    const r = resolveWidgetRect(
      { x: 50, y: 50, width: 10, height: 10, anchor: 'top_left', constraints: withConstraints({ offsetX: -20, offsetY: -5 }) },
      1000,
      1000
    );
    expect(r.left).toBe(480);
    expect(r.top).toBe(495);
  });

  it('offset for a right anchor nudges the whole box rightward consistently', () => {
    const noOffset = resolveWidgetRect(
      { x: 100, y: 0, width: 10, height: 10, anchor: 'top_right' },
      1000,
      1000
    );
    const offset = resolveWidgetRect(
      { x: 100, y: 0, width: 10, height: 10, anchor: 'top_right', constraints: withConstraints({ offsetX: 30 }) },
      1000,
      1000
    );
    expect(offset.left - noOffset.left).toBe(30);
  });

  it('enforces a minimum pixel size at narrow widths (44px touch target)', () => {
    // 5% of 360 = 18px, below the 44px min => clamps up.
    const r = resolveWidgetRect(
      { x: 0, y: 0, width: 5, height: 5, anchor: 'top_left', constraints: withConstraints({ minWidth: 44, minHeight: 44 }) },
      360,
      640
    );
    expect(r.width).toBe(44);
    expect(r.height).toBe(44);
  });

  it('enforces a maximum pixel size on wide screens', () => {
    // 40% of 1440 = 576px, above the 320px max => clamps down.
    const r = resolveWidgetRect(
      { x: 50, y: 50, width: 40, height: 10, anchor: 'center', constraints: withConstraints({ maxWidth: 320 }) },
      1440,
      900
    );
    expect(r.width).toBe(320);
  });
});

describe('widgetPositionCSS', () => {
  it('emits pure percentages when there are no constraints', () => {
    const css = widgetPositionCSS({ x: 10, y: 20, width: 30, height: 40, anchor: 'top_left' });
    expect(css.left).toBe('10%');
    expect(css.top).toBe('20%');
    expect(css.width).toBe('30%');
    expect(css.height).toBe('40%');
    expect(css.transform).toBeUndefined();
  });

  it('folds pixel offsets into calc() and emits min/max size bounds', () => {
    const css = widgetPositionCSS({
      x: 10,
      y: 20,
      width: 30,
      height: 40,
      anchor: 'top_left',
      constraints: withConstraints({ offsetX: 16, offsetY: -8, minWidth: 44, maxHeight: 200 }),
    });
    expect(css.left).toBe('calc(10% + 16px)');
    expect(css.top).toBe('calc(20% - 8px)');
    expect(css.minWidth).toBe('44px');
    expect(css.maxHeight).toBe('200px');
  });

  it('uses right/bottom + centering transforms for far anchors', () => {
    const css = widgetPositionCSS({ x: 100, y: 100, width: 20, height: 10, anchor: 'bottom_right' });
    expect(css.right).toBe('0%');
    expect(css.bottom).toBe('0%');
    const centered = widgetPositionCSS({ x: 50, y: 50, width: 20, height: 10, anchor: 'center' });
    expect(centered.transform).toContain('translateX(-50%)');
    expect(centered.transform).toContain('translateY(-50%)');
    expect(centered.layoutTransform).toBe(centered.transform);
  });
});

/**
 * `ui-score3-v1` boundary fixture: a title/settings/pause/HUD flow whose core
 * actions must remain fully visible from 360px mobile to 1440px desktop.
 */
describe('ui-score3-v1 responsive fixture — no clipping 360→1440', () => {
  const playButton: WidgetPosition = {
    // Centered call-to-action pinned near the bottom, min 44px tall touch target.
    x: 50,
    y: 85,
    width: 40,
    height: 8,
    anchor: 'bottom_center',
    constraints: withConstraints({ minWidth: 120, minHeight: 44, maxWidth: 480 }),
  };
  const hudScore: WidgetPosition = {
    // HUD score element pinned to the top-right corner with a fixed inset.
    x: 100,
    y: 0,
    width: 25,
    height: 6,
    anchor: 'top_right',
    constraints: withConstraints({ offsetX: -16, offsetY: 16, minWidth: 88, minHeight: 44 }),
  };
  const settingsBadge: WidgetPosition = {
    // Small top-left control that would shrink below a tappable size on mobile.
    x: 0,
    y: 0,
    width: 6,
    height: 6,
    anchor: 'top_left',
    constraints: withConstraints({ offsetX: 16, offsetY: 16, minWidth: 44, minHeight: 44 }),
  };

  const coreActions = { playButton, hudScore, settingsBadge };

  for (const { name, w, h } of VIEWPORTS) {
    describe(name, () => {
      for (const [id, widget] of Object.entries(coreActions)) {
        it(`keeps "${id}" fully on-screen (no clipping)`, () => {
          const r = resolveWidgetRect(widget, w, h);
          expect(r.left).toBeGreaterThanOrEqual(0);
          expect(r.top).toBeGreaterThanOrEqual(0);
          expect(r.left + r.width).toBeLessThanOrEqual(w);
          expect(r.top + r.height).toBeLessThanOrEqual(h);
        });
      }

      it('keeps all core actions at a >=44px tappable size', () => {
        for (const widget of Object.values(coreActions)) {
          const r = resolveWidgetRect(widget, w, h);
          expect(r.width).toBeGreaterThanOrEqual(44);
          expect(r.height).toBeGreaterThanOrEqual(44);
        }
      });
    });
  }

  it('at 360px, percentage-only widths that would clip are held by min bounds', () => {
    // settingsBadge is 6% wide = 21.6px at 360 without a min; the min keeps it tappable.
    const r = resolveWidgetRect(settingsBadge, 360, 640);
    expect(r.width).toBe(44);
    // Fixed 16px inset stays fixed regardless of viewport.
    expect(r.left).toBe(16);
    expect(r.top).toBe(16);
  });
});
