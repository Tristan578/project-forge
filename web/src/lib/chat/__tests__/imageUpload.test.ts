import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  validateImageFile,
  extractBase64,
  getMediaType,
  processImageFile,
  resizeImage,
  processImageFiles,
  IMAGE_MAX_SIZE_BYTES,
  IMAGE_ALLOWED_TYPES,
  IMAGE_MAX_COUNT,
} from '@/lib/chat/imageUpload';

function makeFile(name: string, type: string, size: number): File {
  const buffer = new ArrayBuffer(size);
  return new File([buffer], name, { type });
}

describe('validateImageFile', () => {
  it('accepts valid PNG file', () => {
    const file = makeFile('test.png', 'image/png', 1000);
    expect(validateImageFile(file)).toBeNull();
  });

  it('accepts valid JPEG file', () => {
    const file = makeFile('test.jpg', 'image/jpeg', 1000);
    expect(validateImageFile(file)).toBeNull();
  });

  it('accepts valid GIF file', () => {
    const file = makeFile('test.gif', 'image/gif', 1000);
    expect(validateImageFile(file)).toBeNull();
  });

  it('accepts valid WebP file', () => {
    const file = makeFile('test.webp', 'image/webp', 1000);
    expect(validateImageFile(file)).toBeNull();
  });

  it('rejects unsupported file types', () => {
    const file = makeFile('test.bmp', 'image/bmp', 1000);
    const error = validateImageFile(file);
    expect(error).toBeTruthy();
    expect(error).toContain('Unsupported file type');
  });

  it('rejects files over 5MB', () => {
    const file = makeFile('large.png', 'image/png', IMAGE_MAX_SIZE_BYTES + 1);
    const error = validateImageFile(file);
    expect(error).toBeTruthy();
    expect(error).toContain('too large');
  });

  it('accepts file at exactly 5MB', () => {
    const file = makeFile('exact.png', 'image/png', IMAGE_MAX_SIZE_BYTES);
    expect(validateImageFile(file)).toBeNull();
  });
});

describe('extractBase64', () => {
  it('strips PNG data URL prefix', () => {
    const result = extractBase64('data:image/png;base64,abc123');
    expect(result).toBe('abc123');
  });

  it('strips JPEG data URL prefix', () => {
    const result = extractBase64('data:image/jpeg;base64,xyz789');
    expect(result).toBe('xyz789');
  });

  it('handles already-stripped data', () => {
    const result = extractBase64('abc123');
    expect(result).toBe('abc123');
  });
});

describe('getMediaType', () => {
  it('extracts PNG media type', () => {
    expect(getMediaType('data:image/png;base64,abc')).toBe('image/png');
  });

  it('extracts JPEG media type', () => {
    expect(getMediaType('data:image/jpeg;base64,abc')).toBe('image/jpeg');
  });

  it('returns default for invalid data URL', () => {
    expect(getMediaType('invalid')).toBe('image/png');
  });
});

describe('processImageFiles', () => {
  it('returns error when at max count', async () => {
    const files = [makeFile('test.png', 'image/png', 100)];
    const { results, error } = await processImageFiles(files, IMAGE_MAX_COUNT);
    expect(results).toEqual([]);
    expect(error).toContain('Maximum');
  });

  it('warns when trying to add more than available slots', async () => {
    // This tests the count limiting logic with validation-only (no real file reading)
    const files = Array.from({ length: 4 }, (_, i) => makeFile(`test${i}.bmp`, 'image/bmp', 100));
    const { results, error } = await processImageFiles(files, 2);
    // Only 3 files should be processed (5 - 2 = 3 available)
    expect(results.length).toBe(3);
    expect(error).toContain('allowed');
    // All should fail validation (bmp)
    for (const r of results) {
      expect(r.success).toBe(false);
    }
  });

  it('validates file types in batch — invalid files fail early', async () => {
    // Only test with invalid files that fail validation before FileReader
    const files = [
      makeFile('invalid1.bmp', 'image/bmp', 100),
      makeFile('invalid2.svg', 'image/svg+xml', 100),
    ];
    const { results } = await processImageFiles(files, 0);
    expect(results.length).toBe(2);
    for (const r of results) {
      expect(r.success).toBe(false);
      expect(r.error).toContain('Unsupported');
    }
  });
});

describe('resizeImage (mocked DOM)', () => {
  let originalImage: typeof globalThis.Image;

  beforeEach(() => {
    originalImage = globalThis.Image;
  });

  afterEach(() => {
    globalThis.Image = originalImage;
    vi.restoreAllMocks();
  });

  function mockImageClass(width: number, height: number) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).Image = class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      width = width;
      height = height;
      set src(_val: string) {
        // Trigger onload asynchronously via microtask
        Promise.resolve().then(() => { if (this.onload) this.onload(); });
      }
    };
  }

  it('returns original dataUrl and correct mediaType for small JPEG image', async () => {
    mockImageClass(100, 80);
    const dataUrl = 'data:image/jpeg;base64,abc123';
    const result = await resizeImage(dataUrl);
    expect(result.dataUrl).toBe(dataUrl);
    expect(result.mediaType).toBe('image/jpeg');
    expect(result.width).toBe(100);
    expect(result.height).toBe(80);
    expect(result.originalWidth).toBe(100);
    expect(result.originalHeight).toBe(80);
  });

  it('returns image/png mediaType for small PNG image', async () => {
    mockImageClass(200, 150);
    const dataUrl = 'data:image/png;base64,xyz';
    const result = await resizeImage(dataUrl);
    expect(result.mediaType).toBe('image/png');
  });

  it('resizes large image and returns image/png mediaType', async () => {
    mockImageClass(3000, 2000);
    const mockCtx = {
      drawImage: vi.fn(),
    };
    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn().mockReturnValue(mockCtx),
      toDataURL: vi.fn().mockReturnValue('data:image/png;base64,resized'),
    };
    vi.spyOn(document, 'createElement').mockReturnValue(mockCanvas as unknown as HTMLCanvasElement);

    const dataUrl = 'data:image/jpeg;base64,largefile';
    const result = await resizeImage(dataUrl);
    expect(result.dataUrl).toBe('data:image/png;base64,resized');
    expect(result.mediaType).toBe('image/png');
    expect(result.width).toBeLessThanOrEqual(1568);
    expect(result.height).toBeLessThanOrEqual(1568);
    expect(result.originalWidth).toBe(3000);
    expect(result.originalHeight).toBe(2000);
    expect(mockCtx.drawImage).toHaveBeenCalled();
  });

  it('rejects when canvas context is null', async () => {
    mockImageClass(3000, 2000);
    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn().mockReturnValue(null),
    };
    vi.spyOn(document, 'createElement').mockReturnValue(mockCanvas as unknown as HTMLCanvasElement);

    await expect(resizeImage('data:image/png;base64,abc')).rejects.toThrow('Failed to create canvas context');
  });

  it('rejects when image fails to load', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).Image = class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_val: string) {
        Promise.resolve().then(() => { if (this.onerror) this.onerror(); });
      }
    };
    await expect(resizeImage('data:image/png;base64,bad')).rejects.toThrow('Failed to load image');
  });
});

describe('processImageFile (mocked DOM)', () => {
  let originalImage: typeof globalThis.Image;
  let originalFileReader: typeof globalThis.FileReader;

  beforeEach(() => {
    originalImage = globalThis.Image;
    originalFileReader = globalThis.FileReader;
  });

  afterEach(() => {
    globalThis.Image = originalImage;
    globalThis.FileReader = originalFileReader;
    vi.restoreAllMocks();
  });

  it('processes a valid image file through the full pipeline', async () => {
    // Mock FileReader
    const fakeDataUrl = 'data:image/jpeg;base64,testdata';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).FileReader = class {
      result: string | null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readAsDataURL(_file: File) {
        this.result = fakeDataUrl;
        Promise.resolve().then(() => { if (this.onload) this.onload(); });
      }
    };

    // Mock Image (small, no resize needed)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).Image = class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      width = 200;
      height = 150;
      set src(_val: string) {
        Promise.resolve().then(() => { if (this.onload) this.onload(); });
      }
    };

    const file = makeFile('photo.jpg', 'image/jpeg', 1000);
    const result = await processImageFile(file);
    expect(result.success).toBe(true);
    expect(result.dataUrl).toBe(fakeDataUrl);
    expect(result.mediaType).toBe('image/jpeg');
    expect(result.fileName).toBe('photo.jpg');
    expect(result.originalWidth).toBe(200);
    expect(result.originalHeight).toBe(150);
    expect(result.finalWidth).toBe(200);
    expect(result.finalHeight).toBe(150);
  });

  it('returns failure result when FileReader errors', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).FileReader = class {
      result: string | null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readAsDataURL(_file: File) {
        Promise.resolve().then(() => { if (this.onerror) this.onerror(); });
      }
    };

    const file = makeFile('photo.png', 'image/png', 1000);
    const result = await processImageFile(file);
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.fileName).toBe('photo.png');
  });
});

describe('constants', () => {
  it('IMAGE_MAX_SIZE_BYTES is 5MB', () => {
    expect(IMAGE_MAX_SIZE_BYTES).toBe(5 * 1024 * 1024);
  });

  it('IMAGE_ALLOWED_TYPES covers expected formats', () => {
    expect(IMAGE_ALLOWED_TYPES).toContain('image/png');
    expect(IMAGE_ALLOWED_TYPES).toContain('image/jpeg');
    expect(IMAGE_ALLOWED_TYPES).toContain('image/gif');
    expect(IMAGE_ALLOWED_TYPES).toContain('image/webp');
  });

  it('IMAGE_MAX_COUNT is 5', () => {
    expect(IMAGE_MAX_COUNT).toBe(5);
  });
});
