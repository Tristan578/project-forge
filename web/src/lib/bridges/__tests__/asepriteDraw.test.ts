/**
 * asepriteDraw (#10271): what pixel art is accepted, how it is encoded for the
 * template, and that the draw call reads back the sheet from paths it chose and
 * deletes them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync, writeFileSync } from 'fs';
import { ZodError } from 'zod';

vi.mock('server-only', () => ({}));

const executeOperation = vi.fn();
vi.mock('../asepriteBridge', () => ({
  executeOperation: (...args: unknown[]) => executeOperation(...args),
}));

import { drawPixelArt, encodePixelData, parsePixelArt, PIXEL_ART_LIMITS } from '../asepriteDraw';

const KNIGHT = {
  width: 2,
  height: 2,
  palette: ['1a1a2e', 'e94560ff'],
  frames: [
    [1, 0, 2, 1],
    [0, 1, 1, 2],
  ],
  frameDurationMs: 120,
};

/** Stands in for Aseprite: writes a sheet to the paths it was given. */
function asepriteWrites(frameCount: number, width = 2, height = 2) {
  executeOperation.mockImplementationOnce(async (_bin: string, op: { params: Record<string, string> }) => {
    writeFileSync(op.params.outputPng!, Buffer.from('PNGDATA'));
    writeFileSync(
      op.params.outputJson!,
      JSON.stringify({
        frames: Array.from({ length: frameCount }, (_, i) => ({
          frame: { x: i * width, y: 0, w: width, h: height },
          duration: 120,
        })),
        meta: { size: { w: width * frameCount, h: height } },
      }),
    );
    return { success: true, stdout: `OK:drawn:${frameCount}`, stderr: '', exitCode: 0 };
  });
}

beforeEach(() => {
  executeOperation.mockReset();
});

describe('parsePixelArt', () => {
  it('accepts well-formed pixel art and defaults the frame duration', () => {
    const { frameDurationMs: _ignored, ...rest } = KNIGHT;
    expect(parsePixelArt(rest).frameDurationMs).toBe(100);
  });

  it.each([
    ['a width over the limit', { ...KNIGHT, width: PIXEL_ART_LIMITS.maxSize + 1 }],
    ['a zero height', { ...KNIGHT, height: 0 }],
    ['too many colours', { ...KNIGHT, palette: Array.from({ length: 33 }, () => 'ffffff') }],
    ['a malformed colour', { ...KNIGHT, palette: ['1a1a2e', 'red'] }],
    ['a colour with a quote in it', { ...KNIGHT, palette: ['1a1a2e", os.exit()'] }],
    ['too many frames', { ...KNIGHT, frames: Array.from({ length: 17 }, () => [0, 0, 0, 0]) }],
    ['a frame of the wrong size', { ...KNIGHT, frames: [[1, 0, 2]] }],
    ['an index beyond the palette', { ...KNIGHT, frames: [[1, 0, 3, 1]] }],
    ['a negative index', { ...KNIGHT, frames: [[1, 0, -1, 1]] }],
    ['a fractional index', { ...KNIGHT, frames: [[1, 0, 1.5, 1]] }],
  ])('rejects %s', (_label, input) => {
    expect(() => parsePixelArt(input)).toThrow(ZodError);
  });
});

describe('encodePixelData', () => {
  it('writes two lowercase hex characters per index, row-major, frame after frame', () => {
    expect(encodePixelData(parsePixelArt({ ...KNIGHT, palette: Array.from({ length: 31 }, () => '000000'), frames: [[31, 0, 10, 1]] })))
      .toBe('1f000a01');
  });
});

describe('drawPixelArt', () => {
  it('draws through the drawFrames template and returns the sheet', async () => {
    asepriteWrites(2);

    const result = await drawPixelArt('/usr/bin/aseprite', KNIGHT);

    expect(result).toMatchObject({ success: true, sheetWidth: 4, sheetHeight: 2 });
    if (!result.success) throw new Error('expected success');
    expect(result.png.toString()).toBe('PNGDATA');
    expect(result.frames).toEqual([
      { x: 0, y: 0, w: 2, h: 2, durationMs: 120 },
      { x: 2, y: 0, w: 2, h: 2, durationMs: 120 },
    ]);
    const [, op] = executeOperation.mock.calls[0]!;
    expect(op.name).toBe('drawFrames');
    expect(op.params).toMatchObject({
      width: 2,
      height: 2,
      frameCount: 2,
      frameDuration: 120,
      paletteColors: '1a1a2e,e94560ff',
      pixelData: '0100020100010102',
    });
  });

  it('writes only to paths it generated under the bridge temp directory, and deletes them', async () => {
    asepriteWrites(2);

    await drawPixelArt('/usr/bin/aseprite', KNIGHT);

    const { outputPng, outputJson } = executeOperation.mock.calls[0]![1].params;
    expect(outputPng).toMatch(/spawnforge-bridge\/[0-9a-f-]+\.png$/);
    expect(outputJson).toMatch(/spawnforge-bridge\/[0-9a-f-]+\.json$/);
    expect(existsSync(outputPng)).toBe(false);
    expect(existsSync(outputJson)).toBe(false);
  });

  it('never runs Aseprite for invalid pixel art', async () => {
    await expect(drawPixelArt('/usr/bin/aseprite', { ...KNIGHT, frames: [[9, 9, 9, 9]] })).rejects.toThrow(ZodError);
    expect(executeOperation).not.toHaveBeenCalled();
  });

  it('reports a failed operation', async () => {
    executeOperation.mockResolvedValueOnce({ success: false, error: 'palette index out of range', exitCode: 0 });

    const result = await drawPixelArt('/usr/bin/aseprite', KNIGHT);

    expect(result).toEqual({ success: false, error: 'palette index out of range' });
  });

  it('reports success without a sheet as a failure', async () => {
    executeOperation.mockResolvedValueOnce({ success: true, stdout: 'OK', exitCode: 0 });

    const result = await drawPixelArt('/usr/bin/aseprite', KNIGHT);

    expect(result).toEqual({ success: false, error: 'Aseprite reported success but wrote no sprite sheet' });
  });

  it('reports a sheet whose frame count does not match what was drawn', async () => {
    asepriteWrites(1);

    const result = await drawPixelArt('/usr/bin/aseprite', KNIGHT);

    expect(result).toEqual({ success: false, error: 'Aseprite exported 1 frames; 2 were drawn' });
  });
});
