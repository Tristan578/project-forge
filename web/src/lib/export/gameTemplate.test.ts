// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { generateGameHTML, type GameTemplateOptions } from './gameTemplate';
import { getDefaultTouchPreset } from './touchControls';

describe('gameTemplate', () => {
  describe('generateGameHTML', () => {
    const baseOptions: GameTemplateOptions = {
      title: 'Test Game',
      bgColor: '#000000',
      resolution: 'responsive',
      sceneData: '{"entities":[]}',
      scriptBundle: '',
      includeDebug: false,
    };

    it('returns valid HTML with doctype', () => {
      const html = generateGameHTML(baseOptions);
      expect(html).toMatch(/^<!DOCTYPE html>/);
      expect(html).toContain('<html lang="en">');
      expect(html).toContain('</html>');
    });

    it('includes canvas element with ID', () => {
      const html = generateGameHTML(baseOptions);
      expect(html).toContain('<canvas id="game-canvas"></canvas>');
    });

    it('embeds scene data in window global', () => {
      const sceneData = '{"name":"TestScene","entities":[{"id":"e1"}]}';
      const html = generateGameHTML({
        ...baseOptions,
        sceneData,
      });
      expect(html).toContain('window.__forgeSceneData = {"name":"TestScene","entities":[{"id":"e1"}]}');
    });

    it('includes bundled scripts when provided', () => {
      const scriptBundle = 'console.log("test script");';
      const html = generateGameHTML({
        ...baseOptions,
        scriptBundle,
      });
      expect(html).toContain('<script>');
      expect(html).toContain('console.log("test script");');
      expect(html).toContain('</script>');
    });

    it('omits script tag when bundle is empty', () => {
      const html = generateGameHTML({
        ...baseOptions,
        scriptBundle: '',
      });
      // Classic scripts: the scene data and the (dormant) perf-harness
      // bootstrap. No third tag for an empty script bundle.
      const classic = html.split('<script>').slice(1);
      expect(classic).toHaveLength(2);
      expect(classic[0]).toContain('window.__forgeSceneData');
      expect(classic[1]).toContain('window.__forgePerfConfig');
    });

    it('applies responsive mode styling', () => {
      const html = generateGameHTML({
        ...baseOptions,
        resolution: 'responsive',
      });
      expect(html).toContain('width: 100vw; height: 100vh;');
    });

    it('applies fixed 1920x1080 mode sizing', () => {
      const html = generateGameHTML({
        ...baseOptions,
        resolution: '1920x1080',
      });
      expect(html).toContain('width: 1920px; height: 1080px; margin: auto;');
    });

    it('applies fixed 1280x720 mode sizing', () => {
      const html = generateGameHTML({
        ...baseOptions,
        resolution: '1280x720',
      });
      expect(html).toContain('width: 1280px; height: 720px; margin: auto;');
    });

    it('applies custom resolution object sizing', () => {
      const html = generateGameHTML({
        ...baseOptions,
        resolution: { width: 800, height: 600 },
      });
      expect(html).toContain('width: 800px; height: 600px; margin: auto;');
    });

    it('HTML-escapes title in head', () => {
      const html = generateGameHTML({
        ...baseOptions,
        title: '<script>alert("xss")</script>',
      });
      expect(html).toContain('<title>&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;</title>');
      expect(html).not.toContain('<title><script>');
    });

    it('HTML-escapes title in loading screen', () => {
      const html = generateGameHTML({
        ...baseOptions,
        title: 'Game & "More"',
      });
      expect(html).toContain('Loading Game &amp; &quot;More&quot;...');
      expect(html).toContain('Click to start Game &amp; &quot;More&quot;');
    });

    it('includes loading screen with spinner', () => {
      const html = generateGameHTML(baseOptions);
      expect(html).toContain('<div id="loading">');
      expect(html).toContain('<div class="spinner"></div>');
      expect(html).toContain('Loading Test Game...');
    });

    it('includes WASM loader code with WebGPU detection', () => {
      const html = generateGameHTML(baseOptions);
      expect(html).toContain('const hasWebGPU = !!navigator.gpu');
      expect(html).toContain("let variant = hasWebGPU ? 'webgpu' : 'webgl2'");
      expect(html).toContain("await import(basePath + '/engine-pkg-' + variant + '/forge_engine.js')");
    });

    it('loads the scene with a { json } payload once the engine accepts commands (#10013)', () => {
      const html = generateGameHTML(baseOptions);
      // The shared helper is defined in the module script and awaited after
      // init_engine. The old bare-string call was refused by the engine
      // ("Missing 'json' field") and fired before its command queue existed.
      expect(html).toContain('async function __forgeLoadScene(send, sceneData)');
      expect(html).toContain('const sceneLoad = await __forgeLoadScene(handle_command, window.__forgeSceneData);');
      expect(html).not.toContain("handle_command('load_scene', JSON.stringify(");
      expect(html.indexOf("init_engine('game-canvas')")).toBeLessThan(html.indexOf('await __forgeLoadScene('));
      // Play is still issued after the load, on the settle timer.
      expect(html.indexOf('await __forgeLoadScene(')).toBeLessThan(html.indexOf("handle_command('play', '{}')"));
    });

    it('sends set_quality as an object payload after the scene has loaded', () => {
      const html = generateGameHTML({
        ...baseOptions,
        mobileTouchConfig: JSON.stringify({ ...getDefaultTouchPreset('platformer'), enabled: true, autoReduceQuality: true }),
      });
      expect(html).toContain("handle_command('set_quality', { preset: 'low' });");
      expect(html).not.toContain("handle_command('set_quality', JSON.stringify(");
      expect(html.indexOf('await __forgeLoadScene(')).toBeLessThan(html.indexOf("handle_command('set_quality'"));
    });

    it('wires every perf-harness hook, each guarded so a normal game is unaffected (#10013)', () => {
      const html = generateGameHTML(baseOptions);
      for (const hook of ['initStart()', 'backend(variant)', 'wasm(wasmExports)', 'sceneLoad(sceneLoad)', 'fail(err)', 'frame(now)']) {
        expect(html).toContain(`if (window.__forgePerfHooks) window.__forgePerfHooks.${hook}`);
      }
      // The bootstrap runs before the module script that calls the hooks.
      expect(html.indexOf('window.__forgePerfHooks = {')).toBeLessThan(html.indexOf('<script type="module">'));
      // initStart is the first statement of init — the player's click.
      expect(html).toMatch(/async function init\(\) \{\s+if \(window\.__forgePerfHooks\) window\.__forgePerfHooks\.initStart\(\);/);
    });

    it('switches a 2D game to the engine 2D camera once its scene has loaded (#10013)', () => {
      const html = generateGameHTML({ ...baseOptions, projectType: '2d' });
      const call = "handle_command('set_project_type', { projectType: '2d' });";
      expect(html).toContain(call);
      expect(html.indexOf('await __forgeLoadScene(')).toBeLessThan(html.indexOf(call));
      expect(generateGameHTML({ ...baseOptions, projectType: '3d' })).not.toContain("'set_project_type'");
      expect(generateGameHTML(baseOptions)).not.toContain("'set_project_type'");
    });

    it('reports webgl2 as the backend when the embedded WebGPU binary is missing', () => {
      const html = generateGameHTML({
        ...baseOptions,
        embeddedWasm: { webgl2: { jsBase64: 'anM=', wasmBase64: 'AGFzbQ==' } },
      });
      expect(html).toMatch(/if \(!jsEl && variant === 'webgpu'\) \{[\s\S]*?variant = 'webgl2';/);
    });

    it('includes auto-play logic', () => {
      const html = generateGameHTML(baseOptions);
      expect(html).toContain("handle_command('play', '{}')");
      expect(html).toContain('if (window.__forgeScriptStart) window.__forgeScriptStart()');
    });

    // The loop's internal structure + ordering invariant are pinned once in
    // gameLoopFragment.test.ts. Here we only assert the single-HTML path
    // CONSUMES the shared fragment and wires it to the GLOBAL handle_command
    // sink (not wasm.handle_command, which is the ZIP build's).
    it('consumes the shared game loop wired to the global handle_command sink', () => {
      const html = generateGameHTML(baseOptions);
      expect(html).toContain('function gameLoop()');
      expect(html).toContain('if (window.__forgeScriptUpdate) window.__forgeScriptUpdate(dt)');
      expect(html).toContain('requestAnimationFrame(gameLoop)');
      expect(html).toContain('var cmds = window.__forgeFlushCommands()');
      expect(html).toContain('handle_command(cmdName, cmdPayload)');
      expect(html).not.toContain('wasm.handle_command(cmdName');
    });

    it('includes event callback setup', () => {
      const html = generateGameHTML(baseOptions);
      // The engine invokes the callback with ONE argument — a live
      // { type, payload } object (serde-wasm-bindgen) — never two args and never
      // a JSON string. The old 2-arg signature left eventPayload undefined, so
      // JSON.parse threw and the empty catch swallowed EVERY event (#8752).
      expect(html).toContain('set_event_callback(function(event)');
      expect(html).not.toContain('function(eventType, eventPayload)');
      expect(html).not.toContain('JSON.parse(eventPayload)');
      // Input is surfaced every frame inside PLAY_TICK as payload.inputState;
      // the engine never emits a standalone INPUT_STATE_CHANGED event.
      expect(html).toContain("type === 'PLAY_TICK'");
      // The delta-tick variant carries input too, so the branch must accept it.
      expect(html).toContain("type === 'PLAY_TICK_DELTA'");
      expect(html).toContain('window.__forgeInputState = payload.inputState');
      expect(html).not.toContain('INPUT_STATE_CHANGED');
      // Transform + audio branches stay wired (now off the single payload arg).
      expect(html).toContain("type === 'TRANSFORM_CHANGED'");
      expect(html).toContain('window.__forgeTransforms');
      expect(html).toContain("type === 'AUDIO_PLAYBACK'");
    });

    it('includes user interaction requirement for autoplay', () => {
      const html = generateGameHTML(baseOptions);
      expect(html).toContain("document.addEventListener('click', function startGame()");
      expect(html).toContain("document.removeEventListener('click', startGame)");
      expect(html).toContain('{ once: true }');
    });

    it('includes background color in body style', () => {
      const html = generateGameHTML({
        ...baseOptions,
        bgColor: '#123456',
      });
      expect(html).toContain('background: #123456');
    });

    it('includes debug logging when includeDebug is true', () => {
      const html = generateGameHTML({
        ...baseOptions,
        includeDebug: true,
      });
      expect(html).toContain("console.log('[Forge] Using ' + variant + ' renderer')");
    });

    it('omits debug logging when includeDebug is false', () => {
      const html = generateGameHTML({
        ...baseOptions,
        includeDebug: false,
      });
      expect(html).not.toContain("console.log('[Forge] Using ' + variant + ' renderer')");
    });

    it('includes error handling for initialization', () => {
      const html = generateGameHTML(baseOptions);
      expect(html).toContain('} catch (err) {');
      expect(html).toContain("console.error('[Forge] Failed to initialize:', err)");
      expect(html).toContain("document.querySelector('#loading p').textContent = 'Failed to load game. ' + err.message");
    });

    describe('branding', () => {
      it('includes "Made with SpawnForge" badge by default (no tier)', () => {
        const html = generateGameHTML(baseOptions);
        expect(html).toContain('Made with');
        expect(html).toContain('SpawnForge');
        expect(html).toContain('spawnforge.ai');
      });

      it('includes branding on free tier (starter)', () => {
        const html = generateGameHTML({ ...baseOptions, creatorTier: 'starter' });
        expect(html).toContain('Made with');
        expect(html).toContain('SpawnForge');
      });

      it('includes branding on hobbyist tier', () => {
        const html = generateGameHTML({ ...baseOptions, creatorTier: 'hobbyist' });
        expect(html).toContain('Made with');
        expect(html).toContain('SpawnForge');
      });

      it('omits branding when hideBranding is true on paid tier', () => {
        const html = generateGameHTML({
          ...baseOptions,
          creatorTier: 'creator',
          hideBranding: true,
        });
        expect(html).not.toContain('Made with');
        expect(html).not.toContain('forge-branding');
      });

      it('includes branding even on paid tier when hideBranding is false', () => {
        const html = generateGameHTML({
          ...baseOptions,
          creatorTier: 'creator',
          hideBranding: false,
        });
        expect(html).toContain('Made with');
        expect(html).toContain('SpawnForge');
      });

      it('ignores hideBranding on free tier (non-removable)', () => {
        const html = generateGameHTML({
          ...baseOptions,
          creatorTier: 'starter',
          hideBranding: true,
        });
        expect(html).toContain('Made with');
        expect(html).toContain('SpawnForge');
      });

      it('ignores hideBranding on hobbyist tier (non-removable)', () => {
        const html = generateGameHTML({
          ...baseOptions,
          creatorTier: 'hobbyist',
          hideBranding: true,
        });
        expect(html).toContain('Made with');
        expect(html).toContain('SpawnForge');
      });
    });
  });
});