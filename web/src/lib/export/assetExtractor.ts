/**
 * Asset Extraction Engine
 * Extracts embedded base64 assets from scene JSON into separate files
 */

export interface ExtractedAsset {
  relativePath: string; // "assets/textures/abc123.png" or "assets/audio/xyz456.mp3"
  blob: Blob;
  originalRef: string; // The data URL that was replaced
}

export interface AssetExtractionResult {
  modifiedScene: unknown;
  assets: ExtractedAsset[];
}

/**
 * Extract all embedded base64 data URLs from scene data into separate asset files
 */
export async function extractAssets(sceneData: unknown): Promise<AssetExtractionResult> {
  const assets: ExtractedAsset[] = [];
  const seenHashes = new Set<string>();

  // Deep clone to avoid mutating original
  const modifiedScene = JSON.parse(JSON.stringify(sceneData));

  // Walk the scene tree and extract assets
  await walkAndExtract(modifiedScene, assets, seenHashes);

  return { modifiedScene, assets };
}

/**
 * Recursively walk object tree and extract data URLs
 */
async function walkAndExtract(
  obj: unknown,
  assets: ExtractedAsset[],
  seenHashes: Set<string>
): Promise<void> {
  if (obj === null || obj === undefined) return;
  if (typeof obj !== 'object') return;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      await walkAndExtract(item, assets, seenHashes);
    }
    return;
  }

  // Check all string properties for data URLs
  const record = obj as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const value = record[key];

    if (typeof value === 'string' && isDataUrl(value)) {
      // Extract this asset
      const extracted = await extractDataUrl(value, seenHashes);
      if (extracted) {
        assets.push(extracted);
        // Replace with relative path
        record[key] = extracted.relativePath;
      }
    } else if (typeof value === 'object') {
      // Recurse
      await walkAndExtract(value, assets, seenHashes);
    }
  }
}

/**
 * Check if string is a data URL
 */
function isDataUrl(str: string): boolean {
  return str.startsWith('data:');
}

/**
 * Extract a single data URL to an asset file
 */
async function extractDataUrl(
  dataUrl: string,
  seenHashes: Set<string>
): Promise<ExtractedAsset | null> {
  try {
    // Parse data URL: data:[<mediatype>][;base64],<data>
    const match = dataUrl.match(/^data:([^;,]+)?(;base64)?,(.+)$/);
    if (!match) return null;

    const mimeType = match[1] || 'application/octet-stream';
    const isBase64 = !!match[2];
    const data = match[3];

    // Convert to blob
    const blob = isBase64 ? await base64ToBlob(data, mimeType) : textToBlob(data, mimeType);

    // Generate hash for deduplication
    const hash = await hashBlob(blob);
    if (seenHashes.has(hash)) {
      // Already extracted this exact asset
      return null;
    }
    seenHashes.add(hash);

    // Determine file extension from MIME type
    const ext = getExtensionForMime(mimeType);

    // Determine asset category (textures, audio, models)
    const category = getCategoryForMime(mimeType);

    const relativePath = `assets/${category}/${hash}${ext}`;

    return {
      relativePath,
      blob,
      originalRef: dataUrl,
    };
  } catch (err) {
    console.warn('[AssetExtractor] Failed to extract data URL:', err);
    return null;
  }
}

/**
 * Convert base64 string to Blob
 */
async function base64ToBlob(base64: string, mimeType: string): Promise<Blob> {
  // Decode base64
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

/**
 * Convert text to Blob
 */
function textToBlob(text: string, mimeType: string): Blob {
  return new Blob([decodeURIComponent(text)], { type: mimeType });
}

/**
 * Generate hash of blob contents for deduplication
 */
async function hashBlob(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  return hashHex.slice(0, 12); // Use first 12 chars for shorter filenames
}

/**
 * Map MIME type to file extension
 */
function getExtensionForMime(mimeType: string): string {
  const map: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/svg+xml': '.svg',
    'audio/mpeg': '.mp3',
    'audio/mp3': '.mp3',
    'audio/wav': '.wav',
    'audio/ogg': '.ogg',
    'audio/webm': '.webm',
    'model/gltf+json': '.gltf',
    'model/gltf-binary': '.glb',
    'application/octet-stream': '.bin',
  };
  return map[mimeType.toLowerCase()] || '.bin';
}

/**
 * Map MIME type to asset category folder
 */
function getCategoryForMime(mimeType: string): string {
  if (mimeType.startsWith('image/')) return 'textures';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('model/')) return 'models';
  return 'other';
}
