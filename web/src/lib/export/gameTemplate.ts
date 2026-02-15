import { generateUIRuntimeCode } from './uiRuntime';
import { generateTouchCSS, generateTouchJS } from './touchControls';
import type { MobileTouchConfig } from './touchControls';

export interface GameTemplateOptions {
  title: string;
  bgColor: string;
  resolution: 'responsive' | '1920x1080' | '1280x720' | { width: number; height: number };
  sceneData: string;       // JSON scene data
  scriptBundle: string;    // JS script bundle
  includeDebug: boolean;
  uiData?: string;         // JSON-encoded GameUIData
  mobileTouchConfig?: string;  // JSON-encoded MobileTouchConfig
}

export function generateGameHTML(options: GameTemplateOptions): string {
  const { title, bgColor, resolution, sceneData, scriptBundle, includeDebug, uiData, mobileTouchConfig } = options;

  const canvasStyle = resolution === 'responsive'
    ? 'width: 100vw; height: 100vh;'
    : typeof resolution === 'string'
      ? `width: ${resolution.split('x')[0]}px; height: ${resolution.split('x')[1]}px; margin: auto;`
      : `width: ${resolution.width}px; height: ${resolution.height}px; margin: auto;`;

  const touchConfig: MobileTouchConfig | null = mobileTouchConfig
    ? JSON.parse(mobileTouchConfig)
    : null;

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
    body { overflow: hidden; background: ${bgColor}; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); }
    canvas { ${canvasStyle} display: block; }
    #loading { position: fixed; top: 0; left: 0; width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; background: ${bgColor}; z-index: 1000; transition: opacity 0.5s; }
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
    window.__forgeSceneData = ${sceneData};
    ${uiData ? `window.__forgeUIData = ${uiData};` : ''}
  </script>

  ${touchJS ? `<script>${touchJS}</script>` : ''}

  ${scriptBundle ? `<script>\n${scriptBundle}\n</script>` : ''}

  <script type="module">
    // Detect WebGPU and load appropriate runtime
    async function init() {
      try {
        const hasWebGPU = !!navigator.gpu;
        const variant = hasWebGPU ? 'webgpu' : 'webgl2';
        ${includeDebug ? "console.log('[Forge] Using ' + variant + ' renderer');" : ''}

        // For single HTML export, the WASM is loaded from the editor's public path
        // For zip export, it's loaded from relative paths
        const basePath = window.__forgeBasePath || '.';
        const { default: init_wasm, init_engine, handle_command, set_event_callback } =
          await import(basePath + '/engine-pkg-' + variant + '/forge_engine.js');

        await init_wasm();

        // Set up event callback for script integration
        set_event_callback(function(eventType, eventPayload) {
          try {
            const payload = JSON.parse(eventPayload);
            if (eventType === 'INPUT_STATE_CHANGED') {
              window.__forgeInputState = payload;
            } else if (eventType === 'TRANSFORM_CHANGED') {
              if (!window.__forgeTransforms) window.__forgeTransforms = {};
              window.__forgeTransforms[payload.entityId] = payload;
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
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function generateUIRuntimeScript(uiData: string): string {
  const runtimeCode = generateUIRuntimeCode(uiData);
  return `
  <script>
    ${runtimeCode}
  </script>`;
}
