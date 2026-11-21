import type { AssetMetadata } from '@/stores/editorStore';
import {
  compressTexture,
  COMPRESSION_PRESETS,
  type CompressionConfig,
} from './textureCompression';

interface PackagedAsset {
  id: string;
  filename: string;
  data: ArrayBuffer;
  mimeType: string;
}

interface AssetPackage {
  assets: PackagedAsset[];
  manifest: Record<string, string>; // assetId → filename
  totalSize: number;
}

/** Maximum allowed size for a single asset (bytes). Assets exceeding this are warned and skipped. */
export const MAX_ASSET_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

/** Maximum allowed total package size (bytes). Export is rejected if this is exceeded. */
export const MAX_PACKAGE_SIZE_BYTES = 200 * 1024 * 1024; // 200 MB

export interface AssetPackageOptions {
  /**
   * When true, compresses image textures using WebP at 0.85 quality.
   * PNG assets (which may have transparency) fall back to PNG format.
   * Default: false (backwards compatible).
   */
  compress?: boolean;
  /** Override the default compression config. Only used when compress=true. */
  compressionConfig?: CompressionConfig;
  /**
   * Override the per-asset size limit in bytes.
   * Assets exceeding this are warned and skipped.
   * Default: 10 MB.
   */
  maxAssetSize?: number;
  /**
   * Override the total package size limit in bytes.
   * Export throws if the accumulated size would exceed this.
   * Default: 200 MB.
   */
  maxPackageSize?: number;
}

/** Image MIME types that should be kept as PNG to preserve transparency. */
const PNG_PRESERVE_TYPES = new Set(['image/png', 'image/gif']);

/**
 * Returns true if the MIME type is a compressible image.
 */
function isCompressibleImage(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

/**
 * Selects a compression config for the given MIME type.
 * PNG/GIF images keep PNG format to preserve transparency.
 * All other images use WebP at 0.85 quality (balanced preset).
 */
function selectCompressionConfig(
  mimeType: string,
  override?: CompressionConfig,
): CompressionConfig {
  if (override) {
    // Prevent silent transparency loss: if the source has alpha (PNG/GIF)
    // but the override uses a format without alpha support (jpeg), force PNG.
    if (PNG_PRESERVE_TYPES.has(mimeType) && override.format === 'jpeg') {
      return { ...override, format: 'png' };
    }
    return override;
  }
  if (PNG_PRESERVE_TYPES.has(mimeType)) {
    return { ...COMPRESSION_PRESETS.balanced, format: 'png' };
  }
  // Default: WebP 85 quality — canvas.toBlob('image/webp', 0.85) under the hood
  return COMPRESSION_PRESETS.balanced;
}

/**
 * Map a MIME type back to a file extension for the packaged filename.
 */
function mimeToExt(mimeType: string): string | undefined {
  const map: Record<string, string> = {
    'image/webp': 'webp',
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/avif': 'avif',
  };
  return map[mimeType];
}

export async function packageAssets(
  assets: Record<string, AssetMetadata & { data?: ArrayBuffer }>,
  options: AssetPackageOptions = {},
): Promise<AssetPackage> {
  const {
    compress = false,
    compressionConfig,
    maxAssetSize = MAX_ASSET_SIZE_BYTES,
    maxPackageSize = MAX_PACKAGE_SIZE_BYTES,
  } = options;
  const packaged: PackagedAsset[] = [];
  const manifest: Record<string, string> = {};
  let totalSize = 0;

  for (const [id, asset] of Object.entries(assets)) {
    if (!asset.data) continue;

    // Per-asset size check: warn and skip assets exceeding the per-asset limit.
    if (asset.data.byteLength > maxAssetSize) {
      const sizeMB = (asset.data.byteLength / (1024 * 1024)).toFixed(1);
      const limitMB = (maxAssetSize / (1024 * 1024)).toFixed(0);
      console.warn(
        `[assetPackager] Skipping asset "${asset.name}" (${id}): size ${sizeMB} MB exceeds per-asset limit of ${limitMB} MB.`,
      );
      continue;
    }

    const ext = asset.name.split('.').pop() || 'bin';
    const originalMimeType = getMimeType(ext);

    let data: ArrayBuffer = asset.data;
    let finalMimeType = originalMimeType;
    let finalExt = ext;

    if (compress && isCompressibleImage(originalMimeType)) {
      const config = selectCompressionConfig(originalMimeType, compressionConfig);
      try {
        const inputBlob = new Blob([asset.data], { type: originalMimeType });
        const result = await compressTexture(inputBlob, config);
        const compressed = await result.data.arrayBuffer();
        // Only keep compressed version if it is actually smaller
        if (compressed.byteLength < asset.data.byteLength) {
          data = compressed;
          finalMimeType =
            result.format === 'original' || result.format === 'application/octet-stream'
              ? originalMimeType
              : result.format;
          finalExt = mimeToExt(finalMimeType) ?? ext;
        }
      } catch {
        // Compression failed — fall back to original data silently
      }
    }

    // Total package size check: validate before adding the asset.
    if (totalSize + data.byteLength > maxPackageSize) {
      const totalMB = ((totalSize + data.byteLength) / (1024 * 1024)).toFixed(1);
      const limitMB = (maxPackageSize / (1024 * 1024)).toFixed(0);
      throw new Error(
        `Asset package size limit exceeded: adding "${asset.name}" would bring total to ${totalMB} MB, which exceeds the ${limitMB} MB limit. Remove large assets from the scene before exporting.`,
      );
    }

    const filename = `${id}.${finalExt}`;

    packaged.push({ id, filename, data, mimeType: finalMimeType });
    manifest[id] = filename;
    totalSize += data.byteLength;
  }

  return { assets: packaged, manifest, totalSize };
}

function getMimeType(ext: string): string {
  const types: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
    glb: 'model/gltf-binary', gltf: 'model/gltf+json',
    mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', flac: 'audio/flac',
  };
  return types[ext.toLowerCase()] || 'application/octet-stream';
}
