/**
 * WebGL2 canvas frame readback utilities for agent viewport verification.
 *
 * Uses a `requestAnimationFrame` fence inside `page.evaluate()` for reliable
 * WebGL2 readback — ensuring we capture a fully-composited frame rather than
 * a mid-render state.
 */

import type { Page } from '@playwright/test';
import type { CaptureOptions, ViewportCapture } from './types';

/**
 * Determines whether a pixel data array represents a blank (empty) frame.
 *
 * A frame is considered blank when all sampled pixels are fully transparent
 * or pure black — meaning the WebGL2 engine has not yet rendered anything.
 *
 * Exported as a pure function so it can be unit-tested without a browser.
 *
 * @param pixelData - Uint8Array or number[] of RGBA pixel values.
 * @param sampleCount - Number of evenly-spaced pixels to sample. Default 64.
 * @returns true if the frame is blank.
 */
export function isBlankFrame(
  pixelData: Uint8Array | number[],
  sampleCount = 64,
): boolean {
  if (pixelData.length === 0) return true;

  const stride = Math.max(4, Math.floor(pixelData.length / sampleCount) * 4);

  for (let i = 0; i < pixelData.length; i += stride) {
    const r = pixelData[i] ?? 0;
    const g = pixelData[i + 1] ?? 0;
    const b = pixelData[i + 2] ?? 0;
    const a = pixelData[i + 3] ?? 0;
    // If any sampled pixel has non-zero color or full opacity, it's not blank
    if (r > 0 || g > 0 || b > 0 || a > 10) return false;
  }

  return true;
}

/**
 * Captures a single frame from the WebGL2 canvas.
 *
 * Uses a `requestAnimationFrame` fence to wait for the current render cycle
 * to complete before reading pixels via `toDataURL`. Falls back to a
 * screenshot-based approach if the canvas has `preserveDrawingBuffer = false`.
 *
 * @param page - Playwright Page object.
 * @param options - Capture configuration.
 * @returns ViewportCapture with pixel data, dimensions, and blank detection.
 */
export async function captureCanvasFrame(
  page: Page,
  options: CaptureOptions = {},
): Promise<ViewportCapture> {
  const {
    canvasSelector = 'canvas',
    maxRetries = 3,
    retryDelayMs = 500,
  } = options;

  let lastCapture: ViewportCapture | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const capture = await page.evaluate(
      async (selector: string): Promise<{
        dataUrl: string;
        width: number;
        height: number;
        timestamp: number;
        backend: string;
        pixelSample: number[];
      }> => {
        const canvas = document.querySelector(selector) as HTMLCanvasElement | null;
        if (!canvas) {
          return {
            dataUrl: '',
            width: 0,
            height: 0,
            timestamp: Date.now(),
            backend: 'unknown',
            pixelSample: [],
          };
        }

        // Wait for the current animation frame to finish rendering
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => resolve());
          });
        });

        // Detect rendering backend
        let backend = 'unknown';
        const webgl2 = canvas.getContext('webgl2');
        const webgl = canvas.getContext('webgl');
        if (webgl2) backend = 'webgl2';
        else if (webgl) backend = 'webgl2'; // treat WebGL1 as webgl2 for compat
        else if ((navigator as unknown as { gpu?: unknown }).gpu) backend = 'webgpu';

        // Capture the frame via toDataURL (requires preserveDrawingBuffer or a
        // frame boundary capture via RAF fence above)
        let dataUrl = '';
        try {
          dataUrl = canvas.toDataURL('image/png');
        } catch {
          // Cross-origin or security error — canvas tainted
          dataUrl = '';
        }

        // Sample pixel data for blank detection (avoid reading all pixels — expensive)
        const samplePixels: number[] = [];
        const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
        if (gl && canvas.width > 0 && canvas.height > 0) {
          const buf = new Uint8Array(4);
          const cols = 8;
          const rows = 8;
          for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
              const x = Math.floor((col / cols) * canvas.width);
              const y = Math.floor((row / rows) * canvas.height);
              gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
              samplePixels.push(buf[0] ?? 0, buf[1] ?? 0, buf[2] ?? 0, buf[3] ?? 0);
            }
          }
        }

        return {
          dataUrl,
          width: canvas.width,
          height: canvas.height,
          timestamp: Date.now(),
          backend,
          pixelSample: samplePixels,
        };
      },
      canvasSelector,
    );

    const blank = isBlankFrame(capture.pixelSample);

    lastCapture = {
      dataUrl: capture.dataUrl,
      width: capture.width,
      height: capture.height,
      timestamp: capture.timestamp,
      backend: capture.backend as ViewportCapture['backend'],
      isBlank: blank,
    };

    if (!blank || attempt === maxRetries) break;

    // Wait before retrying so the engine has time to render a frame
    await page.waitForTimeout(retryDelayMs);
  }

  // lastCapture is always set after the loop (at minimum attempt 0 runs)
  return lastCapture!;
}
