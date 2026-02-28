/**
 * Tests for single-HTML export with embedded WASM.
 * Verifies that WASM data is properly embedded and the loader
 * generates correct Blob URL + base64 decoding code.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';
import { generateGameHTML, type EmbeddedWasmData } from '../gameTemplate';

function makeBaseOptions(overrides: Partial<Parameters<typeof generateGameHTML>[0]> = {}) {
  return {
    title: 'Test Game',
    bgColor: '#000000',
    resolution: 'responsive' as const,
    sceneData: '{"entities":[]}',
    scriptBundle: '',
    includeDebug: false,
    ...overrides,
  };
}

// Helper: create base64 from a string (simulating what exportEngine does)
function toBase64(text: string): string {
  // Use Buffer in Node/vitest
  return Buffer.from(text).toString('base64');
}

const mockWasm: Record<string, EmbeddedWasmData> = {
  webgl2: {
    jsBase64: toBase64('export default function init() {}; export function init_engine() {}'),
    wasmBase64: toBase64('fake-wasm-binary-webgl2'),
  },
  webgpu: {
    jsBase64: toBase64('export default function init() {}; export function init_engine() {}'),
    wasmBase64: toBase64('fake-wasm-binary-webgpu'),
  },
};

describe('single-HTML export with embedded WASM', () => {
  describe('embedded WASM data scripts', () => {
    it('should embed base64 data in script tags when embeddedWasm is provided', () => {
      const html = generateGameHTML(makeBaseOptions({ embeddedWasm: mockWasm }));
      expect(html).toContain('id="forge-wasm-webgl2-js"');
      expect(html).toContain('id="forge-wasm-webgl2-wasm"');
      expect(html).toContain('id="forge-wasm-webgpu-js"');
      expect(html).toContain('id="forge-wasm-webgpu-wasm"');
    });

    it('should use type="text/plain" to prevent execution of embedded data', () => {
      const html = generateGameHTML(makeBaseOptions({ embeddedWasm: mockWasm }));
      expect(html).toContain('type="text/plain"');
    });

    it('should contain the actual base64 data', () => {
      const html = generateGameHTML(makeBaseOptions({ embeddedWasm: mockWasm }));
      expect(html).toContain(mockWasm.webgl2.jsBase64);
      expect(html).toContain(mockWasm.webgl2.wasmBase64);
      expect(html).toContain(mockWasm.webgpu.jsBase64);
      expect(html).toContain(mockWasm.webgpu.wasmBase64);
    });
  });

  describe('embedded WASM loader code', () => {
    it('should use Blob URL approach for loading JS glue', () => {
      const html = generateGameHTML(makeBaseOptions({ embeddedWasm: mockWasm }));
      expect(html).toContain('URL.createObjectURL');
      expect(html).toContain('atob(jsEl.textContent)');
    });

    it('should decode WASM binary from base64', () => {
      const html = generateGameHTML(makeBaseOptions({ embeddedWasm: mockWasm }));
      expect(html).toContain('atob(wasmB64)');
      expect(html).toContain('new Uint8Array');
      expect(html).toContain('charCodeAt');
    });

    it('should pass decoded WASM binary to init_wasm', () => {
      const html = generateGameHTML(makeBaseOptions({ embeddedWasm: mockWasm }));
      expect(html).toContain('init_wasm(wasmBytes.buffer)');
    });

    it('should include webgpu fallback to webgl2', () => {
      const html = generateGameHTML(makeBaseOptions({ embeddedWasm: mockWasm }));
      expect(html).toContain("forge-wasm-webgl2-js");
    });

    it('should revoke Blob URL after import', () => {
      const html = generateGameHTML(makeBaseOptions({ embeddedWasm: mockWasm }));
      expect(html).toContain('URL.revokeObjectURL(jsBlobUrl)');
    });
  });

  describe('external WASM loader (no embeddedWasm)', () => {
    it('should use external import paths when no embeddedWasm', () => {
      const html = generateGameHTML(makeBaseOptions());
      expect(html).toContain('__forgeBasePath');
      expect(html).toContain("engine-pkg-");
      expect(html).toContain("forge_engine.js");
    });

    it('should NOT contain embedded data scripts when no embeddedWasm', () => {
      const html = generateGameHTML(makeBaseOptions());
      expect(html).not.toContain('forge-wasm-webgl2-js');
      expect(html).not.toContain('forge-wasm-webgpu-wasm');
    });

    it('should call init_wasm() without arguments for external loading', () => {
      const html = generateGameHTML(makeBaseOptions());
      expect(html).toContain('init_wasm()');
      expect(html).not.toContain('init_wasm(wasmBytes');
    });
  });

  describe('debug mode with embedded WASM', () => {
    it('should include debug logging when includeDebug is true', () => {
      const html = generateGameHTML(makeBaseOptions({ embeddedWasm: mockWasm, includeDebug: true }));
      expect(html).toContain('Loading embedded WASM');
    });

    it('should not include debug logging when includeDebug is false', () => {
      const html = generateGameHTML(makeBaseOptions({ embeddedWasm: mockWasm, includeDebug: false }));
      expect(html).not.toContain('Loading embedded WASM');
    });
  });

  describe('single-variant embedding', () => {
    it('should work with only webgl2 variant', () => {
      const webgl2Only: Record<string, EmbeddedWasmData> = {
        webgl2: mockWasm.webgl2,
      };
      const html = generateGameHTML(makeBaseOptions({ embeddedWasm: webgl2Only }));
      expect(html).toContain('forge-wasm-webgl2-js');
      expect(html).not.toContain('forge-wasm-webgpu-js');
    });
  });

  describe('HTML structure', () => {
    it('should be a valid HTML document', () => {
      const html = generateGameHTML(makeBaseOptions({ embeddedWasm: mockWasm }));
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<html lang="en">');
      expect(html).toContain('</html>');
    });

    it('should include game canvas', () => {
      const html = generateGameHTML(makeBaseOptions({ embeddedWasm: mockWasm }));
      expect(html).toContain('id="game-canvas"');
    });

    it('should include the title', () => {
      const html = generateGameHTML(makeBaseOptions({ title: 'My Cool Game', embeddedWasm: mockWasm }));
      expect(html).toContain('<title>My Cool Game</title>');
    });

    it('should escape HTML in title', () => {
      const html = generateGameHTML(makeBaseOptions({ title: '<script>alert(1)</script>', embeddedWasm: mockWasm }));
      expect(html).toContain('&lt;script&gt;');
      expect(html).not.toContain('<title><script>');
    });
  });
});
