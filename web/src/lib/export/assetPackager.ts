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

export interface AssetPackageOptions {
  /**
   * When true, compresses image textures using WebP at 0.85 quality.
   * PNG assets (which may have transparency) fall back to PNG format.
   * Default: false (backwards compatible).
   */
  compress?: boolean;
  /** Override the default compression config. Only used when compress=true. */
  compressionConfig?: CompressionConfig;
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
  if (override) return override;
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
  const { compress = false, compressionConfig } = options;
  const packaged: PackagedAsset[] = [];
  const manifest: Record<string, string> = {};
  let totalSize = 0;

  for (const [id, asset] of Object.entries(assets)) {
    if (!asset.data) continue;

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
