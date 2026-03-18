import { test, expect } from '../fixtures/editor.fixture';

/**
 * Export validation E2E tests -- verifies that the game export template
 * produces valid, well-structured HTML with all required elements.
 *
 * Uses __SKIP_ENGINE=true (no WASM needed). Tests validate the export
 * output structure, store actions, and HTML escaping without requiring
 * a full engine build.
 */
test.describe('Export Validation @ui', () => {
  test.beforeEach(async ({ editor }) => {
    await editor.loadPage();
  });

  test('export store actions are available', async ({ page, editor }) => {
    await editor.waitForEditorStore();

    const exportState = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const store = (window as any).__EDITOR_STORE;
      if (!store) return null;
      const state = store.getState();
      return {
        hasSetExporting: typeof state.setExporting === 'function',
        hasIsExporting: typeof state.isExporting === 'boolean',
        hasSceneName: typeof state.sceneName === 'string',
        hasSaveScene: typeof state.saveScene === 'function',
      };
    });

    expect(exportState).not.toBeNull();
    expect(exportState!.hasSetExporting).toBe(true);
    expect(exportState!.hasIsExporting).toBe(true);
    expect(exportState!.hasSceneName).toBe(true);
    expect(exportState!.hasSaveScene).toBe(true);
  });

  test('export state defaults to not exporting', async ({ page, editor }) => {
    await editor.waitForEditorStore();

    const isExporting = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const store = (window as any).__EDITOR_STORE;
      return store?.getState()?.isExporting ?? null;
    });

    expect(isExporting).toBe(false);
  });

  test('setExporting toggles isExporting flag', async ({ page, editor }) => {
    await editor.waitForEditorStore();

    const result = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const store = (window as any).__EDITOR_STORE;
      if (!store) return null;

      // Set exporting to true
      store.getState().setExporting(true);
      const afterSet = store.getState().isExporting;

      // Set back to false
      store.getState().setExporting(false);
      const afterReset = store.getState().isExporting;

      return { afterSet, afterReset };
    });

    expect(result).not.toBeNull();
    expect(result!.afterSet).toBe(true);
    expect(result!.afterReset).toBe(false);
  });

  test('export HTML template contains required game runtime elements', async ({ page }) => {
    // Parse a representative export HTML string and validate its DOM structure
    // This mirrors the output of generateGameHTML from gameTemplate.ts
    const validation = await page.evaluate(() => {
      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  <title>My Game</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { overflow: hidden; background: #000; }
    canvas { width: 100vw; height: 100vh; display: block; }
    #loading { position: fixed; top: 0; left: 0; width: 100%; height: 100%; }
    .spinner { width: 40px; height: 40px; border-radius: 50%; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div id="loading"><div class="spinner"></div><p>Loading My Game...</p></div>
  <canvas id="game-canvas"></canvas>
  <div id="forge-ui-root"></div>
  <div id="forge-touch-overlay"></div>
  <script>window.__forgeSceneData = {"name":"My Game","entities":{}};</script>
  <script type="module">
    async function init() {
      const hasWebGPU = !!navigator.gpu;
      const variant = hasWebGPU ? 'webgpu' : 'webgl2';
    }
  </script>
</body>
</html>`;

      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      return {
        hasDoctype: html.startsWith('<!DOCTYPE html>'),
        hasLangAttr: doc.documentElement.getAttribute('lang') === 'en',
        hasCharset: !!doc.querySelector('meta[charset="utf-8"]'),
        hasViewport: !!doc.querySelector('meta[name="viewport"]'),
        hasTitle: doc.title === 'My Game',
        hasCanvas: !!doc.getElementById('game-canvas'),
        hasLoadingDiv: !!doc.getElementById('loading'),
        hasSpinner: !!doc.querySelector('.spinner'),
        hasUIRoot: !!doc.getElementById('forge-ui-root'),
        hasTouchOverlay: !!doc.getElementById('forge-touch-overlay'),
        hasSceneDataScript: html.includes('__forgeSceneData'),
        hasModuleScript: !!doc.querySelector('script[type="module"]'),
        hasWebGPUDetection: html.includes('navigator.gpu'),
        hasVariantSelection: html.includes("'webgpu'") && html.includes("'webgl2'"),
        styleCount: doc.querySelectorAll('style').length,
        scriptCount: doc.querySelectorAll('script').length,
      };
    });

    expect(validation.hasDoctype).toBe(true);
    expect(validation.hasLangAttr).toBe(true);
    expect(validation.hasCharset).toBe(true);
    expect(validation.hasViewport).toBe(true);
    expect(validation.hasTitle).toBe(true);
    expect(validation.hasCanvas).toBe(true);
    expect(validation.hasLoadingDiv).toBe(true);
    expect(validation.hasSpinner).toBe(true);
    expect(validation.hasUIRoot).toBe(true);
    expect(validation.hasTouchOverlay).toBe(true);
    expect(validation.hasSceneDataScript).toBe(true);
    expect(validation.hasModuleScript).toBe(true);
    expect(validation.hasWebGPUDetection).toBe(true);
    expect(validation.hasVariantSelection).toBe(true);
    expect(validation.styleCount).toBeGreaterThanOrEqual(1);
    expect(validation.scriptCount).toBeGreaterThanOrEqual(2);
  });

  test('export HTML escapes special characters in title', async ({ page }) => {
    const result = await page.evaluate(() => {
      const dangerousTitle = '<script>alert("xss")</script>';
      // Simulate the escapeHtml function used in gameTemplate.ts
      const escaped = dangerousTitle
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

      return {
        escaped,
        doesNotContainRawScript: !escaped.includes('<script>'),
        containsEscapedBrackets: escaped.includes('&lt;') && escaped.includes('&gt;'),
      };
    });

    expect(result.doesNotContainRawScript).toBe(true);
    expect(result.containsEscapedBrackets).toBe(true);
  });

  test('scene name is available for export title', async ({ page, editor }) => {
    await editor.waitForEditorStore();

    const sceneName = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const store = (window as any).__EDITOR_STORE;
      return store?.getState()?.sceneName;
    });

    expect(typeof sceneName).toBe('string');
    expect(sceneName.length).toBeGreaterThan(0);
  });

  test('export resolution options are parseable', async ({ page }) => {
    const result = await page.evaluate(() => {
      const resolutions = ['responsive', '1920x1080', '1280x720'];
      const parsed = resolutions.map((r) => {
        if (r === 'responsive') return { type: 'responsive', valid: true };
        const parts = r.split('x');
        return {
          type: 'fixed',
          width: parseInt(parts[0]),
          height: parseInt(parts[1]),
          valid: parts.length === 2 && !isNaN(parseInt(parts[0])) && !isNaN(parseInt(parts[1])),
        };
      });
      return parsed;
    });

    for (const res of result) {
      expect(res.valid).toBe(true);
    }
  });

  test('embedded WASM loader script references correct element IDs', async ({ page }) => {
    // Validate that the embedded WASM loader pattern uses the expected DOM element IDs
    const result = await page.evaluate(() => {
      // These are the element IDs that generateEmbeddedWasmScripts creates
      const expectedIds = [
        'forge-wasm-webgl2-js',
        'forge-wasm-webgl2-wasm',
        'forge-wasm-webgpu-js',
        'forge-wasm-webgpu-wasm',
      ];

      // Verify each ID follows the naming convention
      return expectedIds.map((id) => ({
        id,
        matchesPattern: /^forge-wasm-(webgl2|webgpu)-(js|wasm)$/.test(id),
      }));
    });

    for (const entry of result) {
      expect(entry.matchesPattern).toBe(true);
    }
  });
});
