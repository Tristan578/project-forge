import { describe, it, expect, vi } from 'vitest';
import {
  validateImageFile,
  extractBase64,
  getMediaType,
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
