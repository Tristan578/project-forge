/**
 * Image Upload utilities for multi-modal chat input.
 * Handles file validation, resizing, and base64 conversion.
 */

export const IMAGE_MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
export const IMAGE_MAX_DIMENSION = 1568; // Anthropic API max dimension
export const IMAGE_ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
export const IMAGE_MAX_COUNT = 5;

export interface ImageUploadResult {
  success: boolean;
  /** Base64 data URL */
  dataUrl?: string;
  /** Actual media type (e.g. 'image/jpeg', 'image/png') extracted from the data URL */
  mediaType?: string;
  /** Original file name */
  fileName?: string;
  /** Error message if failed */
  error?: string;
  /** Original dimensions */
  originalWidth?: number;
  originalHeight?: number;
  /** Final dimensions (after resize) */
  finalWidth?: number;
  finalHeight?: number;
}

/**
 * Validate a file for image upload.
 */
export function validateImageFile(file: File): string | null {
  if (!IMAGE_ALLOWED_TYPES.includes(file.type)) {
    return `Unsupported file type: ${file.type}. Allowed: PNG, JPEG, GIF, WebP`;
  }
  if (file.size > IMAGE_MAX_SIZE_BYTES) {
    const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
    return `File too large: ${sizeMB}MB. Maximum: 5MB`;
  }
  return null;
}

/**
 * Read a file as a data URL (base64).
 */
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

/**
 * Resize an image if it exceeds max dimensions while preserving aspect ratio.
 * Returns a base64 data URL.
 */
export function resizeImage(
  dataUrl: string,
  maxDimension: number = IMAGE_MAX_DIMENSION,
): Promise<{ dataUrl: string; mediaType: string; width: number; height: number; originalWidth: number; originalHeight: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const { width, height } = img;

      // Check if resize is needed
      if (width <= maxDimension && height <= maxDimension) {
        resolve({ dataUrl, mediaType: getMediaType(dataUrl), width, height, originalWidth: width, originalHeight: height });
        return;
      }

      // Calculate new dimensions
      const ratio = Math.min(maxDimension / width, maxDimension / height);
      const newWidth = Math.round(width * ratio);
      const newHeight = Math.round(height * ratio);

      // Resize using canvas — always outputs PNG
      const canvas = document.createElement('canvas');
      canvas.width = newWidth;
      canvas.height = newHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to create canvas context'));
        return;
      }
      ctx.drawImage(img, 0, 0, newWidth, newHeight);

      const resizedUrl = canvas.toDataURL('image/png');
      resolve({
        dataUrl: resizedUrl,
        mediaType: 'image/png',
        width: newWidth,
        height: newHeight,
        originalWidth: width,
        originalHeight: height,
      });
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = dataUrl;
  });
}

/**
 * Process a file for upload: validate, read, and resize.
 */
export async function processImageFile(file: File): Promise<ImageUploadResult> {
  const validationError = validateImageFile(file);
  if (validationError) {
    return { success: false, error: validationError, fileName: file.name };
  }

  try {
    const dataUrl = await readFileAsDataUrl(file);
    const resized = await resizeImage(dataUrl);

    return {
      success: true,
      dataUrl: resized.dataUrl,
      mediaType: resized.mediaType,
      fileName: file.name,
      originalWidth: resized.originalWidth,
      originalHeight: resized.originalHeight,
      finalWidth: resized.width,
      finalHeight: resized.height,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to process image',
      fileName: file.name,
    };
  }
}

/**
 * Process multiple files for upload with count validation.
 */
export async function processImageFiles(
  files: File[],
  existingCount: number = 0,
): Promise<{ results: ImageUploadResult[]; error?: string }> {
  const available = IMAGE_MAX_COUNT - existingCount;
  if (available <= 0) {
    return { results: [], error: `Maximum ${IMAGE_MAX_COUNT} images allowed` };
  }

  const filesToProcess = files.slice(0, available);
  const results = await Promise.all(filesToProcess.map(processImageFile));

  const error = files.length > available
    ? `Only ${available} more image${available === 1 ? '' : 's'} allowed (limit: ${IMAGE_MAX_COUNT})`
    : undefined;

  return { results, error };
}

/**
 * Extract the base64 data from a data URL, stripping the prefix.
 */
export function extractBase64(dataUrl: string): string {
  return dataUrl.replace(/^data:image\/\w+;base64,/, '');
}

/**
 * Get the media type from a data URL.
 */
export function getMediaType(dataUrl: string): string {
  const match = dataUrl.match(/^data:(image\/\w+);base64,/);
  return match ? match[1] : 'image/png';
}
