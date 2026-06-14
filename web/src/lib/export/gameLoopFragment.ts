/**
 * Shared inline game-loop fragment for exported games.
 *
 * The single-HTML exporter (`gameTemplate.ts` → `generateGameHTML`) and the ZIP
 * exporter (`zipExporter.ts` → `generateZipIndexHtml`) both embed a functionally
 * identical per-frame loop: merge touch input, run script `onUpdate`, flush
 * queued script commands to the engine, then re-enqueue via
 * `requestAnimationFrame`. Keeping two copies caused #8754 — the "merge touch
 * before the script reads it" ordering fix had to be applied to the single-HTML
 * path first, then re-applied to the ZIP path after Sentry re-found the same
 * defect in the sibling generator. This module is the single source of truth so
 * the two paths can never silently diverge again (#8761).
 *
 * The ONLY thing that differs between the two hosts is how the engine's command
 * entry point is referenced: the single-HTML build calls a global
 * `handle_command`, while the ZIP build holds the WASM module in a `wasm` local
 * and calls `wasm.handle_command`. That reference is the lone parameter.
 */
export interface GameLoopFragmentOptions {
  /**
   * How to reference the engine command sink inside the generated loop, e.g.
   * `'handle_command'` (single-HTML, global) or `'wasm.handle_command'` (ZIP,
   * module local).
   *
   * SECURITY: this string is emitted VERBATIM into the generated game script. It
   * MUST be a trusted compile-time literal — never derive it from user input,
   * scene data, or any external value.
   */
  handleCommand: string;
  /**
   * Indentation prefix applied to every non-blank emitted line so the fragment
   * slots cleanly into each host's surrounding script block. Cosmetic only.
   */
  indent?: string;
}

/**
 * Returns the JS source for the exported game loop, from the initial
 * `lastTime` capture through the kickoff `requestAnimationFrame(gameLoop)`.
 *
 * Invariant pinned by `gameLoopFragment.test.ts`: the touch-input merge runs
 * BEFORE `__forgeScriptUpdate` every frame (#8754).
 */
export function generateGameLoopFragment({ handleCommand, indent = '' }: GameLoopFragmentOptions): string {
  const body = `var lastTime = performance.now();
function gameLoop() {
  var now = performance.now();
  var dt = (now - lastTime) / 1000;
  lastTime = now;

  // Merge touch input BEFORE the frame's script update. PLAY_TICK overwrites
  // __forgeInputState wholesale every engine frame with keyboard/gamepad state
  // only (the engine has no knowledge of JS touch input), so the touch layer
  // must be re-applied on top within the same synchronous gameLoop tick the
  // scripts read. JS is single-threaded, so no PLAY_TICK can interleave between
  // this merge and __forgeScriptUpdate below. Merging AFTER the script read let
  // an intervening PLAY_TICK obliterate touch input before scripts ever saw it —
  // touch controls were dead in exported mobile games (#8754, #8761).
  if (window.__forgeTouchInput) {
    if (!window.__forgeInputState) window.__forgeInputState = { pressed: {}, justPressed: {}, justReleased: {}, axes: {} };
    var ti = window.__forgeTouchInput;
    for (var k in ti.pressed) { if (ti.pressed[k]) window.__forgeInputState.pressed[k] = true; }
    for (var k2 in ti.justPressed) { if (ti.justPressed[k2]) window.__forgeInputState.justPressed[k2] = true; }
    for (var k3 in ti.justReleased) { if (ti.justReleased[k3]) window.__forgeInputState.justReleased[k3] = true; }
    for (var k4 in ti.axes) { window.__forgeInputState.axes[k4] = ti.axes[k4]; }
    if (window.__forgeTouchFlush) window.__forgeTouchFlush();
  }

  if (window.__forgeScriptUpdate) window.__forgeScriptUpdate(dt);

  // Flush script commands to the engine
  if (window.__forgeFlushCommands) {
    var cmds = window.__forgeFlushCommands();
    for (var ci = 0; ci < cmds.length; ci++) {
      ${handleCommand}(cmds[ci].cmd, JSON.stringify(cmds[ci]));
    }
  }

  requestAnimationFrame(gameLoop);
}
requestAnimationFrame(gameLoop);`;

  if (!indent) return body;
  return body
    .split('\n')
    .map((line) => (line.length > 0 ? indent + line : line))
    .join('\n');
}
