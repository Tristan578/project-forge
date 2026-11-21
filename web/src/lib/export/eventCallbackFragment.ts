/**
 * Shared engine-event callback fragment for exported games.
 *
 * The single-HTML exporter (`gameTemplate.ts` → `generateGameHTML`) and the ZIP
 * exporter (`zipExporter.ts` → `generateZipIndexHtml`) both install a
 * `set_event_callback` handler that mirrors engine events into the `window.*`
 * globals the bundled script runtime reads (`scriptBundler.ts`). The two copies
 * were byte-identical and drifted in exactly the way `generateGameLoopFragment`
 * was extracted to prevent (#8754 → #8761): a fix applied to one generator has
 * to be re-applied to its sibling, and nothing reports the gap in between —
 * an exported game simply behaves differently depending on which button the
 * creator pressed. This module is the single source of truth for the handler.
 *
 * Every global written here has a reader in the script shim:
 *   `window.__forgeInputState` → `forge.input.*`
 *   `window.__forgeTransforms` → `forge.getTransform`
 *   `window.__forgeAudioState` → `forge.audio.isPlaying`
 *   `window.__forgeGrounded`   → `forge.physics.isGrounded`
 * Adding a branch without a reader (or a reader without a branch) is the
 * defect this pairing exists to make visible.
 */
export interface EventCallbackFragmentOptions {
  /**
   * Indentation prefix applied to every non-blank emitted line so the fragment
   * slots cleanly into each host's surrounding script block. Cosmetic only.
   */
  indent?: string;
}

/**
 * Returns the JS source for the `function(event) { … }` expression passed to
 * the engine's `set_event_callback`.
 *
 * The engine (`bridge/events.rs` `emit_event`) invokes this with ONE argument —
 * a live `{ type, payload }` object produced by serde-wasm-bindgen, not two
 * args and not a JSON string. The old 2-arg + `JSON.parse` signature dropped
 * every event (#8752).
 */
export function generateEventCallbackFragment({ indent = '' }: EventCallbackFragmentOptions = {}): string {
  const body = `function(event) {
  try {
    if (!event || !event.payload) return;
    var type = event.type;
    var payload = event.payload;
    if (type === 'PLAY_TICK' || type === 'PLAY_TICK_DELTA') {
      // Input arrives every frame inside PLAY_TICK as payload.inputState
      // (field-keyed: pressed/justPressed/justReleased/axes); there is no
      // standalone input-changed event.
      window.__forgeInputState = payload.inputState || { pressed: {}, justPressed: {}, justReleased: {}, axes: {} };
    } else if (type === 'TRANSFORM_CHANGED') {
      if (!window.__forgeTransforms) window.__forgeTransforms = {};
      window.__forgeTransforms[payload.entityId] = payload;
    } else if (type === 'AUDIO_PLAYBACK') {
      if (!window.__forgeAudioState) window.__forgeAudioState = {};
      window.__forgeAudioState[payload.entityId] = (payload.action === 'play' || payload.action === 'resume');
    } else if (type === 'CHARACTER_GROUNDED_CHANGED') {
      // The kinematic controller owns contact state; nothing else on the JS
      // side can see it, so without this mirror an exported script has no way
      // to tell a jump from a fall (PF-1214). Emitted on CHANGE only, so the
      // map is the running truth and an absent entity has simply never
      // reported — false is the right answer for it and for any non-character.
      if (!window.__forgeGrounded) window.__forgeGrounded = {};
      window.__forgeGrounded[payload.entityId] = !!payload.grounded;
    }
  } catch(e) {}
}`;

  if (!indent) return body;
  // The first line is spliced inline after `set_event_callback(`, so it must
  // NOT be indented — unlike `generateGameLoopFragment`, which is emitted on a
  // line of its own.
  return body
    .split('\n')
    .map((line, i) => (i > 0 && line.length > 0 ? indent + line : line))
    .join('\n');
}
