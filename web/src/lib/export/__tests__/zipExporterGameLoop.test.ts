// @vitest-environment node
/**
 * Pins the generated game-loop structure for the ZIP export path (#8754).
 *
 * The ZIP exporter emits its own inline game loop (separate from gameTemplate's
 * single-HTML loop). Both must merge the touch-input layer onto __forgeInputState
 * BEFORE the per-frame script read: the engine's PLAY_TICK callback overwrites
 * __forgeInputState wholesale with keyboard/gamepad state only, so a merge that
 * runs after __forgeScriptUpdate is clobbered before any script sees the touch
 * state — touch controls go dead in exported mobile games. This is a structural
 * test because the loop is emitted as a template-literal string, not an
 * importable module.
 */
import { describe, it, expect } from 'vitest';
import { generateZipIndexHtml } from '../zipExporter';

const makeOptions = () => ({
  title: 'Test Game',
  bgColor: '#000000',
  resolution: 'responsive' as const,
  includeDebug: false,
  loadingScreenHtml: '<div id="loading"></div>',
  loadingScript: '',
  hasWebGPU: true,
  hasWebGL2: true,
});

describe('ZIP export game loop (#8754)', () => {
  it('merges touch input before the frame script update inside the gameLoop', () => {
    const html = generateZipIndexHtml(makeOptions());

    const loopStart = html.indexOf('function gameLoop()');
    const loopEnd = html.indexOf('requestAnimationFrame(gameLoop)', loopStart);
    expect(loopStart).toBeGreaterThanOrEqual(0);
    expect(loopEnd).toBeGreaterThan(loopStart);

    const loopBody = html.slice(loopStart, loopEnd);
    expect(loopBody).toContain('// Merge touch input');
    expect(loopBody).toContain('window.__forgeScriptUpdate(dt)');
    expect(loopBody).toContain('__forgeTouchFlush');

    // The merge must come BEFORE the script read within the same loop tick.
    expect(loopBody.indexOf('// Merge touch input')).toBeLessThan(
      loopBody.indexOf('window.__forgeScriptUpdate(dt)'),
    );
  });
});

describe('ZIP export scene load and perf harness (#10013)', () => {
  it('loads the scene with a { json } payload once the engine accepts commands', () => {
    const html = generateZipIndexHtml(makeOptions());
    expect(html).toContain('async function __forgeLoadScene(send, sceneData)');
    expect(html).toContain('var sceneLoad = await __forgeLoadScene(wasm.handle_command, window.__forgeSceneData);');
    expect(html).not.toContain("wasm.handle_command('load_scene', JSON.stringify(");
    expect(html.indexOf("wasm.init_engine('game-canvas')")).toBeLessThan(html.indexOf('await __forgeLoadScene('));
    expect(html.indexOf('await __forgeLoadScene(')).toBeLessThan(html.indexOf("wasm.handle_command('play', '{}')"));
  });

  it('wires every perf-harness hook behind a guard, after the dormant bootstrap', () => {
    const html = generateZipIndexHtml(makeOptions());
    for (const hook of ['initStart()', 'backend(variant)', 'wasm(wasmExports)', 'sceneLoad(sceneLoad)', 'fail(err)', 'frame(now)']) {
      expect(html).toContain(`if (window.__forgePerfHooks) window.__forgePerfHooks.${hook}`);
    }
    expect(html.indexOf('window.__forgePerfHooks = {')).toBeLessThan(html.indexOf('<script type="module">'));
  });

  it('reports the variant it will actually load for single-backend exports', () => {
    const webgl2Only = generateZipIndexHtml({ ...makeOptions(), hasWebGPU: false });
    expect(webgl2Only).toContain("var variant = 'webgl2';");
    expect(webgl2Only.indexOf("var variant = 'webgl2';")).toBeLessThan(webgl2Only.indexOf('window.__forgePerfHooks.backend(variant)'));
  });
});

describe('ZIP export project dimension (#10013)', () => {
  it('switches a 2D game to the engine 2D camera after the scene loads', () => {
    const html = generateZipIndexHtml({ ...makeOptions(), projectType: '2d' as const });
    const call = "wasm.handle_command('set_project_type', { projectType: '2d' });";
    expect(html).toContain(call);
    expect(html.indexOf('await __forgeLoadScene(')).toBeLessThan(html.indexOf(call));
  });

  it('leaves a 3D (or unspecified) game on the default 3D camera', () => {
    expect(generateZipIndexHtml({ ...makeOptions(), projectType: '3d' as const })).not.toContain("'set_project_type'");
    expect(generateZipIndexHtml(makeOptions())).not.toContain("'set_project_type'");
  });
});
