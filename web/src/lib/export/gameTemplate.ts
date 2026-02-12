export interface GameTemplateOptions {
  title: string;
  bgColor: string;
  resolution: 'responsive' | '1920x1080' | '1280x720' | { width: number; height: number };
  sceneData: string;       // JSON scene data
  scriptBundle: string;    // JS script bundle
  includeDebug: boolean;
}

export function generateGameHTML(options: GameTemplateOptions): string {
  const { title, bgColor, resolution, sceneData, scriptBundle, includeDebug } = options;

  const canvasStyle = resolution === 'responsive'
    ? 'width: 100vw; height: 100vh;'
    : typeof resolution === 'string'
      ? `width: ${resolution.split('x')[0]}px; height: ${resolution.split('x')[1]}px; margin: auto;`
      : `width: ${resolution.width}px; height: ${resolution.height}px; margin: auto;`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { overflow: hidden; background: ${bgColor}; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    canvas { ${canvasStyle} display: block; }
    #loading { position: fixed; top: 0; left: 0; width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; background: ${bgColor}; z-index: 1000; transition: opacity 0.5s; }
    #loading.hidden { opacity: 0; pointer-events: none; }
    .spinner { width: 40px; height: 40px; border: 3px solid rgba(255,255,255,0.2); border-top-color: #fff; border-radius: 50%; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    #loading p { color: rgba(255,255,255,0.6); font-family: system-ui; font-size: 14px; margin-top: 16px; }
  </style>
</head>
<body>
  <div id="loading">
    <div class="spinner"></div>
    <p>Loading ${escapeHtml(title)}...</p>
  </div>
  <canvas id="game-canvas"></canvas>

  <script>
    // Scene data
    window.__forgeSceneData = ${sceneData};
  </script>

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
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
