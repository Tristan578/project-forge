// @vitest-environment jsdom
/**
 * Unit tests for captureCanvasThumbnail.
 *
 * Uses jsdom to provide document.getElementById and HTMLCanvasElement.
 * Canvas getContext / toDataURL are mocked via prototype patching so tests
 * run without a real rendering surface (jsdom does not implement canvas).
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { captureCanvasThumbnail } from '../captureCanvas';

// A stub 2d context that satisfies the drawImage call.
function makeCtxStub(): CanvasRenderingContext2D {
  return { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D;
}

// Install prototype-level mocks for getContext and toDataURL so that BOTH
// the source canvas and the offscreen canvas created inside the function
// behave correctly in jsdom (which does not implement canvas natively).
function mockCanvasPrototype(dataUrl = 'data:image/webp;base64,AAAA'): void {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(makeCtxStub());
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(dataUrl);
}

// Helper: create a canvas element and insert it into the document.
function createCanvas(id: string, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.id = id;
  canvas.width = width;
  canvas.height = height;
  document.body.appendChild(canvas);
  return canvas;
}

// Remove all child elements added during a test.
function clearBody(): void {
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
}

describe('captureCanvasThumbnail', () => {
  afterEach(() => {
    clearBody();
    vi.restoreAllMocks();
  });

  describe('successful capture', () => {
    it('returns a data URL string when the canvas exists', async () => {
      mockCanvasPrototype('data:image/webp;base64,AAAA');
      createCanvas('game-canvas', 640, 480);

      const result = await captureCanvasThumbnail('game-canvas');

      expect(result).toBe('data:image/webp;base64,AAAA');
    });

    it('returns the data URL produced by toDataURL', async () => {
      mockCanvasPrototype('data:image/webp;base64,CUSTOM');
      createCanvas('game-canvas', 100, 100);

      const result = await captureCanvasThumbnail('game-canvas');

      expect(result).toBe('data:image/webp;base64,CUSTOM');
    });
  });

  describe('missing canvas', () => {
    it('returns null when canvas ID does not exist', async () => {
      const result = await captureCanvasThumbnail('nonexistent-canvas');

      expect(result).toBeNull();
    });

    it('returns null when the element is not a canvas', async () => {
      const div = document.createElement('div');
      div.id = 'not-a-canvas';
      document.body.appendChild(div);

      const result = await captureCanvasThumbnail('not-a-canvas');

      expect(result).toBeNull();
    });
  });

  describe('zero-size canvas', () => {
    it('returns null when canvas width is 0', async () => {
      mockCanvasPrototype();
      createCanvas('zero-canvas', 0, 480);

      const result = await captureCanvasThumbnail('zero-canvas');

      expect(result).toBeNull();
    });

    it('returns null when canvas height is 0', async () => {
      mockCanvasPrototype();
      createCanvas('zero-canvas', 640, 0);

      const result = await captureCanvasThumbnail('zero-canvas');

      expect(result).toBeNull();
    });
  });

  describe('resize behaviour', () => {
    it('does not upscale a canvas smaller than maxWidth', async () => {
      mockCanvasPrototype('data:image/webp;base64,RESIZED');
      createCanvas('small-canvas', 200, 150);

      const result = await captureCanvasThumbnail('small-canvas');

      // Should return a data URL without upscaling.
      expect(result).toBe('data:image/webp;base64,RESIZED');
    });

    it('scales down a canvas wider than the default maxWidth (320px)', async () => {
      const assignedWidths: number[] = [];
      const assignedHeights: number[] = [];

      const origWidthDesc = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'width');
      const origHeightDesc = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'height');

      if (origWidthDesc) {
        Object.defineProperty(HTMLCanvasElement.prototype, 'width', {
          set(v: number) { assignedWidths.push(v); origWidthDesc.set?.call(this, v); },
          get() { return origWidthDesc.get?.call(this); },
          configurable: true,
        });
      }
      if (origHeightDesc) {
        Object.defineProperty(HTMLCanvasElement.prototype, 'height', {
          set(v: number) { assignedHeights.push(v); origHeightDesc.set?.call(this, v); },
          get() { return origHeightDesc.get?.call(this); },
          configurable: true,
        });
      }

      mockCanvasPrototype('data:image/webp;base64,RESIZED');
      createCanvas('large-canvas', 640, 480);

      await captureCanvasThumbnail('large-canvas');

      // The offscreen canvas should receive width=320, height=240.
      expect(assignedWidths).toContain(320);
      expect(assignedHeights).toContain(240);

      if (origWidthDesc) Object.defineProperty(HTMLCanvasElement.prototype, 'width', origWidthDesc);
      if (origHeightDesc) Object.defineProperty(HTMLCanvasElement.prototype, 'height', origHeightDesc);
    });

    it('respects a custom maxWidth parameter', async () => {
      const assignedWidths: number[] = [];

      const origWidthDesc = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'width');
      if (origWidthDesc) {
        Object.defineProperty(HTMLCanvasElement.prototype, 'width', {
          set(v: number) { assignedWidths.push(v); origWidthDesc.set?.call(this, v); },
          get() { return origWidthDesc.get?.call(this); },
          configurable: true,
        });
      }

      mockCanvasPrototype('data:image/webp;base64,RESIZED');
      createCanvas('custom-canvas', 800, 600);

      await captureCanvasThumbnail('custom-canvas', 400);

      expect(assignedWidths).toContain(400);

      if (origWidthDesc) Object.defineProperty(HTMLCanvasElement.prototype, 'width', origWidthDesc);
    });
  });

  describe('context failure', () => {
    it('returns null when getContext returns null', async () => {
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
      createCanvas('no-ctx-canvas', 320, 240);

      const result = await captureCanvasThumbnail('no-ctx-canvas');

      expect(result).toBeNull();
    });
  });
});