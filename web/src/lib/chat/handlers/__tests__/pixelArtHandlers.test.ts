/**
 * Tests for pixelArtHandlers — pixel art generation, palette, and quantization commands.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handleGeneratePixelArt,
  handleSetPixelArtPalette,
  handleQuantizeSpriteColors,
} from '../pixelArtHandlers';

const mockCtx = { store: {} as never, dispatchCommand: vi.fn() };

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('handleGeneratePixelArt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should reject short prompt', async () => {
    const result = await handleGeneratePixelArt({ prompt: 'ab' }, mockCtx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('3 characters');
  });

  it('should reject missing prompt', async () => {
    const result = await handleGeneratePixelArt({}, mockCtx);
    expect(result.success).toBe(false);
  });

  it('should reject invalid target size', async () => {
    const result = await handleGeneratePixelArt({ prompt: 'test sprite', targetSize: 50 }, mockCtx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('16, 32, 64, or 128');
  });

  it('should succeed with valid args', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ provider: 'replicate', tokenCost: 10, palette: 'Pico-8' }),
    });
    const result = await handleGeneratePixelArt({ prompt: 'a warrior knight' }, mockCtx);
    expect(result.success).toBe(true);
    expect(result.message).toContain('Pixel art generation started');
  });

  it('should handle API error response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'No API key' }),
    });
    const result = await handleGeneratePixelArt({ prompt: 'test sprite' }, mockCtx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('No API key');
  });

  it('should handle network errors', async () => {
    mockFetch.mockRejectedValue(new Error('Network failure'));
    const result = await handleGeneratePixelArt({ prompt: 'test sprite' }, mockCtx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Network failure');
  });
});

describe('handleSetPixelArtPalette', () => {
  it('should reject missing palette ID', async () => {
    const result = await handleSetPixelArtPalette({}, mockCtx);
    expect(result.success).toBe(false);
  });

  it('should reject unknown palette', async () => {
    const result = await handleSetPixelArtPalette({ palette: 'unknown' }, mockCtx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown palette');
  });

  it('should accept valid preset palette', async () => {
    const result = await handleSetPixelArtPalette({ palette: 'endesga-32' }, mockCtx);
    expect(result.success).toBe(true);
    expect(result.message).toContain('Endesga 32');
  });

  it('should accept valid custom palette', async () => {
    const result = await handleSetPixelArtPalette({ palette: 'custom', colors: ['#ff0000', '#00ff00'] }, mockCtx);
    expect(result.success).toBe(true);
    expect(result.message).toContain('2 colors');
  });

  it('should reject custom palette without colors', async () => {
    const result = await handleSetPixelArtPalette({ palette: 'custom' }, mockCtx);
    expect(result.success).toBe(false);
  });

  it('should reject custom palette with invalid hex', async () => {
    const result = await handleSetPixelArtPalette({ palette: 'custom', colors: ['#ff0000', 'not-a-color'] }, mockCtx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid hex color');
  });
});

describe('handleQuantizeSpriteColors', () => {
  it('should reject missing colorCount', async () => {
    const result = await handleQuantizeSpriteColors({}, mockCtx);
    expect(result.success).toBe(false);
  });

  it('should reject out-of-range colorCount', async () => {
    const result = await handleQuantizeSpriteColors({ colorCount: 300 }, mockCtx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('1 and 256');
  });

  it('should succeed with valid params', async () => {
    const result = await handleQuantizeSpriteColors({ colorCount: 16, dithering: 'bayer8x8' }, mockCtx);
    expect(result.success).toBe(true);
    expect(result.message).toContain('16');
  });

  it('should reject invalid dithering', async () => {
    const result = await handleQuantizeSpriteColors({ colorCount: 8, dithering: 'floyd' }, mockCtx);
    expect(result.success).toBe(false);
  });

  it('should use default dithering when not specified', async () => {
    const result = await handleQuantizeSpriteColors({ colorCount: 8 }, mockCtx);
    expect(result.success).toBe(true);
    expect(result.message).toContain('none');
  });
});
