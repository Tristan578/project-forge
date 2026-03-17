/**
 * Texture Compression for Game Export Pipeline
 *
 * Provides configurable texture compression to reduce exported game sizes.
 * Uses Canvas API (OffscreenCanvas when available) for format conversion.
 */

// --- Types ---

export type CompressionFormat = 'webp' | 'avif' | 'jpeg' | 'png' | 'original';

export interface CompressionConfig {
  /** Target image format */
  format: CompressionFormat;
  /** Quality 0-100 (only applies to lossy formats: webp, avif, jpeg) */
  quality: number;
  /** Maximum output width in pixels */
  maxWidth: number;
  /** Maximum output height in pixels */
  maxHeight: number;
  /** Whether to generate mipmaps (placeholder for future WASM-side support) */
  generateMipmaps: boolean;
}

export interface CompressedResult {
  /** Compressed image data */
  data: Blob;
  /** Output MIME type (e.g. 'image/webp') */
  format: string;
  /** Original size in bytes */
  originalSize: number;
  /** Compressed size in bytes */
  compressedSize: number;
  /** Compression ratio (compressedSize / originalSize) */
  ratio: number;
}

export interface TextureAsset {
  id: string;
  name: string;
  data: Blob | ArrayBuffer;
  mimeType: string;
}

// --- Presets ---

export const COMPRESSION_PRESETS: Record<string, CompressionConfig> = {
  fast_load: {
    format: 'webp',
    quality: 75,
    maxWidth: 1024,
    maxHeight: 1024,
    generateMipmaps: false,
  },
  balanced: {
    format: 'webp',
    quality: 85,
    maxWidth: 2048,
    maxHeight: 2048,
    generateMipmaps: false,
  },
  high_quality: {
    format: 'webp',
    quality: 95,
    maxWidth: 4096,
    maxHeight: 4096,
    generateMipmaps: true,
  },
  original: {
    format: 'original',
    quality: 100,
    maxWidth: Infinity,
    maxHeight: Infinity,
    generateMipmaps: false,
  },
};

// --- Helpers ---

function clampQuality(quality: number): number {
  return Math.max(0, Math.min(100, quality));
}

function getMimeType(format: CompressionFormat): string {
  const map: Record<CompressionFormat, string> = {
    webp: 'image/webp',
    avif: 'image/avif',
    jpeg: 'image/jpeg',
    png: 'image/png',
    original: 'application/octet-stream',
  };
  return map[format];
}

function isImageMimeType(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

/**
 * Calculate dimensions that fit within maxWidth/maxHeight while preserving aspect ratio.
 */
function fitDimensions(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number
): { width: number; height: number } {
  if (width <= maxWidth && height <= maxHeight) {
    return { width, height };
  }
  const scaleX = maxWidth / width;
  const scaleY = maxHeight / height;
  const scale = Math.min(scaleX, scaleY);
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}

/**
 * Convert Blob or ArrayBuffer to Blob.
 */
function toBlob(input: Blob | ArrayBuffer): Blob {
  if (input instanceof Blob) return input;
  return new Blob([input]);
}

// --- Core Functions ---

/**
 * Compress a single texture using the Canvas API.
 *
 * For 'original' format, passes through without re-encoding.
 * Uses OffscreenCanvas when available for better performance.
 */
export async function compressTexture(
  imageData: Blob | ArrayBuffer,
  config: CompressionConfig
): Promise<CompressedResult> {
  const inputBlob = toBlob(imageData);
  const originalSize = inputBlob.size;

  // Passthrough for original format
  if (config.format === 'original') {
    return {
      data: inputBlob,
      format: 'original',
      originalSize,
      compressedSize: originalSize,
      ratio: 1,
    };
  }

  const quality = clampQuality(config.quality) / 100;
  const mimeType = getMimeType(config.format);

  // Create ImageBitmap from the blob
  const bitmap = await createImageBitmap(inputBlob);
  const { width, height } = fitDimensions(
    bitmap.width,
    bitmap.height,
    config.maxWidth,
    config.maxHeight
  );

  let outputBlob: Blob;

  // Prefer OffscreenCanvas for non-UI-thread compression
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2D context from OffscreenCanvas');
    ctx.drawImage(bitmap, 0, 0, width, height);
    outputBlob = await canvas.convertToBlob({ type: mimeType, quality });
  } else if (typeof document !== 'undefined') {
    // Fallback to regular canvas
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2D context from canvas');
    ctx.drawImage(bitmap, 0, 0, width, height);
    outputBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Canvas toBlob returned null'));
        },
        mimeType,
        quality
      );
    });
  } else {
    // No canvas available (e.g. Node.js test environment) — passthrough
    return {
      data: inputBlob,
      format: mimeType,
      originalSize,
      compressedSize: originalSize,
      ratio: 1,
    };
  }

  bitmap.close();

  return {
    data: outputBlob,
    format: mimeType,
    originalSize,
    compressedSize: outputBlob.size,
    ratio: originalSize > 0 ? outputBlob.size / originalSize : 1,
  };
}

/**
 * Compress a batch of texture assets with progress reporting.
 *
 * Non-image assets are passed through without compression.
 */
export async function compressBatch(
  textures: TextureAsset[],
  config: CompressionConfig,
  onProgress?: (pct: number) => void
): Promise<CompressedResult[]> {
  const results: CompressedResult[] = [];
  const total = textures.length;

  for (let i = 0; i < total; i++) {
    const texture = textures[i];

    if (!isImageMimeType(texture.mimeType) || config.format === 'original') {
      // Non-image or original passthrough
      const blob = toBlob(texture.data);
      results.push({
        data: blob,
        format: texture.mimeType,
        originalSize: blob.size,
        compressedSize: blob.size,
        ratio: 1,
      });
    } else {
      const result = await compressTexture(texture.data, config);
      results.push(result);
    }

    if (onProgress) {
      onProgress(((i + 1) / total) * 100);
    }
  }

  return results;
}

/**
 * Estimate the compressed size of a texture given its original size and compression settings.
 * Returns estimated size in bytes.
 *
 * This is a rough heuristic — actual compression depends on image content.
 */
export function estimateCompression(
  originalSize: number,
  format: CompressionFormat,
  quality: number
): number {
  if (originalSize <= 0) return 0;
  if (format === 'original' || format === 'png') return originalSize;

  const clampedQuality = clampQuality(quality);

  // Rough compression ratios based on format and quality
  // These are empirical estimates for typical game textures
  const baseRatios: Record<string, number> = {
    webp: 0.3,
    avif: 0.25,
    jpeg: 0.35,
  };

  const baseRatio = baseRatios[format] ?? 1;
  // Higher quality = less compression = larger file
  // At quality 100, ratio approaches ~0.8 of original
  // At quality 0, ratio approaches the base ratio
  const qualityFactor = baseRatio + (0.8 - baseRatio) * (clampedQuality / 100);

  return Math.round(originalSize * qualityFactor);
}
