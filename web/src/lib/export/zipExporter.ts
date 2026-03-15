/**
 * ZIP Export Engine
 * Generates ZIP archives containing game assets with real WASM runtime
 * Uses a proper ZIP format implementation (no external dependencies)
 */

import { extractAssets } from './assetExtractor';
import type { GameTemplateOptions } from './gameTemplate';
import { bundleScripts } from './scriptBundler';
import { generateLoadingHtml, generateLoadingScript, type LoadingScreenConfig } from './loadingScreen';
import { generatePostMessageBridge } from './embedGenerator';
import type { ExportFormat } from './presets';
import type { ScriptData } from '@/stores/editorStore';

export interface ZipExportOptions {
  format: ExportFormat;
  includeSourceMaps: boolean;
  compressTextures: boolean;
  customLoadingScreen?: LoadingScreenConfig;
  title: string;
  resolution: GameTemplateOptions['resolution'];
  bgColor: string;
  includeDebug: boolean;
  orientationLock?: 'landscape' | 'portrait' | 'none';
}

interface ZipEntry {
  path: string;
  content: Blob | string;
}

/**
 * Fetch WASM engine files from the running server's public directory.
 * Uses runtime variants (stripped editor systems) for smaller exported games.
 * Falls back to editor variants if runtime variants aren't available.
 */
async function fetchWasmEngineFiles(): Promise<ZipEntry[]> {
  const entries: ZipEntry[] = [];
  const variants = ['webgl2', 'webgpu'];
  const files = ['forge_engine.js', 'forge_engine_bg.wasm'];

  for (const variant of variants) {
    for (const file of files) {
      // Try runtime variant first (smaller, no editor systems)
      const runtimeUrl = `/engine-pkg-${variant}-runtime/${file}`;
      const editorUrl = `/engine-pkg-${variant}/${file}`;
      // Exported games load from engine-pkg-{variant}/ paths (no -runtime suffix)
      const exportPath = `engine-pkg-${variant}/${file}`;

      try {
        let response = await fetch(runtimeUrl);
        if (!response.ok) {
          // Fall back to editor variant
          response = await fetch(editorUrl);
        }
        if (response.ok) {
          const blob = await response.blob();
          entries.push({
            path: exportPath,
            content: blob,
          });
        }
      } catch {
        console.warn(`[ZipExporter] Could not fetch WASM for ${variant}/${file}, skipping`);
      }
    }
  }

  return entries;
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

  // 4. Fetch and include WASM engine files
  const wasmEntries = await fetchWasmEngineFiles();
  for (const entry of wasmEntries) {
    entries.push(entry);
  }

  // 5. Generate HTML with loading screen
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

  // Determine which WASM variants are available
  const hasWebGPU = wasmEntries.some(e => e.path.includes('engine-pkg-webgpu'));
  const hasWebGL2 = wasmEntries.some(e => e.path.includes('engine-pkg-webgl2'));

  // Generate main HTML with real WASM loading
  const isEmbed = options.format === 'embed';
  const html = generateZipIndexHtml({
    title: options.title,
    bgColor: options.bgColor,
    resolution: options.resolution,
    includeDebug: options.includeDebug,
    loadingScreenHtml,
    loadingScript,
    hasWebGPU,
    hasWebGL2,
    embedBridge: isEmbed ? generatePostMessageBridge() : undefined,
    orientationLock: options.orientationLock,
  });

  entries.push({
    path: 'index.html',
    content: html,
  });

  // 6. Add format-specific files
  if (isEmbed) {
    entries.push({
      path: 'README.txt',
      content: generateEmbedReadme(options.title),
    });
  } else {
    entries.push({
      path: 'README.txt',
      content: generateReadme(options.title),
    });
  }

  // Add .itch.toml for itch.io compatibility (always include for ZIP/PWA/embed)
  if (options.format !== 'single-html') {
    entries.push({
      path: '.itch.toml',
      content: generateItchToml(options.title),
    });
  }

  // 7. Create ZIP
  return await createZip(entries);
}

/**
 * Generate index.html for ZIP export (loads WASM engine and assets from separate files)
 */
function generateZipIndexHtml(options: {
  title: string;
  bgColor: string;
  resolution: GameTemplateOptions['resolution'];
  includeDebug: boolean;
  loadingScreenHtml: string;
  loadingScript: string;
  hasWebGPU: boolean;
  hasWebGL2: boolean;
  embedBridge?: string;
  orientationLock?: 'landscape' | 'portrait' | 'none';
}): string {
  const { title, bgColor, resolution, includeDebug, loadingScreenHtml, loadingScript, hasWebGPU, hasWebGL2, embedBridge, orientationLock } = options;

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

  // Build the WASM variant detection logic
  const wasmAvailability = hasWebGPU && hasWebGL2
    ? `var hasWebGPU = !!navigator.gpu;
        var variant = hasWebGPU ? 'webgpu' : 'webgl2';`
    : hasWebGPU
    ? `var variant = 'webgpu';`
    : hasWebGL2
    ? `var variant = 'webgl2';`
    : `throw new Error('No WASM engine files found in export');`;

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
  <div id="forge-ui-root"></div>
  <div id="forge-touch-overlay"></div>

  <script>
    ${debugScript}
    ${loadingScript}
    ${embedBridge || ''}
  </script>

  <script type="module">
    // Load game data and scripts
    var sceneData;
    try {
      var sceneRes = await fetch('game.json');
      sceneData = await sceneRes.json();
    } catch (err) {
      console.error('[Game] Failed to load game.json:', err);
      alert('Failed to load game data. Make sure you are serving from a local HTTP server (WASM requires HTTP).');
      throw err;
    }
    window.__forgeSceneData = sceneData;

    // Load and execute script bundle
    try {
      var scriptRes = await fetch('scripts.js');
      var scriptCode = await scriptRes.text();
      if (scriptCode && scriptCode.trim().length > 0) {
        var scriptEl = document.createElement('script');
        scriptEl.textContent = scriptCode;
        document.body.appendChild(scriptEl);
      }
    } catch (err) {
      console.warn('[Game] Could not load scripts.js:', err);
    }

    // Initialize WASM engine
    async function initializeEngine() {
      ${includeDebug ? "console.log('[Game] Detecting rendering backend...');" : ''}
      ${wasmAvailability}
      ${includeDebug ? "console.log('[Game] Using ' + variant + ' renderer');" : ''}

      var basePath = './engine-pkg-' + variant;
      var jsUrl = basePath + '/forge_engine.js';

      ${includeDebug ? "console.log('[Game] Loading WASM from ' + jsUrl);" : ''}

      var wasm = await import(jsUrl);
      await wasm.default(basePath + '/forge_engine_bg.wasm');

      // Set up event callback for script integration
      if (wasm.set_event_callback) {
        wasm.set_event_callback(function(eventType, eventPayload) {
          try {
            var payload = JSON.parse(eventPayload);
            if (eventType === 'INPUT_STATE_CHANGED') {
              window.__forgeInputState = payload;
            } else if (eventType === 'TRANSFORM_CHANGED') {
              if (!window.__forgeTransforms) window.__forgeTransforms = {};
              window.__forgeTransforms[payload.entityId] = payload;
            } else if (eventType === 'AUDIO_PLAYBACK') {
              if (!window.__forgeAudioState) window.__forgeAudioState = {};
              window.__forgeAudioState[payload.entityId] = (payload.action === 'play' || payload.action === 'resume');
            }
          } catch(e) {}
        });
      }

      // Initialize engine with canvas
      wasm.init_engine('game-canvas');

      // Orientation lock
      ${orientationLock && orientationLock !== 'none'
        ? `if (screen.orientation && screen.orientation.lock) { screen.orientation.lock('${orientationLock}').catch(function() {}); }`
        : '// No orientation lock requested'
      }

      // Load scene data
      wasm.handle_command('load_scene', JSON.stringify(window.__forgeSceneData));

      // Auto-play after short delay to let the engine settle
      await new Promise(function(r) { setTimeout(r, 500); });
      wasm.handle_command('play', '{}');

      // Run script onStart hooks
      if (window.__forgeScriptStart) window.__forgeScriptStart();

      // Main game loop
      var lastTime = performance.now();
      function gameLoop() {
        var now = performance.now();
        var dt = (now - lastTime) / 1000;
        lastTime = now;

        // Run script onUpdate hooks
        if (window.__forgeScriptUpdate) window.__forgeScriptUpdate(dt);

        // Merge touch input
        if (window.__forgeTouchInput) {
          if (!window.__forgeInputState) window.__forgeInputState = { pressed: {}, justPressed: {}, justReleased: {}, axes: {} };
          var ti = window.__forgeTouchInput;
          for (var k in ti.pressed) { if (ti.pressed[k]) window.__forgeInputState.pressed[k] = true; }
          for (var k2 in ti.justPressed) { if (ti.justPressed[k2]) window.__forgeInputState.justPressed[k2] = true; }
          for (var k3 in ti.justReleased) { if (ti.justReleased[k3]) window.__forgeInputState.justReleased[k3] = true; }
          for (var k4 in ti.axes) { window.__forgeInputState.axes[k4] = ti.axes[k4]; }
          if (window.__forgeTouchFlush) window.__forgeTouchFlush();
        }

        // Flush script commands to WASM engine
        if (window.__forgeFlushCommands) {
          var cmds = window.__forgeFlushCommands();
          for (var i = 0; i < cmds.length; i++) {
            wasm.handle_command(cmds[i].cmd, JSON.stringify(cmds[i]));
          }
        }

        requestAnimationFrame(gameLoop);
      }
      requestAnimationFrame(gameLoop);

      // Signal engine ready (for loading screen)
      window.dispatchEvent(new CustomEvent('forge:engine-ready'));
      ${includeDebug ? "console.log('[Game] Engine ready');" : ''}

      // Hide default loading overlay
      var loadingEl = document.getElementById('loading-screen');
      if (loadingEl) {
        loadingEl.style.opacity = '0';
        setTimeout(function() { loadingEl.remove(); }, 500);
      }
    }

    // Start with click-to-play (required for audio autoplay policy)
    var loadingText = document.querySelector('.progress-text');
    if (loadingText) {
      loadingText.textContent = 'Click to start ${escapeHtml(title)}';
    }
    document.addEventListener('click', function startGame() {
      document.removeEventListener('click', startGame);
      if (loadingText) loadingText.textContent = 'Loading...';
      initializeEngine().catch(function(err) {
        console.error('[Game] Failed to initialize:', err);
        if (loadingText) loadingText.textContent = 'Failed to load game. ' + err.message;
      });
    }, { once: true });
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

This is a game created with SpawnForge.

HOW TO PLAY:
1. Extract all files from this ZIP archive
2. Start a local web server in the extracted directory (WASM requires HTTP)
3. Open your browser to the local server address
4. Click to start the game

IMPORTANT - WASM REQUIRES A LOCAL SERVER:
Browsers cannot load WASM files from file:// URLs. You must run a local server:

Python 3:
  python -m http.server 8000

Node.js (http-server):
  npx http-server -p 8000

Then open http://localhost:8000 in your browser.

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
Created with SpawnForge
https://spawnforge.ai
`;
}

/**
 * Create a valid ZIP archive using browser APIs.
 * Implements the ZIP format (PKZIP APPNOTE spec) without external dependencies.
 * Files are stored uncompressed (method 0) for maximum compatibility.
 */
async function createZip(entries: ZipEntry[]): Promise<Blob> {
  const encoder = new TextEncoder();
  const fileRecords: Uint8Array[] = [];
  const centralDirectory: Uint8Array[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    // Convert content to Uint8Array
    const contentBytes = typeof entry.content === 'string'
      ? encoder.encode(entry.content)
      : new Uint8Array(await entry.content.arrayBuffer());

    const filenameBytes = encoder.encode(entry.path);
    const crc = crc32(contentBytes);
    const size = contentBytes.length;

    // -- Local File Header --
    const localHeader = new Uint8Array(30 + filenameBytes.length);
    const lhView = new DataView(localHeader.buffer);

    lhView.setUint32(0, 0x04034b50, true);   // Local file header signature
    lhView.setUint16(4, 20, true);            // Version needed to extract (2.0)
    lhView.setUint16(6, 0, true);             // General purpose bit flag
    lhView.setUint16(8, 0, true);             // Compression method (0 = stored)
    lhView.setUint16(10, 0, true);            // Last mod time
    lhView.setUint16(12, 0, true);            // Last mod date
    lhView.setUint32(14, crc, true);          // CRC-32
    lhView.setUint32(18, size, true);         // Compressed size
    lhView.setUint32(22, size, true);         // Uncompressed size
    lhView.setUint16(26, filenameBytes.length, true); // Filename length
    lhView.setUint16(28, 0, true);            // Extra field length

    localHeader.set(filenameBytes, 30);

    fileRecords.push(localHeader);
    fileRecords.push(contentBytes);

    // -- Central Directory Entry --
    const centralEntry = new Uint8Array(46 + filenameBytes.length);
    const cdView = new DataView(centralEntry.buffer);

    cdView.setUint32(0, 0x02014b50, true);    // Central directory signature
    cdView.setUint16(4, 20, true);             // Version made by
    cdView.setUint16(6, 20, true);             // Version needed to extract
    cdView.setUint16(8, 0, true);              // General purpose bit flag
    cdView.setUint16(10, 0, true);             // Compression method (stored)
    cdView.setUint16(12, 0, true);             // Last mod time
    cdView.setUint16(14, 0, true);             // Last mod date
    cdView.setUint32(16, crc, true);           // CRC-32
    cdView.setUint32(20, size, true);          // Compressed size
    cdView.setUint32(24, size, true);          // Uncompressed size
    cdView.setUint16(28, filenameBytes.length, true); // Filename length
    cdView.setUint16(30, 0, true);             // Extra field length
    cdView.setUint16(32, 0, true);             // File comment length
    cdView.setUint16(34, 0, true);             // Disk number start
    cdView.setUint16(36, 0, true);             // Internal file attributes
    cdView.setUint32(38, 0, true);             // External file attributes
    cdView.setUint32(42, localOffset, true);   // Offset of local file header

    centralEntry.set(filenameBytes, 46);
    centralDirectory.push(centralEntry);

    localOffset += localHeader.length + contentBytes.length;
  }

  // -- End of Central Directory Record --
  const cdOffset = localOffset;
  let cdSize = 0;
  for (const cd of centralDirectory) {
    cdSize += cd.length;
  }

  const endRecord = new Uint8Array(22);
  const erView = new DataView(endRecord.buffer);

  erView.setUint32(0, 0x06054b50, true);       // End of central directory signature
  erView.setUint16(4, 0, true);                 // Disk number
  erView.setUint16(6, 0, true);                 // Disk with central directory
  erView.setUint16(8, entries.length, true);     // Entries on this disk
  erView.setUint16(10, entries.length, true);    // Total entries
  erView.setUint32(12, cdSize, true);            // Size of central directory
  erView.setUint32(16, cdOffset, true);          // Offset of central directory
  erView.setUint16(20, 0, true);                 // Comment length

  // Combine all parts into a single ArrayBuffer
  let totalSize = 0;
  for (const r of fileRecords) totalSize += r.length;
  for (const cd of centralDirectory) totalSize += cd.length;
  totalSize += endRecord.length;

  const result = new Uint8Array(totalSize);
  let offset = 0;
  for (const r of fileRecords) {
    result.set(r, offset);
    offset += r.length;
  }
  for (const cd of centralDirectory) {
    result.set(cd, offset);
    offset += cd.length;
  }
  result.set(endRecord, offset);

  return new Blob([result.buffer], { type: 'application/zip' });
}

/**
 * CRC-32 implementation for ZIP file validation.
 * Uses the standard CRC-32 polynomial (0xEDB88320).
 */
function crc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF;

  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      if (crc & 1) {
        crc = (crc >>> 1) ^ 0xEDB88320;
      } else {
        crc = crc >>> 1;
      }
    }
  }

  return (crc ^ 0xFFFFFFFF) >>> 0;
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
 * Generate .itch.toml manifest for itch.io uploads.
 * Tells the itch.io butler/app which file to launch.
 */
function generateItchToml(title: string): string {
  return `# itch.io manifest — ${title}
# See https://itch.io/docs/itch/integrating/manifest.html

[[actions]]
name = "Play"
path = "index.html"
`;
}

/**
 * Generate README for embed exports.
 */
function generateEmbedReadme(title: string): string {
  return `${title} — Embeddable Game
${'='.repeat(title.length + 20)}

This game was exported for iframe embedding from SpawnForge.

EMBEDDING:
Use the following HTML to embed this game on your website:

  <iframe
    src="index.html"
    title="${title}"
    width="960"
    height="540"
    frameborder="0"
    allowfullscreen
    allow="autoplay; gamepad; fullscreen"
    sandbox="allow-scripts allow-same-origin allow-popups"
    style="border: none;"
  ></iframe>

Or use a responsive container:

  <div style="position: relative; width: 100%; aspect-ratio: 16/9;">
    <iframe
      src="index.html"
      title="${title}"
      style="position: absolute; inset: 0; width: 100%; height: 100%; border: none;"
      allowfullscreen
      allow="autoplay; gamepad; fullscreen"
      sandbox="allow-scripts allow-same-origin allow-popups"
    ></iframe>
  </div>

PARENT PAGE COMMUNICATION:
The embedded game sends postMessage events to the parent window:

  window.addEventListener('message', function(event) {
    if (event.data.source !== 'forge-game') return;
    console.log(event.data.type, event.data.data);
    // Types: 'loading', 'ready', 'resize', 'error'
  });

HOSTING:
Upload these files to any web server. WASM requires HTTP (not file://).

---
Created with SpawnForge
https://spawnforge.ai
`;
}

/**
 * Check if browser supports native compression
 */
export function supportsCompression(): boolean {
  return typeof window !== 'undefined' && 'CompressionStream' in window;
}
