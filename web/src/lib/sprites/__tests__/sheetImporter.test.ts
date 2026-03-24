import { describe, it, expect } from 'vitest';
import {
  detectGridDimensions,
  sliceSheet,
  generateDefaultClips,
  buildSpriteSheetData,
} from '../sheetImporter';

describe('detectGridDimensions', () => {
  it('should detect 2x2 grid from 128x128 image (prefers largest frame)', () => {
    const grid = detectGridDimensions(128, 128);
    // Algorithm prefers largest frame: 64 divides 128 into 2x2=4 frames
    expect(grid.columns).toBe(2);
    expect(grid.rows).toBe(2);
    expect(grid.frameWidth).toBe(64);
    expect(grid.frameHeight).toBe(64);
  });

  it('should prefer larger frame sizes', () => {
    const grid = detectGridDimensions(256, 256);
    // 256 / 128 = 2 frames, and 128 > 64 > 32, all divide evenly
    // Largest common size that gives >= 2 frames: 128 (2x2=4 frames)
    expect(grid.frameWidth).toBe(128);
    expect(grid.columns).toBe(2);
    expect(grid.rows).toBe(2);
  });

  it('should handle 512x256 rectangular sheets', () => {
    const grid = detectGridDimensions(512, 256);
    // Largest common frame that divides both: 256 divides 512 into 2 cols, 256 into 1 row = 2 frames
    expect(grid.frameWidth).toBe(256);
    expect(grid.frameHeight).toBe(256);
    expect(grid.columns).toBe(2);
    expect(grid.rows).toBe(1);
  });

  it('should fall back to single frame for non-standard sizes', () => {
    const grid = detectGridDimensions(100, 100);
    // No common size divides 100 evenly
    expect(grid.columns).toBe(1);
    expect(grid.rows).toBe(1);
    expect(grid.frameWidth).toBe(100);
    expect(grid.frameHeight).toBe(100);
  });

  it('should handle very small images as single frame', () => {
    const grid = detectGridDimensions(8, 8);
    // Too small for any common frame size to give 2+ frames
    expect(grid.columns).toBe(1);
    expect(grid.rows).toBe(1);
  });

  it('should handle 64x64 as 2x2 at 32px or 4x4 at 16px', () => {
    const grid = detectGridDimensions(64, 64);
    // Both 16 (4x4=16) and 32 (2x2=4) work, but 32 is larger
    expect(grid.frameWidth).toBe(32);
    expect(grid.columns).toBe(2);
    expect(grid.rows).toBe(2);
  });
});

describe('sliceSheet', () => {
  it('should slice into correct number of frames', () => {
    const frames = sliceSheet(128, 64, 2, 4);
    expect(frames).toHaveLength(8); // 2 rows * 4 cols
  });

  it('should calculate correct frame dimensions', () => {
    const frames = sliceSheet(128, 64, 2, 4);
    expect(frames[0].width).toBe(32); // 128 / 4
    expect(frames[0].height).toBe(32); // 64 / 2
  });

  it('should assign correct positions left-to-right, top-to-bottom', () => {
    const frames = sliceSheet(64, 64, 2, 2);
    expect(frames[0]).toEqual({ index: 0, x: 0, y: 0, width: 32, height: 32 });
    expect(frames[1]).toEqual({ index: 1, x: 32, y: 0, width: 32, height: 32 });
    expect(frames[2]).toEqual({ index: 2, x: 0, y: 32, width: 32, height: 32 });
    expect(frames[3]).toEqual({ index: 3, x: 32, y: 32, width: 32, height: 32 });
  });

  it('should assign sequential indices', () => {
    const frames = sliceSheet(96, 32, 1, 3);
    expect(frames.map(f => f.index)).toEqual([0, 1, 2]);
  });

  it('should handle single frame', () => {
    const frames = sliceSheet(64, 64, 1, 1);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual({ index: 0, x: 0, y: 0, width: 64, height: 64 });
  });
});

describe('generateDefaultClips', () => {
  function makeFrames(count: number) {
    return Array.from({ length: count }, (_, i) => ({
      index: i, x: i * 32, y: 0, width: 32, height: 32,
    }));
  }

  it('should return empty for 0 frames', () => {
    const clips = generateDefaultClips([], 'test');
    expect(Object.keys(clips)).toHaveLength(0);
  });

  it('should create non-looping idle for 1 frame', () => {
    const clips = generateDefaultClips(makeFrames(1), 'sheet');
    expect(clips['idle']).not.toBeUndefined();
    expect(clips['idle'].looping).toBe(false);
    expect(clips['idle'].frames).toEqual([0]);
  });

  it('should create looping idle for 2-4 frames', () => {
    const clips = generateDefaultClips(makeFrames(3), 'sheet');
    expect(clips['idle']).not.toBeUndefined();
    expect(clips['idle'].looping).toBe(true);
    expect(clips['idle'].frames).toEqual([0, 1, 2]);
    expect(clips['walk']).toBeUndefined();
  });

  it('should create idle + walk for 5-8 frames', () => {
    const clips = generateDefaultClips(makeFrames(6), 'sheet');
    expect(clips['idle']).not.toBeUndefined();
    expect(clips['walk']).not.toBeUndefined();
    expect(clips['idle'].frames).toEqual([0, 1, 2]); // first half (ceil(6/2) = 3)
    expect(clips['walk'].frames).toEqual([3, 4, 5]); // second half
    expect(clips['run']).toBeUndefined();
  });

  it('should create idle + walk + run for 9+ frames', () => {
    const clips = generateDefaultClips(makeFrames(12), 'sheet');
    expect(clips['idle']).not.toBeUndefined();
    expect(clips['walk']).not.toBeUndefined();
    expect(clips['run']).not.toBeUndefined();
    // First third: ceil(12/3) = 4
    expect(clips['idle'].frames).toEqual([0, 1, 2, 3]);
    // Second third: ceil(24/3) = 8
    expect(clips['walk'].frames).toEqual([4, 5, 6, 7]);
    // Last third
    expect(clips['run'].frames).toEqual([8, 9, 10, 11]);
  });

  it('should use 100ms frame duration', () => {
    const clips = generateDefaultClips(makeFrames(4), 'sheet');
    expect(clips['idle'].frameDurations).toEqual({ type: 'uniform', duration: 0.1 });
  });

  it('should not use pingPong', () => {
    const clips = generateDefaultClips(makeFrames(4), 'sheet');
    expect(clips['idle'].pingPong).toBe(false);
  });
});

describe('buildSpriteSheetData', () => {
  it('should build complete sprite sheet data', () => {
    const frames = sliceSheet(64, 64, 2, 2);
    const mockResult = {
      image: {} as HTMLImageElement,
      width: 64,
      height: 64,
      grid: { columns: 2, rows: 2, frameWidth: 32, frameHeight: 32 },
      frames,
    };

    const data = buildSpriteSheetData('asset-1', mockResult, 'TestSheet');

    expect(data.assetId).toBe('asset-1');
    expect(data.frames).toHaveLength(4);
    expect(data.sliceMode.type).toBe('grid');
    const gridMode = data.sliceMode as { type: 'grid'; columns: number; rows: number; tileSize: [number, number] };
    expect(gridMode.columns).toBe(2);
    expect(gridMode.rows).toBe(2);
    expect(gridMode.tileSize).toEqual([32, 32]);
    expect(data.clips).not.toBeUndefined();
    expect(data.clips['idle']).not.toBeUndefined();
  });
});
