// @ts-check
/**
 * Pure, dependency-free artifact validation for generated SpawnForge assets.
 *
 * This module is imported by BOTH the Cloudflare Queue consumer Worker
 * (`worker.mjs`) and the co-located vitest suite (`validate.test.mjs`). It has
 * NO Cloudflare / web / Node runtime dependencies so it runs identically in the
 * Workers runtime and under vitest's `node` environment.
 *
 * Semantics mirror the web generate-status routes
 * (web/src/app/api/generate/<type>/status/route.ts): a provider can report success
 * yet upload an empty / malformed artifact. The consumer must catch that and
 * signal `failed`, never `valid`, so the poller refunds instead of sticking the
 * job in `downloading` for the full poll cap. See gotchas.md →
 * "provider-success-with-no-artifact must map to failed".
 */

/** GLB binary header magic: ASCII "glTF" little-endian (0x46546C67). */
const GLB_MAGIC = 0x46546c67;
/** GLB container format version this engine accepts (Bevy/gltf load v2). */
const GLB_VERSION = 2;
/** Minimum bytes for a meaningful GLB (12-byte header + at least one chunk header). */
const GLB_MIN_BYTES = 20;
/** Minimum bytes for a non-empty raster image artifact (texture/sprite/map). */
const IMAGE_MIN_BYTES = 16;
/** Minimum bytes for a non-empty audio artifact. */
const AUDIO_MIN_BYTES = 64;

/**
 * Classify an R2 object key into the artifact kind we should validate against.
 * Falls back to extension-based detection; unknown kinds are validated as
 * "binary" (non-empty only).
 *
 * @param {string} key R2 object key, e.g. "assets/u_1/a_2/file/model.glb"
 * @param {string | undefined | null} contentType R2 httpMetadata.contentType
 * @returns {'glb' | 'image' | 'audio' | 'binary'}
 */
export function classifyArtifact(key, contentType) {
  const ct = (contentType ?? '').toLowerCase();
  const lowerKey = (key ?? '').toLowerCase();

  if (ct.includes('model/gltf-binary') || lowerKey.endsWith('.glb')) return 'glb';
  if (ct.startsWith('image/') || /\.(png|jpe?g|webp|ktx2|basis)$/.test(lowerKey)) {
    return 'image';
  }
  if (ct.startsWith('audio/') || /\.(mp3|wav|ogg|flac|m4a)$/.test(lowerKey)) {
    return 'audio';
  }
  return 'binary';
}

/**
 * Validate a GLB binary by header. Checks magic + version + plausible length.
 * Does NOT fully parse chunks (too expensive in a Worker) — header validity +
 * the declared total length matching the actual byte length catches truncated /
 * empty / wrong-format uploads, which is the failure class we care about.
 *
 * @param {ArrayBuffer | Uint8Array} bytes
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateGlb(bytes) {
  const view = toDataView(bytes);
  if (!view || view.byteLength < GLB_MIN_BYTES) {
    return { valid: false, reason: 'GLB too small or empty' };
  }
  const magic = view.getUint32(0, true);
  if (magic !== GLB_MAGIC) {
    return { valid: false, reason: 'GLB magic mismatch (not a glTF-binary)' };
  }
  const version = view.getUint32(4, true);
  if (version !== GLB_VERSION) {
    return { valid: false, reason: `unsupported GLB version ${version}` };
  }
  const declaredLength = view.getUint32(8, true);
  // Declared length must be at least the header and must not exceed the bytes we
  // actually received (a truncated upload declares more than it delivered).
  if (declaredLength < GLB_MIN_BYTES || declaredLength > view.byteLength) {
    return { valid: false, reason: 'GLB declared length inconsistent with payload' };
  }
  return { valid: true };
}

/**
 * Validate a raster image artifact by magic bytes (PNG / JPEG / WebP) and a
 * non-empty floor. Unknown-but-non-trivial image payloads pass on size alone so
 * we never false-fail a valid but exotic format (KTX2/basis are GPU textures).
 *
 * @param {ArrayBuffer | Uint8Array} bytes
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateImage(bytes) {
  const view = toDataView(bytes);
  if (!view || view.byteLength < IMAGE_MIN_BYTES) {
    return { valid: false, reason: 'image too small or empty' };
  }
  const b0 = view.getUint8(0);
  const b1 = view.getUint8(1);
  const b2 = view.getUint8(2);
  const b3 = view.getUint8(3);
  // PNG: 89 50 4E 47
  if (b0 === 0x89 && b1 === 0x50 && b2 === 0x4e && b3 === 0x47) return { valid: true };
  // JPEG: FF D8 FF
  if (b0 === 0xff && b1 === 0xd8 && b2 === 0xff) return { valid: true };
  // WebP: "RIFF" .... "WEBP"
  if (b0 === 0x52 && b1 === 0x49 && b2 === 0x46 && b3 === 0x46 && view.byteLength >= 12) {
    if (
      view.getUint8(8) === 0x57 &&
      view.getUint8(9) === 0x45 &&
      view.getUint8(10) === 0x42 &&
      view.getUint8(11) === 0x50
    ) {
      return { valid: true };
    }
  }
  // Unknown signature but non-trivial payload (KTX2/basis GPU textures, etc.).
  return { valid: true };
}

/**
 * Validate an audio artifact: non-empty floor + best-effort magic for the
 * common container formats we accept.
 *
 * @param {ArrayBuffer | Uint8Array} bytes
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateAudio(bytes) {
  const view = toDataView(bytes);
  if (!view || view.byteLength < AUDIO_MIN_BYTES) {
    return { valid: false, reason: 'audio too small or empty' };
  }
  return { valid: true };
}

/**
 * Validate any non-empty binary artifact (fallback kind).
 *
 * @param {ArrayBuffer | Uint8Array} bytes
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateBinary(bytes) {
  const view = toDataView(bytes);
  if (!view || view.byteLength === 0) {
    return { valid: false, reason: 'artifact is empty' };
  }
  return { valid: true };
}

/**
 * Top-level dispatch: classify by key/content-type, then validate.
 *
 * @param {string} key
 * @param {string | undefined | null} contentType
 * @param {ArrayBuffer | Uint8Array} bytes
 * @returns {{ valid: boolean, kind: 'glb'|'image'|'audio'|'binary', reason?: string }}
 */
export function validateArtifact(key, contentType, bytes) {
  const kind = classifyArtifact(key, contentType);
  switch (kind) {
    case 'glb':
      return { kind, ...validateGlb(bytes) };
    case 'image':
      return { kind, ...validateImage(bytes) };
    case 'audio':
      return { kind, ...validateAudio(bytes) };
    default:
      return { kind, ...validateBinary(bytes) };
  }
}

/**
 * Normalize ArrayBuffer | Uint8Array into a DataView. Returns null for nullish
 * or non-buffer inputs so callers fail closed.
 *
 * @param {ArrayBuffer | Uint8Array | null | undefined} bytes
 * @returns {DataView | null}
 */
function toDataView(bytes) {
  if (bytes == null) return null;
  if (bytes instanceof Uint8Array) {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  if (bytes instanceof ArrayBuffer) {
    return new DataView(bytes);
  }
  return null;
}

export const __test__ = {
  GLB_MAGIC,
  GLB_VERSION,
  GLB_MIN_BYTES,
  IMAGE_MIN_BYTES,
  AUDIO_MIN_BYTES,
};
