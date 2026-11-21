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
