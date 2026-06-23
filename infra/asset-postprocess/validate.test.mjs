import { describe, it, expect } from 'vitest';
import {
  classifyArtifact,
  validateGlb,
  validateImage,
  validateAudio,
  validateBinary,
  validateArtifact,
} from './validate.mjs';

/** Build a minimal valid GLB header buffer with a given declared length. */
function makeGlb({ magic = 0x46546c67, version = 2, length = 20, totalBytes = 20 } = {}) {
  const buf = new ArrayBuffer(totalBytes);
  const view = new DataView(buf);
  view.setUint32(0, magic, true);
  view.setUint32(4, version, true);
  view.setUint32(8, length, true);
  return new Uint8Array(buf);
}

function bytesOf(arr) {
  return new Uint8Array(arr);
}

describe('classifyArtifact', () => {
  it('classifies GLB by extension', () => {
    expect(classifyArtifact('assets/u/a/file/model.glb', undefined)).toBe('glb');
  });
  it('classifies GLB by content-type', () => {
    expect(classifyArtifact('assets/u/a/file/model.bin', 'model/gltf-binary')).toBe('glb');
  });
  it('classifies images by extension and content-type', () => {
    expect(classifyArtifact('x/tex.png', undefined)).toBe('image');
    expect(classifyArtifact('x/tex.jpg', undefined)).toBe('image');
    expect(classifyArtifact('x/tex.bin', 'image/webp')).toBe('image');
    expect(classifyArtifact('x/tex.ktx2', undefined)).toBe('image');
  });
  it('classifies audio by extension and content-type', () => {
    expect(classifyArtifact('x/song.mp3', undefined)).toBe('audio');
    expect(classifyArtifact('x/clip.wav', undefined)).toBe('audio');
    expect(classifyArtifact('x/clip.bin', 'audio/ogg')).toBe('audio');
  });
  it('falls back to binary for unknown', () => {
    expect(classifyArtifact('x/thing.dat', undefined)).toBe('binary');
    expect(classifyArtifact('', null)).toBe('binary');
  });
  it('is case-insensitive on extension and content-type', () => {
    expect(classifyArtifact('X/MODEL.GLB', undefined)).toBe('glb');
    expect(classifyArtifact('x/t.PNG', undefined)).toBe('image');
  });
});

describe('validateGlb', () => {
  it('accepts a well-formed GLB header', () => {
    expect(validateGlb(makeGlb())).toEqual({ valid: true });
  });
  it('rejects empty / too-small buffers', () => {
    expect(validateGlb(new Uint8Array(0)).valid).toBe(false);
    expect(validateGlb(new Uint8Array(8)).valid).toBe(false);
  });
  it('rejects wrong magic', () => {
    const r = validateGlb(makeGlb({ magic: 0x12345678 }));
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/magic/);
  });
  it('rejects unsupported version', () => {
    const r = validateGlb(makeGlb({ version: 1 }));
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/version/);
  });
  it('rejects a truncated upload (declared length exceeds payload)', () => {
    // 20-byte buffer but header declares 5000 bytes -> truncated.
    const r = validateGlb(makeGlb({ length: 5000, totalBytes: 20 }));
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/declared length/);
  });
  it('rejects a nonsensically small declared length', () => {
    const r = validateGlb(makeGlb({ length: 4, totalBytes: 20 }));
    expect(r.valid).toBe(false);
  });
  it('accepts ArrayBuffer input as well as Uint8Array', () => {
    expect(validateGlb(makeGlb().buffer)).toEqual({ valid: true });
  });
  it('fails closed on nullish input', () => {
    expect(validateGlb(null).valid).toBe(false);
    expect(validateGlb(undefined).valid).toBe(false);
  });
});

describe('validateImage', () => {
  it('accepts a PNG signature', () => {
    const png = bytesOf([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(validateImage(png)).toEqual({ valid: true });
  });
  it('accepts a JPEG signature', () => {
    const jpg = bytesOf([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(validateImage(jpg)).toEqual({ valid: true });
  });
  it('accepts a WebP signature', () => {
    const webp = bytesOf([
      0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0, 0, 0, 0,
    ]);
    expect(validateImage(webp)).toEqual({ valid: true });
  });
  it('rejects empty / too-small image (the empty-artifact failure class)', () => {
    expect(validateImage(new Uint8Array(0)).valid).toBe(false);
    expect(validateImage(new Uint8Array(4)).valid).toBe(false);
  });
  it('passes unknown-signature but non-trivial payload (KTX2/basis)', () => {
    const ktx = new Uint8Array(64).fill(0xab);
    expect(validateImage(ktx).valid).toBe(true);
  });
});

describe('validateAudio', () => {
  it('accepts a non-empty audio payload', () => {
    expect(validateAudio(new Uint8Array(128).fill(1)).valid).toBe(true);
  });
  it('rejects an empty / tiny audio payload', () => {
    expect(validateAudio(new Uint8Array(0)).valid).toBe(false);
    expect(validateAudio(new Uint8Array(8)).valid).toBe(false);
  });
});

describe('validateBinary', () => {
  it('accepts any non-empty binary', () => {
    expect(validateBinary(new Uint8Array(1)).valid).toBe(true);
  });
  it('rejects empty binary', () => {
    expect(validateBinary(new Uint8Array(0)).valid).toBe(false);
    expect(validateBinary(null).valid).toBe(false);
  });
});

describe('validateArtifact (dispatch)', () => {
  it('routes GLB keys to GLB validation', () => {
    const r = validateArtifact('a/model.glb', undefined, makeGlb());
    expect(r).toEqual({ valid: true, kind: 'glb' });
  });
  it('routes and fails an empty GLB (provider-success-with-no-artifact)', () => {
    const r = validateArtifact('a/model.glb', 'model/gltf-binary', new Uint8Array(0));
    expect(r.kind).toBe('glb');
    expect(r.valid).toBe(false);
  });
  it('routes image keys to image validation', () => {
    const png = bytesOf([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(validateArtifact('a/tex.png', undefined, png)).toEqual({
      valid: true,
      kind: 'image',
    });
  });
  it('routes audio keys to audio validation', () => {
    expect(validateArtifact('a/song.mp3', undefined, new Uint8Array(128)).kind).toBe('audio');
  });
  it('routes unknown keys to binary validation', () => {
    expect(validateArtifact('a/thing.dat', undefined, new Uint8Array(4)).kind).toBe('binary');
  });
});
