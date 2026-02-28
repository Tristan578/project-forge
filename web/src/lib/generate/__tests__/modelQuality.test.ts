import { describe, it, expect } from 'vitest';
import {
  analyzeModelQuality,
  classifySize,
  classifyPolyBudget,
  formatBytes,
} from '../modelQuality';

// Helper to create a minimal valid GLB blob
function createGlbBlob(json: object, totalSize?: number): Blob {
  const jsonStr = JSON.stringify(json);
  const jsonBytes = new TextEncoder().encode(jsonStr);
  const jsonPadded = jsonBytes.length % 4 === 0
    ? jsonBytes
    : new Uint8Array([...jsonBytes, ...new Array(4 - (jsonBytes.length % 4)).fill(0x20)]);

  const headerSize = 12;
  const chunkHeaderSize = 8;
  const totalLength = headerSize + chunkHeaderSize + jsonPadded.length;

  const buffer = new ArrayBuffer(totalLength);
  const view = new DataView(buffer);

  // GLB header
  view.setUint32(0, 0x46546C67, true); // magic: "glTF"
  view.setUint32(4, 2, true);           // version: 2
  view.setUint32(8, totalLength, true);  // total length

  // JSON chunk header
  view.setUint32(12, jsonPadded.length, true); // chunk length
  view.setUint32(16, 0x4E4F534A, true);        // chunk type: "JSON"

  // JSON chunk data
  const uint8View = new Uint8Array(buffer);
  uint8View.set(jsonPadded, 20);

  if (totalSize && totalSize > totalLength) {
    // Pad to desired size
    const padded = new Uint8Array(totalSize);
    padded.set(uint8View);
    return new Blob([padded]);
  }

  return new Blob([buffer]);
}

// Helper to create an invalid blob (not GLB)
function createInvalidBlob(size: number): Blob {
  return new Blob([new Uint8Array(size).fill(0)]);
}

describe('classifySize', () => {
  it('should classify small files (< 1MB)', () => {
    expect(classifySize(500_000)).toBe('small');
    expect(classifySize(0)).toBe('small');
  });

  it('should classify medium files (1-5MB)', () => {
    expect(classifySize(1_100_000)).toBe('medium');
    expect(classifySize(4_000_000)).toBe('medium');
  });

  it('should classify large files (5-15MB)', () => {
    expect(classifySize(6_000_000)).toBe('large');
    expect(classifySize(14_000_000)).toBe('large');
  });

  it('should classify oversized files (>= 15MB)', () => {
    expect(classifySize(16_000_000)).toBe('oversized');
    expect(classifySize(100_000_000)).toBe('oversized');
  });

  it('should handle exact boundaries', () => {
    expect(classifySize(1 * 1024 * 1024)).toBe('medium');     // exactly 1MB
    expect(classifySize(5 * 1024 * 1024)).toBe('large');      // exactly 5MB
    expect(classifySize(15 * 1024 * 1024)).toBe('oversized'); // exactly 15MB
  });
});

describe('classifyPolyBudget', () => {
  it('should classify low poly (< 10K)', () => {
    expect(classifyPolyBudget(0)).toBe('low');
    expect(classifyPolyBudget(5_000)).toBe('low');
    expect(classifyPolyBudget(9_999)).toBe('low');
  });

  it('should classify medium poly (10K-50K)', () => {
    expect(classifyPolyBudget(10_000)).toBe('medium');
    expect(classifyPolyBudget(30_000)).toBe('medium');
    expect(classifyPolyBudget(49_999)).toBe('medium');
  });

  it('should classify high poly (50K-200K)', () => {
    expect(classifyPolyBudget(50_000)).toBe('high');
    expect(classifyPolyBudget(150_000)).toBe('high');
    expect(classifyPolyBudget(199_999)).toBe('high');
  });

  it('should classify over_budget (>= 200K)', () => {
    expect(classifyPolyBudget(200_000)).toBe('over_budget');
    expect(classifyPolyBudget(1_000_000)).toBe('over_budget');
  });
});

describe('formatBytes', () => {
  it('should format bytes', () => {
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(0)).toBe('0 B');
  });

  it('should format kilobytes', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(2560)).toBe('2.5 KB');
  });

  it('should format megabytes', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatBytes(5.5 * 1024 * 1024)).toBe('5.5 MB');
  });
});

describe('analyzeModelQuality', () => {
  it('should reject files too small to be GLB', async () => {
    const blob = new Blob([new Uint8Array(8)]);
    const result = await analyzeModelQuality(blob);

    expect(result.validFormat).toBe(false);
    expect(result.version).toBe(0);
    expect(result.warnings).toContain('File too small to be a valid GLB');
  });

  it('should reject invalid magic bytes', async () => {
    const blob = createInvalidBlob(100);
    const result = await analyzeModelQuality(blob);

    expect(result.validFormat).toBe(false);
    expect(result.warnings.some((w) => w.includes('Invalid GLB format'))).toBe(true);
  });

  it('should parse a valid empty GLB', async () => {
    const blob = createGlbBlob({ asset: { version: '2.0' } });
    const result = await analyzeModelQuality(blob);

    expect(result.validFormat).toBe(true);
    expect(result.version).toBe(2);
    expect(result.primitiveCount).toBe(0);
    expect(result.materialCount).toBe(0);
    expect(result.estimatedTriangles).toBe(0);
    expect(result.polyBudget).toBe('low');
  });

  it('should count materials', async () => {
    const blob = createGlbBlob({
      asset: { version: '2.0' },
      materials: [
        { name: 'Material_0' },
        { name: 'Material_1' },
        { name: 'Material_2' },
      ],
    });
    const result = await analyzeModelQuality(blob);

    expect(result.materialCount).toBe(3);
  });

  it('should count mesh primitives', async () => {
    const blob = createGlbBlob({
      asset: { version: '2.0' },
      meshes: [
        { primitives: [{ attributes: {} }, { attributes: {} }] },
        { primitives: [{ attributes: {} }] },
      ],
    });
    const result = await analyzeModelQuality(blob);

    expect(result.primitiveCount).toBe(3);
  });

  it('should estimate triangles from index accessors', async () => {
    const blob = createGlbBlob({
      asset: { version: '2.0' },
      accessors: [
        { count: 3000, componentType: 5123, type: 'SCALAR' }, // 1000 triangles
      ],
      meshes: [
        {
          primitives: [{ indices: 0, attributes: { POSITION: 1 } }],
        },
      ],
    });
    const result = await analyzeModelQuality(blob);

    expect(result.estimatedTriangles).toBe(1000);
    expect(result.polyBudget).toBe('low');
  });

  it('should estimate triangles from vertex count when no indices', async () => {
    const blob = createGlbBlob({
      asset: { version: '2.0' },
      accessors: [
        { count: 90000, componentType: 5126, type: 'VEC3' }, // 30000 triangles
      ],
      meshes: [
        {
          primitives: [{ attributes: { POSITION: 0 } }],
        },
      ],
    });
    const result = await analyzeModelQuality(blob);

    expect(result.estimatedTriangles).toBe(30000);
    expect(result.polyBudget).toBe('medium');
  });

  it('should warn about high draw call count', async () => {
    const primitives = Array.from({ length: 25 }, () => ({ attributes: {} }));
    const blob = createGlbBlob({
      asset: { version: '2.0' },
      meshes: [{ primitives }],
    });
    const result = await analyzeModelQuality(blob);

    expect(result.primitiveCount).toBe(25);
    expect(result.warnings.some((w) => w.includes('draw calls'))).toBe(true);
  });

  it('should warn about over-budget triangle count', async () => {
    const blob = createGlbBlob({
      asset: { version: '2.0' },
      accessors: [
        { count: 900_000, componentType: 5123, type: 'SCALAR' }, // 300K triangles
      ],
      meshes: [
        {
          primitives: [{ indices: 0, attributes: { POSITION: 1 } }],
        },
      ],
    });
    const result = await analyzeModelQuality(blob);

    expect(result.estimatedTriangles).toBe(300_000);
    expect(result.polyBudget).toBe('over_budget');
    expect(result.warnings.some((w) => w.includes('exceeds recommended budget'))).toBe(true);
  });

  it('should warn about oversized files', async () => {
    // Create a blob that reports as oversized
    const blob = createGlbBlob({ asset: { version: '2.0' } }, 16_000_000);
    const result = await analyzeModelQuality(blob);

    expect(result.sizeCategory).toBe('oversized');
    expect(result.warnings.some((w) => w.includes('very large'))).toBe(true);
  });

  it('should warn about large files', async () => {
    const blob = createGlbBlob({ asset: { version: '2.0' } }, 6_000_000);
    const result = await analyzeModelQuality(blob);

    expect(result.sizeCategory).toBe('large');
    expect(result.warnings.some((w) => w.includes('mobile devices'))).toBe(true);
  });

  it('should handle non-version-2 GLB', async () => {
    // Create a GLB with version 1
    const jsonStr = JSON.stringify({ asset: { version: '1.0' } });
    const jsonBytes = new TextEncoder().encode(jsonStr);
    const jsonPadded = jsonBytes.length % 4 === 0
      ? jsonBytes
      : new Uint8Array([...jsonBytes, ...new Array(4 - (jsonBytes.length % 4)).fill(0x20)]);

    const totalLength = 12 + 8 + jsonPadded.length;
    const buffer = new ArrayBuffer(totalLength);
    const view = new DataView(buffer);

    view.setUint32(0, 0x46546C67, true); // magic
    view.setUint32(4, 1, true);           // version 1
    view.setUint32(8, totalLength, true);

    view.setUint32(12, jsonPadded.length, true);
    view.setUint32(16, 0x4E4F534A, true);

    const uint8View = new Uint8Array(buffer);
    uint8View.set(jsonPadded, 20);

    const blob = new Blob([buffer]);
    const result = await analyzeModelQuality(blob);

    expect(result.validFormat).toBe(true);
    expect(result.version).toBe(1);
    expect(result.warnings.some((w) => w.includes('Unexpected glTF version'))).toBe(true);
  });

  it('should handle meshes without primitives array', async () => {
    const blob = createGlbBlob({
      asset: { version: '2.0' },
      meshes: [{ name: 'empty_mesh' }],
    });
    const result = await analyzeModelQuality(blob);

    expect(result.primitiveCount).toBe(0);
    expect(result.estimatedTriangles).toBe(0);
  });
});
