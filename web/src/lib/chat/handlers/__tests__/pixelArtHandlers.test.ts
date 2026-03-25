/**
 * Tests for pixelArtHandlers — pixel art generation, palette, and quantization commands.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// trackJob accesses useGenerationStore which requires browser storage — mock it for node tests.
vi.mock('../generationHandlers', async (importOriginal) => {
  const original = await importOriginal<typeof import('../generationHandlers')>();
  return {
    ...original,
    trackJob: vi.fn(),
    makeJobId: vi.fn(() => 'gen-test-123'),
  };
});

import {
  handleGeneratePixelArt,
  handleSetPixelArtPalette,
  handleQuantizeSpriteColors,
} from '../pixelArtHandlers';

const mockCtx = { store: {} as never, dispatchCommand: vi.fn() };

// Mock fetch — scoped to setup/teardown to avoid leaking across test files
const mockFetch = vi.fn();
let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  vi.clearAllMocks();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('handleGeneratePixelArt', () => {
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
    expect(result.error).toContain('Target size');
  });

  it('should reject invalid style instead of silently falling back to default', async () => {
    const result = await handleGeneratePixelArt({ prompt: 'a warrior knight', style: 'invalid_style' }, mockCtx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('style');
  });

  it('should succeed with valid args and return job metadata', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ jobId: 'pxart-123', provider: 'replicate', tokenCost: 10, palette: 'Pico-8', usageId: 'usage-1' }),
    });
    const result = await handleGeneratePixelArt({ prompt: 'a warrior knight' }, mockCtx);
    expect(result.success).toBe(true);
    expect(result.message).toContain('Pixel art generation started');
    expect(result.result).toEqual({ jobId: 'pxart-123', provider: 'replicate', usageId: 'usage-1', tokenCost: 10 });
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
    expect(result.error).toContain('256');
  });

  it('should reject invalid dithering', async () => {
    const result = await handleQuantizeSpriteColors({ colorCount: 8, dithering: 'floyd' }, mockCtx);
    expect(result.success).toBe(false);
  });

  // PF-838 regression: stub must return 501 (not success) so callers never
  // receive a success response when no real work was done.
  it('returns not-implemented error for valid params (PF-838)', async () => {
    const result = await handleQuantizeSpriteColors({ colorCount: 16, dithering: 'bayer8x8' }, mockCtx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('not yet implemented');
  });

  it('returns not-implemented error when only colorCount is supplied (PF-838)', async () => {
    const result = await handleQuantizeSpriteColors({ colorCount: 8 }, mockCtx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('not yet implemented');
  });
});
