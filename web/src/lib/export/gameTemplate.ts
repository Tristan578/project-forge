import { generateUIRuntimeCode } from './uiRuntime';
import { generateTouchCSS, generateTouchJS } from './touchControls';
import type { MobileTouchConfig } from './touchControls';
import { escapeHtml, escapeScriptContent, validateCssColor } from './exportUtils';

export interface EmbeddedWasmData {
  jsBase64: string;     // JS glue code, base64-encoded
  wasmBase64: string;   // WASM binary, base64-encoded
}

export interface GameTemplateOptions {
  title: string;
  bgColor: string;
  resolution: 'responsive' | '1920x1080' | '1280x720' | { width: number; height: number };
  sceneData: string;       // JSON scene data
  scriptBundle: string;    // JS script bundle
  includeDebug: boolean;
  uiData?: string;         // JSON-encoded GameUIData
  mobileTouchConfig?: string;  // JSON-encoded MobileTouchConfig
  embeddedWasm?: Record<string, EmbeddedWasmData>;  // Inlined WASM for single-HTML portability
  orientationLock?: 'landscape' | 'portrait' | 'none';  // Screen orientation lock for mobile
  creatorTier?: string;    // User subscription tier — branding non-removable on starter/hobbyist
  hideBranding?: boolean;  // Only honored on creator/pro tiers
}

/** Tiers where "Made with SpawnForge" branding cannot be removed. */
const BRANDING_REQUIRED_TIERS = new Set(['starter', 'hobbyist']);

function shouldShowBranding(tier?: string, hide?: boolean): boolean {
  // Default (no tier specified) = show branding
  if (!tier) return true;
  // Free/hobbyist tiers: branding is non-removable
  if (BRANDING_REQUIRED_TIERS.has(tier)) return true;
  // Paid tiers: respect hideBranding flag
  return !hide;
}

function generateBrandingHTML(): string {
  return `
  <div id="forge-branding" style="position:fixed;bottom:12px;right:12px;z-index:9999;pointer-events:auto;">
    <a href="https://spawnforge.ai?utm_source=game_export&utm_medium=badge&utm_campaign=made_with" target="_blank" rel="noopener noreferrer" style="display:flex;align-items:center;gap:6px;padding:6px 12px;background:rgba(0,0,0,0.7);border-radius:8px;text-decoration:none;font-family:system-ui,sans-serif;font-size:12px;color:rgba(255,255,255,0.7);backdrop-filter:blur(4px);transition:opacity 0.2s;" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.8'">
      <span style="font-size:14px;">⚒</span>
      <span>Made with <strong style="color:#f97316;">SpawnForge</strong></span>
    </a>
  </div>`;
}

export function generateGameHTML(options: GameTemplateOptions): string {
  const { title, bgColor, resolution, sceneData, scriptBundle, includeDebug, uiData, mobileTouchConfig, embeddedWasm, orientationLock, creatorTier, hideBranding } = options;

  const canvasStyle = resolution === 'responsive'
    ? 'width: 100vw; height: 100vh;'
    : typeof resolution === 'string'
      ? `width: ${resolution.split('x')[0]}px; height: ${resolution.split('x')[1]}px; margin: auto;`
      : `width: ${resolution.width}px; height: ${resolution.height}px; margin: auto;`;

  let touchConfig: MobileTouchConfig | null = null;
  if (mobileTouchConfig) {
    try {
      touchConfig = JSON.parse(mobileTouchConfig) as MobileTouchConfig;
    } catch {
      touchConfig = null;
    }
  }

  const touchCSS = touchConfig?.enabled ? generateTouchCSS() : '';
  const touchJS = touchConfig?.enabled ? generateTouchJS(touchConfig) : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  <title>${escapeHtml(title)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { overflow: hidden; background: ${validateCssColor(bgColor)}; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); }
    canvas { ${canvasStyle} display: block; }
    #loading { position: fixed; top: 0; left: 0; width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; background: ${validateCssColor(bgColor)}; z-index: 1000; transition: opacity 0.5s; }
    #loading.hidden { opacity: 0; pointer-events: none; }
    .spinner { width: 40px; height: 40px; border: 3px solid rgba(255,255,255,0.2); border-top-color: #fff; border-radius: 50%; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    #loading p { color: rgba(255,255,255,0.6); font-family: system-ui; font-size: 14px; margin-top: 16px; }
    ${touchCSS}
  </style>
</head>
<body>
  <div id="loading">
    <div class="spinner"></div>
    <p>Loading ${escapeHtml(title)}...</p>
  </div>
  <canvas id="game-canvas"></canvas>
  <div id="forge-ui-root"></div>
  <div id="forge-touch-overlay"></div>

  <script>
    // Scene data
    window.__forgeSceneData = ${escapeScriptContent(sceneData)};
    ${uiData ? `window.__forgeUIData = ${escapeScriptContent(uiData)};` : ''}
  </script>

  ${touchJS ? `<script>${touchJS}</script>` : ''}

  ${scriptBundle ? `<script>\n${escapeScriptContent(scriptBundle)}\n</script>` : ''}

  ${embeddedWasm ? generateEmbeddedWasmScripts(embeddedWasm) : ''}

  <script type="module">
    // Detect WebGPU and load appropriate runtime
    async function init() {
      try {
        const hasWebGPU = !!navigator.gpu;
        const variant = hasWebGPU ? 'webgpu' : 'webgl2';
        ${includeDebug ? "console.log('[Forge] Using ' + variant + ' renderer');" : ''}

        ${embeddedWasm ? generateEmbeddedWasmLoader(includeDebug) : generateExternalWasmLoader()}

        // Initialize WASM — pass binary directly when embedded, otherwise auto-fetches
        await init_wasm(${embeddedWasm ? 'wasmBytes.buffer' : ''});

        // Set up event callback for script integration
        set_event_callback(function(eventType, eventPayload) {
          try {
            const payload = JSON.parse(eventPayload);
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

        // Initialize engine
        init_engine('game-canvas');

        // Auto-reduce quality on mobile
        var _isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
        if (_isMobile && ${touchConfig?.autoReduceQuality ? 'true' : 'false'}) {
          handle_command('set_quality', JSON.stringify({ preset: 'low' }));
        }

        // Orientation lock
        ${orientationLock && ['landscape', 'portrait'].includes(orientationLock)
          ? `if (screen.orientation && screen.orientation.lock) { screen.orientation.lock('${orientationLock}').catch(function() {}); }`
          : '// No orientation lock requested'
        }

        // Load scene
        handle_command('load_scene', JSON.stringify(window.__forgeSceneData));

        // Auto-play
        setTimeout(function() {
          handle_command('play', '{}');
          if (window.__forgeScriptStart) window.__forgeScriptStart();

          // Script update loop
          let lastTime = performance.now();
          function gameLoop() {
            const now = performance.now();
            const dt = (now - lastTime) / 1000;
            lastTime = now;

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

            // Flush script commands to engine
            if (window.__forgeFlushCommands) {
              const cmds = window.__forgeFlushCommands();
              for (const cmd of cmds) {
                handle_command(cmd.cmd, JSON.stringify(cmd));
              }
            }

            requestAnimationFrame(gameLoop);
          }
          requestAnimationFrame(gameLoop);

          // Hide loading screen
          document.getElementById('loading').classList.add('hidden');
        }, 500);

      } catch (err) {
        console.error('[Forge] Failed to initialize:', err);
        document.querySelector('#loading p').textContent = 'Failed to load game. ' + err.message;
      }
    }

    // Handle autoplay policy - require user interaction
    document.addEventListener('click', function startGame() {
      document.removeEventListener('click', startGame);
      init();
    }, { once: true });

    document.querySelector('#loading p').textContent = 'Click to start ${escapeHtml(title)}';
  </script>

  ${uiData ? generateUIRuntimeScript(uiData) : ''}

  ${shouldShowBranding(creatorTier, hideBranding) ? generateBrandingHTML() : ''}
</body>
</html>`;
}

function generateUIRuntimeScript(uiData: string): string {
  const runtimeCode = generateUIRuntimeCode(uiData);
  return `
  <script>
    ${escapeScriptContent(runtimeCode)}
  </script>`;
}

/**
 * Generate hidden script tags containing base64-encoded WASM data for each variant.
 */
function generateEmbeddedWasmScripts(wasm: Record<string, EmbeddedWasmData>): string {
  const tags: string[] = [];
  for (const [variant, data] of Object.entries(wasm)) {
    tags.push(`  <script id="forge-wasm-${variant}-js" type="text/plain">${data.jsBase64}</script>`);
    tags.push(`  <script id="forge-wasm-${variant}-wasm" type="text/plain">${data.wasmBase64}</script>`);
  }
  return tags.join('\n');
}

/**
 * Generate JS that loads WASM from embedded base64 data via Blob URLs.
 */
function generateEmbeddedWasmLoader(includeDebug: boolean): string {
  return `// Load WASM from embedded base64 data (single-HTML portable)
        var jsEl = document.getElementById('forge-wasm-' + variant + '-js');
        var wasmEl = document.getElementById('forge-wasm-' + variant + '-wasm');
        if (!jsEl && variant === 'webgpu') {
          // Fall back to webgl2 if webgpu data not embedded
          jsEl = document.getElementById('forge-wasm-webgl2-js');
          wasmEl = document.getElementById('forge-wasm-webgl2-wasm');
        }
        if (!jsEl || !wasmEl) throw new Error('No embedded WASM data found');
        ${includeDebug ? "console.log('[Forge] Loading embedded WASM for ' + variant);" : ''}

        // Decode JS glue from base64 and create importable Blob URL
        var jsCode = atob(jsEl.textContent);
        var jsBlob = new Blob([jsCode], { type: 'text/javascript' });
        var jsBlobUrl = URL.createObjectURL(jsBlob);

        // Decode WASM binary from base64
        var wasmB64 = wasmEl.textContent;
        var wasmRaw = atob(wasmB64);
        var wasmBytes = new Uint8Array(wasmRaw.length);
        for (var i = 0; i < wasmRaw.length; i++) wasmBytes[i] = wasmRaw.charCodeAt(i);

        // Dynamic import of the JS glue module from Blob URL
        var wasm_module = await import(jsBlobUrl);
        URL.revokeObjectURL(jsBlobUrl);
        const { default: init_wasm, init_engine, handle_command, set_event_callback } = wasm_module;`;
}

/**
 * Generate JS that loads WASM from external file paths (original behavior).
 */
function generateExternalWasmLoader(): string {
  return `// Load WASM from external files (requires files alongside this HTML)
        const basePath = window.__forgeBasePath || '.';
        let wasm_module;
        try {
          wasm_module = await import(basePath + '/engine-pkg-' + variant + '-runtime/forge_engine.js');
        } catch {
          wasm_module = await import(basePath + '/engine-pkg-' + variant + '/forge_engine.js');
        }
        const { default: init_wasm, init_engine, handle_command, set_event_callback } = wasm_module;`;
}
