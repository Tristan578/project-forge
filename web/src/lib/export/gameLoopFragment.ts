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
import { MAX_COMMAND_PAYLOAD_DEPTH, MAX_COMMAND_PAYLOAD_CONTAINERS } from '@/lib/engine/commandPayloadGuard';

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
// Script commands the engine has already refused once, by name. A script that
// keeps sending a bad command would otherwise warn on every frame.
var __forgeRefusedCommands = {};
// Bounds on a script-built payload, mirroring the editor's command payload
// guard (commandPayloadGuard.ts): the engine walks the JS value recursively
// before any engine code runs, and on wasm32 a stack overflow is an
// unrecoverable trap that kills the engine. Depth is 1-based (a scalar is 1,
// { a: 1 } is 2); containers are objects, arrays, Maps and Sets — the last two
// are converted by the engine's deserialiser but hide their contents from a
// for-in walk, so they are enumerated explicitly. Only own enumerable keys
// count: a value inherited through a prototype is not what the engine will
// serialise. The walk is iterative so checking a hostile payload cannot itself
// overflow, and a cycle runs into the container bound rather than spinning.
var __forgeMaxCommandDepth = ${MAX_COMMAND_PAYLOAD_DEPTH};
var __forgeMaxCommandContainers = ${MAX_COMMAND_PAYLOAD_CONTAINERS};
var __forgeHasOwn = Object.prototype.hasOwnProperty;
function __forgeIsContainer(value) {
  return value !== null && typeof value === 'object';
}
function __forgeChildrenOf(value) {
  if (Array.isArray(value)) return value;
  if (typeof Map !== 'undefined' && value instanceof Map) {
    var mapChildren = [];
    value.forEach(function (v, k) { mapChildren.push(k); mapChildren.push(v); });
    return mapChildren;
  }
  if (typeof Set !== 'undefined' && value instanceof Set) {
    var setChildren = [];
    value.forEach(function (v) { setChildren.push(v); });
    return setChildren;
  }
  var own = [];
  for (var key in value) {
    if (__forgeHasOwn.call(value, key)) own.push(value[key]);
  }
  return own;
}
// Returns null when the payload is within both bounds, else the reason.
function __forgePayloadProblem(payload) {
  if (!__forgeIsContainer(payload)) return null;
  var containers = 1;
  var stack = [{ value: payload, depth: 1 }];
  while (stack.length > 0) {
    var entry = stack.pop();
    if (entry.depth > __forgeMaxCommandDepth) return 'payload nested deeper than ' + __forgeMaxCommandDepth + ' levels';
    var children = __forgeChildrenOf(entry.value);
    var childDepth = entry.depth + 1;
    for (var i = 0; i < children.length; i++) {
      var child = children[i];
      if (__forgeIsContainer(child)) {
        containers += 1;
        if (containers > __forgeMaxCommandContainers) return 'payload has too much structure (over ' + __forgeMaxCommandContainers + ' objects and arrays)';
        stack.push({ value: child, depth: childDepth });
      } else if (childDepth > __forgeMaxCommandDepth) {
        return 'payload nested deeper than ' + __forgeMaxCommandDepth + ' levels';
      }
    }
  }
  return null;
}
function gameLoop() {
  var now = performance.now();
  var dt = (now - lastTime) / 1000;
  lastTime = now;

  // Performance harness (perfHarnessFragment.ts): records this frame's
  // timestamp when the page was opened with ?forgePerf=1; absent otherwise.
  if (window.__forgePerfHooks) window.__forgePerfHooks.frame(now);

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

  // Flush script commands to the engine. The engine deserialises its payload
  // from the JS value it is handed, so it must be the command OBJECT: a JSON
  // string arrives as one string value with no fields and every handler that
  // reads fields refuses it (#10196). The name travels separately, as the
  // editor's script runner sends it, so it is split off the payload here.
  if (window.__forgeFlushCommands) {
    var cmds = window.__forgeFlushCommands();
    for (var ci = 0; ci < cmds.length; ci++) {
      var cmdName = cmds[ci].cmd;
      // Own enumerable fields only, and never '__proto__': assigning that key
      // on a plain object swaps the payload's prototype instead of adding a
      // field, so the engine would serialise inherited values in place of the
      // command's own. A script has no legitimate command field by that name.
      var cmdPayload = {};
      for (var cmdKey in cmds[ci]) {
        if (cmdKey === 'cmd' || cmdKey === '__proto__' || !__forgeHasOwn.call(cmds[ci], cmdKey)) continue;
        cmdPayload[cmdKey] = cmds[ci][cmdKey];
      }
      var cmdProblem = __forgePayloadProblem(cmdPayload);
      if (cmdProblem !== null) {
        if (!__forgeRefusedCommands[cmdName]) {
          __forgeRefusedCommands[cmdName] = true;
          console.warn('[SpawnForge] Dropped script command "' + cmdName + '": ' + cmdProblem);
        }
        continue;
      }
      var cmdResult = ${handleCommand}(cmdName, cmdPayload);
      if (cmdResult && cmdResult.success === false && !__forgeRefusedCommands[cmdName]) {
        __forgeRefusedCommands[cmdName] = true;
        console.warn('[SpawnForge] The engine refused script command "' + cmdName + '": ' + cmdResult.error);
      }
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
