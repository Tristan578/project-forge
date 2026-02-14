import { describe, it, expect } from 'vitest';
import { generateGameHTML, type GameTemplateOptions } from './gameTemplate';

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
      // Should not have extra script tags beyond the scene data and module
      const scriptCount = (html.match(/<script>/g) || []).length;
      expect(scriptCount).toBe(1); // Only the scene data script
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
      expect(html).toContain("const variant = hasWebGPU ? 'webgpu' : 'webgl2'");
      expect(html).toContain("await import(basePath + '/engine-pkg-' + variant + '/forge_engine.js')");
    });

    it('includes scene loading logic', () => {
      const html = generateGameHTML(baseOptions);
      expect(html).toContain("handle_command('load_scene', JSON.stringify(window.__forgeSceneData))");
    });

    it('includes auto-play logic', () => {
      const html = generateGameHTML(baseOptions);
      expect(html).toContain("handle_command('play', '{}')");
      expect(html).toContain('if (window.__forgeScriptStart) window.__forgeScriptStart()');
    });

    it('includes script update loop', () => {
      const html = generateGameHTML(baseOptions);
      expect(html).toContain('function gameLoop()');
      expect(html).toContain('if (window.__forgeScriptUpdate) window.__forgeScriptUpdate(dt)');
      expect(html).toContain('requestAnimationFrame(gameLoop)');
    });

    it('includes command flush logic', () => {
      const html = generateGameHTML(baseOptions);
      expect(html).toContain('if (window.__forgeFlushCommands)');
      expect(html).toContain('const cmds = window.__forgeFlushCommands()');
      expect(html).toContain('handle_command(cmd.cmd, JSON.stringify(cmd))');
    });

    it('includes event callback setup', () => {
      const html = generateGameHTML(baseOptions);
      expect(html).toContain('set_event_callback(function(eventType, eventPayload)');
      expect(html).toContain("if (eventType === 'INPUT_STATE_CHANGED')");
      expect(html).toContain('window.__forgeInputState = payload');
      expect(html).toContain("if (eventType === 'TRANSFORM_CHANGED')");
      expect(html).toContain('window.__forgeTransforms');
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
  });
});
