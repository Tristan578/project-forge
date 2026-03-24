import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  detectPbrTextureSet,
  filesToBase64,
  type PbrTextureSet,
} from '../pbrTextureImporter';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFile(name: string): File {
  return new File(['data'], name, { type: 'image/png' });
}

// ---------------------------------------------------------------------------
// detectPbrTextureSet — slot pattern matching
// ---------------------------------------------------------------------------

describe('detectPbrTextureSet', () => {
  // --- albedo patterns ---
  it('maps *_albedo* to albedo slot', () => {
    const f = makeFile('rock_albedo.png');
    const set = detectPbrTextureSet([f]);
    expect(set).not.toBeNull();
    expect(set!.albedo).toBe(f);
  });

  it('maps *_color* to albedo slot', () => {
    const f = makeFile('brick_color.jpg');
    const set = detectPbrTextureSet([f]);
    expect(set!.albedo).toBe(f);
  });

  it('maps *_diffuse* to albedo slot', () => {
    const f = makeFile('wood_diffuse.png');
    const set = detectPbrTextureSet([f]);
    expect(set!.albedo).toBe(f);
  });

  it('maps *_basecolor* to albedo slot', () => {
    const f = makeFile('metal_basecolor.png');
    const set = detectPbrTextureSet([f]);
    expect(set!.albedo).toBe(f);
  });

  // --- normal patterns ---
  it('maps *_normal* to normal slot', () => {
    const f = makeFile('rock_normal.png');
    const set = detectPbrTextureSet([f]);
    expect(set!.normal).toBe(f);
  });

  it('maps *_nrm* to normal slot', () => {
    const f = makeFile('metal_nrm.png');
    const set = detectPbrTextureSet([f]);
    expect(set!.normal).toBe(f);
  });

  // --- metallic patterns ---
  it('maps *_metallic* to metallic slot', () => {
    const f = makeFile('armor_metallic.png');
    const set = detectPbrTextureSet([f]);
    expect(set!.metallic).toBe(f);
  });

  it('maps *_metal* to metallic slot', () => {
    const f = makeFile('pipe_metal.png');
    const set = detectPbrTextureSet([f]);
    expect(set!.metallic).toBe(f);
  });

  // --- roughness patterns ---
  it('maps *_roughness* to roughness slot', () => {
    const f = makeFile('concrete_roughness.png');
    const set = detectPbrTextureSet([f]);
    expect(set!.roughness).toBe(f);
  });

  it('maps *_rough* to roughness slot', () => {
    const f = makeFile('wood_rough.png');
    const set = detectPbrTextureSet([f]);
    expect(set!.roughness).toBe(f);
  });

  // --- ao patterns ---
  it('maps *_ao* to ao slot', () => {
    const f = makeFile('stone_ao.png');
    const set = detectPbrTextureSet([f]);
    expect(set!.ao).toBe(f);
  });

  it('maps *_ambient* to ao slot', () => {
    const f = makeFile('stone_ambient.png');
    const set = detectPbrTextureSet([f]);
    expect(set!.ao).toBe(f);
  });

  it('maps *_occlusion* to ao slot', () => {
    const f = makeFile('tile_occlusion.png');
    const set = detectPbrTextureSet([f]);
    expect(set!.ao).toBe(f);
  });

  // --- case insensitivity ---
  it('matches patterns case-insensitively (UPPER)', () => {
    const f = makeFile('ROCK_ALBEDO.PNG');
    const set = detectPbrTextureSet([f]);
    expect(set!.albedo).toBe(f);
  });

  it('matches patterns case-insensitively (mixed)', () => {
    const f = makeFile('Rock_Normal.png');
    const set = detectPbrTextureSet([f]);
    expect(set!.normal).toBe(f);
  });

  // --- unmatched files ---
  it('returns null when the only file does not match any slot', () => {
    const f = makeFile('thumbnail.png');
    const set = detectPbrTextureSet([f]);
    expect(set).toBeNull();
  });

  it('returns unmatched for non-PBR alongside PBR files', () => {
    const pbr = makeFile('mat_albedo.png');
    const other = makeFile('preview.jpg');
    const set = detectPbrTextureSet([pbr, other]);
    expect(set).not.toBeNull();
    expect(set!.albedo).toBe(pbr);
    expect(set!.unmatched).toContain(other);
  });

  // --- null when no PBR files ---
  it('returns null when no files match any PBR slot', () => {
    const files = [makeFile('readme.txt'), makeFile('scene.glb')];
    expect(detectPbrTextureSet(files)).toBeNull();
  });

  it('returns null for empty file list', () => {
    expect(detectPbrTextureSet([])).toBeNull();
  });

  // --- mixed set (some slots present, others missing) ---
  it('handles a partial set with only albedo and normal present', () => {
    const albedo = makeFile('mat_albedo.png');
    const normal = makeFile('mat_normal.png');
    const set = detectPbrTextureSet([albedo, normal]);
    expect(set!.albedo).toBe(albedo);
    expect(set!.normal).toBe(normal);
    expect(set!.metallic).toBeUndefined();
    expect(set!.roughness).toBeUndefined();
    expect(set!.ao).toBeUndefined();
    expect(set!.unmatched).toHaveLength(0);
  });

  it('handles a full five-slot set', () => {
    const files = [
      makeFile('m_albedo.png'),
      makeFile('m_normal.png'),
      makeFile('m_metallic.png'),
      makeFile('m_roughness.png'),
      makeFile('m_ao.png'),
    ];
    const set = detectPbrTextureSet(files);
    expect(set!.albedo).not.toBeUndefined();
    expect(set!.normal).not.toBeUndefined();
    expect(set!.metallic).not.toBeUndefined();
    expect(set!.roughness).not.toBeUndefined();
    expect(set!.ao).not.toBeUndefined();
    expect(set!.unmatched).toHaveLength(0);
  });

  // --- duplicate slot: second file goes to unmatched ---
  it('puts the second file in unmatched when two files share a slot', () => {
    const first = makeFile('mat1_albedo.png');
    const second = makeFile('mat2_albedo.png');
    const set = detectPbrTextureSet([first, second]);
    expect(set!.albedo).toBe(first);
    expect(set!.unmatched).toContain(second);
  });
});

// ---------------------------------------------------------------------------
// filesToBase64 — FileReader conversion
// ---------------------------------------------------------------------------

describe('filesToBase64', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let originalFileReader: any;

  beforeEach(() => {
    originalFileReader = globalThis.FileReader;

    // Stub FileReader with a class so `new FileReader()` works correctly.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).FileReader = class {
      result: string | null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      readAsDataURL(file: File) {
        this.result = `data:image/png;base64,STUB_${file.name}`;
        // Resolve asynchronously without setTimeout
        Promise.resolve().then(() => {
          if (this.onload) this.onload();
        });
      }
    };
  });

  afterEach(() => {
    globalThis.FileReader = originalFileReader;
  });

  it('returns data URLs for each present slot', async () => {
    const set: PbrTextureSet = {
      albedo: makeFile('mat_albedo.png'),
      normal: makeFile('mat_normal.png'),
      unmatched: [],
    };

    const data = await filesToBase64(set);

    expect(data.albedo).toBe('data:image/png;base64,STUB_mat_albedo.png');
    expect(data.normal).toBe('data:image/png;base64,STUB_mat_normal.png');
    expect(data.metallic).toBeUndefined();
    expect(data.roughness).toBeUndefined();
    expect(data.ao).toBeUndefined();
  });

  it('returns an empty object for an all-unmatched set', async () => {
    const set: PbrTextureSet = { unmatched: [makeFile('preview.jpg')] };
    const data = await filesToBase64(set);
    expect(Object.keys(data)).toHaveLength(0);
  });

  it('converts all five slots when fully populated', async () => {
    const set: PbrTextureSet = {
      albedo: makeFile('m_albedo.png'),
      normal: makeFile('m_normal.png'),
      metallic: makeFile('m_metallic.png'),
      roughness: makeFile('m_roughness.png'),
      ao: makeFile('m_ao.png'),
      unmatched: [],
    };

    const data = await filesToBase64(set);

    expect(data.albedo).toBe('data:image/png;base64,STUB_m_albedo.png');
    expect(data.normal).toBe('data:image/png;base64,STUB_m_normal.png');
    expect(data.metallic).toBe('data:image/png;base64,STUB_m_metallic.png');
    expect(data.roughness).toBe('data:image/png;base64,STUB_m_roughness.png');
    expect(data.ao).toBe('data:image/png;base64,STUB_m_ao.png');
  });
});
