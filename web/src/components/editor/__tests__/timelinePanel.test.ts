/**
 * Tests for TimelinePanel — pure helper functions and component rendering.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';
import {
  timeToPixels,
  pixelsToTime,
  snapToFrame,
  PROPERTY_TARGETS,
  TRACK_HEIGHT,
  RULER_HEIGHT,
  FPS,
  FRAME_DURATION,
} from '../TimelinePanel';

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('timeToPixels', () => {
  it('converts time to pixel position at 1x zoom', () => {
    // 1 second at 100 pixels/sec, zoom 1 = 100px
    expect(timeToPixels(1, 1, 100)).toBe(100);
  });

  it('scales with zoom', () => {
    expect(timeToPixels(1, 2, 100)).toBe(200);
    expect(timeToPixels(1, 0.5, 100)).toBe(50);
  });

  it('scales with time', () => {
    expect(timeToPixels(2.5, 1, 100)).toBe(250);
  });

  it('returns 0 for time 0', () => {
    expect(timeToPixels(0, 1, 100)).toBe(0);
  });

  it('handles fractional time correctly', () => {
    expect(timeToPixels(0.5, 1, 100)).toBe(50);
  });
});

describe('pixelsToTime', () => {
  it('converts pixel position to time at 1x zoom', () => {
    expect(pixelsToTime(100, 1, 100)).toBe(1);
  });

  it('is the inverse of timeToPixels', () => {
    const time = 2.5;
    const zoom = 1.5;
    const pps = 100;
    const pixels = timeToPixels(time, zoom, pps);
    expect(pixelsToTime(pixels, zoom, pps)).toBeCloseTo(time);
  });

  it('scales inversely with zoom', () => {
    expect(pixelsToTime(100, 2, 100)).toBe(0.5);
  });

  it('returns 0 for 0 pixels', () => {
    expect(pixelsToTime(0, 1, 100)).toBe(0);
  });
});

describe('snapToFrame', () => {
  it('snaps to nearest frame boundary', () => {
    // At 60fps, frame duration = 1/60 ≈ 0.01667s
    const snapped = snapToFrame(0.025); // Between frame 1 and 2
    expect(snapped).toBeCloseTo(Math.round(0.025 / FRAME_DURATION) * FRAME_DURATION);
  });

  it('returns 0 for 0', () => {
    expect(snapToFrame(0)).toBe(0);
  });

  it('snaps exact frame times to themselves', () => {
    const frameTime = 10 * FRAME_DURATION; // Exactly frame 10
    expect(snapToFrame(frameTime)).toBeCloseTo(frameTime);
  });

  it('rounds to nearest frame, not floor', () => {
    // Just past the midpoint of frame 0 and frame 1
    const midPoint = FRAME_DURATION * 0.6;
    expect(snapToFrame(midPoint)).toBeCloseTo(FRAME_DURATION);
  });
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('TimelinePanel constants', () => {
  it('PROPERTY_TARGETS has transform, material, and light targets', () => {
    const groups = [...new Set(PROPERTY_TARGETS.map((t) => t.group))];
    expect(groups).toContain('Transform');
    expect(groups).toContain('Material');
    expect(groups).toContain('Light');
  });

  it('PROPERTY_TARGETS has position, rotation, and scale entries', () => {
    const values = PROPERTY_TARGETS.map((t) => t.value);
    expect(values).toContain('position_x');
    expect(values).toContain('rotation_y');
    expect(values).toContain('scale_z');
  });

  it('each target has value, label, group, and color', () => {
    for (const target of PROPERTY_TARGETS) {
      expect(target.value).not.toBeNull();
      expect(target.label).not.toBeNull();
      expect(target.group).not.toBeNull();
      expect(target.color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('FPS is 60 and FRAME_DURATION is 1/60', () => {
    expect(FPS).toBe(60);
    expect(FRAME_DURATION).toBeCloseTo(1 / 60);
  });

  it('TRACK_HEIGHT and RULER_HEIGHT are positive', () => {
    expect(TRACK_HEIGHT).toBeGreaterThan(0);
    expect(RULER_HEIGHT).toBeGreaterThan(0);
  });
});

