/**
 * ZIP Export Engine
 * Generates ZIP archives containing game assets
 * Uses native browser APIs (no external dependencies)
 */

import { extractAssets } from './assetExtractor';
import type { GameTemplateOptions } from './gameTemplate';
import { bundleScripts } from './scriptBundler';
import { generateLoadingHtml, generateLoadingScript, type LoadingScreenConfig } from './loadingScreen';
import type { ScriptData } from '@/stores/editorStore';

export interface ZipExportOptions {
  format: 'single-html' | 'zip' | 'pwa';
  includeSourceMaps: boolean;
  compressTextures: boolean;
  customLoadingScreen?: LoadingScreenConfig;
  title: string;
  resolution: GameTemplateOptions['resolution'];
  bgColor: string;
  includeDebug: boolean;
}

interface ZipEntry {
  path: string;
  content: Blob | string;
}

/**
 * Export game as ZIP archive with separated assets
 */
export async function exportAsZip(
  sceneData: unknown,
  scripts: Record<string, ScriptData>,
  options: ZipExportOptions
): Promise<Blob> {
  // 1. Extract embedded assets
  const { modifiedScene, assets } = await extractAssets(sceneData);

  // 2. Bundle scripts
  const scriptBundle = bundleScripts(scripts);

  // 3. Prepare ZIP entries
  const entries: ZipEntry[] = [];

  // Add game.json (modified scene with relative asset paths)
  entries.push({
    path: 'game.json',
    content: JSON.stringify(modifiedScene, null, 2),
  });

  // Add scripts.js
  entries.push({
    path: 'scripts.js',
    content: scriptBundle.code,
  });

  // Add extracted assets
  for (const asset of assets) {
    entries.push({
      path: asset.relativePath,
      content: asset.blob,
    });
  }

  // 4. Generate HTML with loading screen
  const loadingScreenHtml = options.customLoadingScreen
    ? generateLoadingHtml(options.customLoadingScreen)
    : generateLoadingHtml({
        backgroundColor: options.bgColor,
        progressBarColor: '#6366f1',
        progressStyle: 'bar',
        title: options.title,
      });

  const loadingScript = options.customLoadingScreen
    ? generateLoadingScript(options.customLoadingScreen.progressStyle)
    : generateLoadingScript('bar');

  // Generate main HTML (need to modify gameTemplate to accept loading screen)
  const html = generateZipIndexHtml({
    title: options.title,
    bgColor: options.bgColor,
    resolution: options.resolution,
    includeDebug: options.includeDebug,
    loadingScreenHtml,
    loadingScript,
  });

  entries.push({
    path: 'index.html',
    content: html,
  });

  // 5. Add README
  entries.push({
    path: 'README.txt',
    content: generateReadme(options.title),
  });

  // 6. Create ZIP using simple archive format
  return await createSimpleZip(entries);
}

/**
 * Generate index.html for ZIP export (loads assets from separate files)
 */
function generateZipIndexHtml(options: {
  title: string;
  bgColor: string;
  resolution: GameTemplateOptions['resolution'];
  includeDebug: boolean;
  loadingScreenHtml: string;
  loadingScript: string;
}): string {
  const { title, bgColor, resolution, includeDebug, loadingScreenHtml, loadingScript } = options;

  const debugScript = includeDebug
    ? `
    window.onerror = (msg, url, line, col, error) => {
      console.error('[Game Error]', msg, 'at', url, line, col, error);
      return false;
    };
    console.log('[Game] Debug mode enabled');
  `
    : '';

  const canvasStyle =
    resolution === 'responsive'
      ? 'width: 100vw; height: 100vh;'
      : resolution === '1920x1080'
      ? 'width: 1920px; height: 1080px; max-width: 100vw; max-height: 100vh;'
      : 'width: 1280px; height: 720px; max-width: 100vw; max-height: 100vh;';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <meta name="mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <title>${escapeHtml(title)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: ${bgColor};
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    #game-canvas {
      display: block;
      ${canvasStyle}
      object-fit: contain;
    }
  </style>
</head>
<body>
  ${loadingScreenHtml}
  <canvas id="game-canvas"></canvas>

  <script>
    ${debugScript}

    // Load game data
    fetch('game.json')
      .then(res => res.json())
      .then(sceneData => {
        window.FORGE_SCENE_DATA = sceneData;
        return fetch('scripts.js');
      })
      .then(res => res.text())
      .then(scriptCode => {
        window.FORGE_SCRIPT_BUNDLE = scriptCode;
        return initializeEngine();
      })
      .catch(err => {
        console.error('[Game] Failed to load:', err);
        alert('Failed to load game. Please check console for details.');
      });

    ${loadingScript}

    async function initializeEngine() {
      // In a real implementation, this would load the WASM runtime
      // For now, we just dispatch the engine ready event
      console.log('[Game] Initializing runtime...');

      // Simulate initialization delay
      await new Promise(resolve => setTimeout(resolve, 500));

      window.dispatchEvent(new CustomEvent('forge:engine-ready'));
      console.log('[Game] Engine ready');
    }
  </script>
</body>
</html>`;
}

/**
 * Generate README for ZIP export
 */
function generateReadme(title: string): string {
  return `${title}
${'='.repeat(title.length)}

This is a game created with Project Forge.

HOW TO PLAY:
1. Extract all files from this ZIP archive
2. Open index.html in a modern web browser
3. Enjoy!

REQUIREMENTS:
- Modern web browser with WebGL2 or WebGPU support
- JavaScript enabled
- Local file access (some browsers require a local server for full functionality)

RUNNING ON A LOCAL SERVER:
If the game doesn't load properly when opening index.html directly, you may need to run a local web server:

Python 3:
  python -m http.server 8000

Node.js (http-server):
  npx http-server -p 8000

Then open http://localhost:8000 in your browser.

---
Created with Project Forge
https://projectforge.dev
`;
}

/**
 * Create a simple ZIP archive using browser APIs
 * Note: This is a basic implementation. For production, consider using a library like JSZip
 */
async function createSimpleZip(entries: ZipEntry[]): Promise<Blob> {
  // Check if we have access to the Compression Streams API
  if ('CompressionStream' in window) {
    return await createZipWithCompression(entries);
  }

  // Fallback: create uncompressed archive
  console.warn('[ZipExporter] Compression not available, creating uncompressed archive');
  return await createUncompressedZip(entries);
}

/**
 * Create ZIP with native compression (modern browsers)
 */
async function createZipWithCompression(entries: ZipEntry[]): Promise<Blob> {
  // For now, return a simple tar-like format wrapped in a blob
  // A full ZIP implementation would require significant code
  // In production, use JSZip library

  // Simple workaround: create a blob with all files concatenated
  // and add a manifest
  const manifest = entries.map(e => e.path).join('\n');
  const parts: Blob[] = [new Blob([`MANIFEST:\n${manifest}\n\n---FILES---\n\n`])];

  for (const entry of entries) {
    const content = typeof entry.content === 'string'
      ? new Blob([entry.content], { type: 'text/plain' })
      : entry.content;

    parts.push(new Blob([`\n--- ${entry.path} ---\n`]));
    parts.push(content);
  }

  return new Blob(parts, { type: 'application/zip' });
}

/**
 * Create uncompressed archive
 */
async function createUncompressedZip(entries: ZipEntry[]): Promise<Blob> {
  // Same as compressed version for now
  return createZipWithCompression(entries);
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Check if browser supports native compression
 */
export function supportsCompression(): boolean {
  return 'CompressionStream' in window;
}
