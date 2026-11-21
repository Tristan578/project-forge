import { describe, it, expect } from 'vitest';
import { generateGameLoopFragment } from '../gameLoopFragment';

/**
 * Single source-of-truth test for the exported game loop (#8761). Previously the
 * single-HTML and ZIP exporters each carried a near-duplicate structural test;
 * the loop now lives in one helper, so its invariants are pinned here once.
 */
describe('generateGameLoopFragment', () => {
  const frag = generateGameLoopFragment({ handleCommand: 'handle_command' });

  it('emits the loop scaffold from lastTime capture through the rAF kickoff', () => {
    expect(frag).toContain('var lastTime = performance.now();');
    expect(frag).toContain('function gameLoop() {');
    expect(frag).toContain('var dt = (now - lastTime) / 1000;');
    // rAF appears twice: the in-loop re-enqueue and the initial kickoff.
    expect(frag.match(/requestAnimationFrame\(gameLoop\)/g)).toHaveLength(2);
  });

  it('merges touch input BEFORE the script update every frame (#8754 ordering invariant)', () => {
    const touchMerge = frag.indexOf('window.__forgeTouchFlush()');
    const scriptUpdate = frag.indexOf('window.__forgeScriptUpdate(dt)');
    expect(touchMerge).toBeGreaterThan(-1);
    expect(scriptUpdate).toBeGreaterThan(-1);
    // If this ever flips, an intervening PLAY_TICK wipes touch state before any
    // script reads it and touch controls go dead in exported mobile games.
    expect(touchMerge).toBeLessThan(scriptUpdate);
  });

  it('re-applies the full touch surface (pressed / justPressed / justReleased / axes) on top of PLAY_TICK', () => {
    expect(frag).toContain('for (var k in ti.pressed)');
    expect(frag).toContain('for (var k2 in ti.justPressed)');
    expect(frag).toContain('for (var k3 in ti.justReleased)');
    expect(frag).toContain('for (var k4 in ti.axes)');
  });

  it('flushes queued script commands through the provided command sink, verbatim', () => {
    expect(frag).toContain('var cmds = window.__forgeFlushCommands();');
    // Default (single-HTML) sink: the global handle_command.
    expect(frag).toContain('handle_command(cmds[ci].cmd, JSON.stringify(cmds[ci]));');
  });

  it('parameterizes the command sink (ZIP build uses the wasm module local)', () => {
    const zipFrag = generateGameLoopFragment({ handleCommand: 'wasm.handle_command' });
    expect(zipFrag).toContain('wasm.handle_command(cmds[ci].cmd, JSON.stringify(cmds[ci]));');
    // The two builds must differ ONLY in the sink reference — same loop otherwise.
    expect(zipFrag.replace(/wasm\.handle_command/g, 'handle_command')).toBe(frag);
  });

  it('applies the indent prefix to every non-blank line and leaves blank lines bare', () => {
    const indented = generateGameLoopFragment({ handleCommand: 'handle_command', indent: '    ' });
    const lines = indented.split('\n');
    for (const line of lines) {
      if (line.length === 0) continue;
      expect(line.startsWith('    ')).toBe(true);
    }
    // Blank separator lines stay genuinely empty (no trailing whitespace).
    expect(indented).toContain('\n\n');
  });
});
