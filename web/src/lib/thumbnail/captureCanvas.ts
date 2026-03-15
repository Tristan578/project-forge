/**
 * Canvas thumbnail capture utility.
 *
 * Captures the current frame of a canvas element and returns a compressed
 * data URL suitable for use as a game thumbnail in the community gallery.
 */

const DEFAULT_MAX_WIDTH = 320;
const WEBP_QUALITY = 0.7;

/**
 * Captures a thumbnail from a canvas element by ID.
 *
 * Resizes the canvas output to at most `maxWidth` pixels wide (maintaining
 * aspect ratio) using an offscreen canvas, then encodes as WebP at 0.7
 * quality. Falls back to PNG if the browser does not support WebP output.
 *
 * @param canvasId - The DOM id of the source canvas element.
 * @param maxWidth - Maximum width of the output image in pixels. Defaults to 320.
 * @returns A data URL string, or null if the canvas element was not found or
 *          the capture failed.
 */
export async function captureCanvasThumbnail(
  canvasId: string,
  maxWidth: number = DEFAULT_MAX_WIDTH
): Promise<string | null> {
  const source = document.getElementById(canvasId);
  if (!(source instanceof HTMLCanvasElement)) {
    return null;
  }

  const srcWidth = source.width;
  const srcHeight = source.height;

  if (srcWidth === 0 || srcHeight === 0) {
    return null;
  }

  // Calculate destination dimensions, maintaining aspect ratio.
  const scale = srcWidth > maxWidth ? maxWidth / srcWidth : 1;
  const destWidth = Math.round(srcWidth * scale);
  const destHeight = Math.round(srcHeight * scale);

  // Draw into an offscreen canvas at the target size.
  const offscreen = document.createElement('canvas');
  offscreen.width = destWidth;
  offscreen.height = destHeight;

  const ctx = offscreen.getContext('2d');
  if (!ctx) {
    return null;
  }

  ctx.drawImage(source, 0, 0, destWidth, destHeight);

  // Prefer WebP for size efficiency; fall back to PNG.
  const dataUrl = offscreen.toDataURL('image/webp', WEBP_QUALITY);

  // If the browser returned a non-WebP data URL (some older browsers return
  // image/png regardless), accept it as-is — it is still a valid data URL.
  return dataUrl;
}
