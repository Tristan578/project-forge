/**
 * The exported game's engine-event handler, driven as CODE rather than matched
 * as text.
 *
 * A `toContain('CHARACTER_GROUNDED_CHANGED')` assertion passes against a branch
 * that writes the wrong global, reads the wrong payload key, or sits after an
 * unreachable `return` — so every case here evaluates the generated fragment
 * and feeds it a real engine event, then reads the `window.*` global the script
 * shim in `scriptBundler.ts` actually consumes.
 */
import { describe, it, expect } from 'vitest';
import { generateEventCallbackFragment } from '../eventCallbackFragment';
import { generateGameHTML } from '../gameTemplate';
import { generateZipIndexHtml } from '../zipExporter';

type FakeWindow = Record<string, unknown>;

/**
 * Evaluates the fragment into a callable, closing over a fake `window`.
 *
 * The generated source references a bare `window`, which is how it runs in the
 * exported page; passing it as a parameter is what lets this suite run in the
 * node environment without pretending to be a browser.
 */
function loadHandler(): { call: (event: unknown) => void; win: FakeWindow } {
  const win: FakeWindow = {};
  const factory = new Function('window', `return (${generateEventCallbackFragment()});`) as (
    w: FakeWindow,
  ) => (event: unknown) => void;
  const handler = factory(win);
  return { call: handler, win };
}

describe('generateEventCallbackFragment', () => {
  describe('CHARACTER_GROUNDED_CHANGED (PF-1214)', () => {
    it('mirrors a grounded event into the global forge.physics.isGrounded reads', () => {
      const { call, win } = loadHandler();
      call({ type: 'CHARACTER_GROUNDED_CHANGED', payload: { entityId: 'player', grounded: true } });
      expect(win['__forgeGrounded']).toEqual({ player: true });
    });

    it('tracks the entity back to false when it leaves the ground', () => {
      const { call, win } = loadHandler();
      call({ type: 'CHARACTER_GROUNDED_CHANGED', payload: { entityId: 'player', grounded: true } });
      call({ type: 'CHARACTER_GROUNDED_CHANGED', payload: { entityId: 'player', grounded: false } });
      expect(win['__forgeGrounded']).toEqual({ player: false });
    });

    it('keeps entities independent', () => {
      const { call, win } = loadHandler();
      call({ type: 'CHARACTER_GROUNDED_CHANGED', payload: { entityId: 'player', grounded: true } });
      call({ type: 'CHARACTER_GROUNDED_CHANGED', payload: { entityId: 'npc', grounded: false } });
      expect(win['__forgeGrounded']).toEqual({ player: true, npc: false });
    });

    it('coerces to a real boolean rather than storing the raw payload value', () => {
      const { call, win } = loadHandler();
      call({ type: 'CHARACTER_GROUNDED_CHANGED', payload: { entityId: 'player', grounded: 1 } });
      // `forge.physics.isGrounded` is documented as returning a boolean; a
      // truthy 1 leaking through would make `=== true` comparisons in creator
      // scripts silently false.
      expect(win['__forgeGrounded']).toEqual({ player: true });
    });

    it('leaves the map untouched for other event types', () => {
      const { call, win } = loadHandler();
      call({ type: 'CHARACTER_GROUNDED_CHANGED', payload: { entityId: 'player', grounded: true } });
      call({ type: 'AUDIO_PLAYBACK', payload: { entityId: 'player', action: 'play' } });
      expect(win['__forgeGrounded']).toEqual({ player: true });
    });
  });

  describe('the globals every other branch feeds', () => {
    it('mirrors PLAY_TICK input state', () => {
      const { call, win } = loadHandler();
      const inputState = { pressed: { jump: true }, justPressed: {}, justReleased: {}, axes: {} };
      call({ type: 'PLAY_TICK', payload: { inputState } });
      expect(win['__forgeInputState']).toEqual(inputState);
    });

    it('substitutes an empty input surface when PLAY_TICK carries none', () => {
      const { call, win } = loadHandler();
      call({ type: 'PLAY_TICK_DELTA', payload: { somethingElse: 1 } });
      expect(win['__forgeInputState']).toEqual({
        pressed: {}, justPressed: {}, justReleased: {}, axes: {},
      });
    });

    it('mirrors TRANSFORM_CHANGED payloads whole', () => {
      const { call, win } = loadHandler();
      const payload = { entityId: 'box', position: [1, 2, 3] };
      call({ type: 'TRANSFORM_CHANGED', payload });
      expect(win['__forgeTransforms']).toEqual({ box: payload });
    });

    it.each([
      ['play', true],
      ['resume', true],
      ['stop', false],
      ['pause', false],
    ])('maps AUDIO_PLAYBACK %s to %s', (action, expected) => {
      const { call, win } = loadHandler();
      call({ type: 'AUDIO_PLAYBACK', payload: { entityId: 'music', action } });
      expect(win['__forgeAudioState']).toEqual({ music: expected });
    });
  });

  describe('robustness', () => {
    it.each([
      ['no event', undefined],
      ['a null event', null],
      ['an event with no payload', { type: 'CHARACTER_GROUNDED_CHANGED' }],
    ])('ignores %s without throwing or creating globals', (_label, event) => {
      const { call, win } = loadHandler();
      expect(() => call(event)).not.toThrow();
      expect(win['__forgeGrounded']).toBeUndefined();
    });

    it('swallows an unknown event type', () => {
      const { call, win } = loadHandler();
      expect(() => call({ type: 'SOMETHING_NEW', payload: {} })).not.toThrow();
      expect(Object.keys(win)).toEqual([]);
    });
  });

  it('applies the indent prefix to every line but the first', () => {
    const indented = generateEventCallbackFragment({ indent: '    ' });
    const lines = indented.split('\n');
    // The first line is spliced inline after `set_event_callback(`.
    expect(lines[0]).toBe('function(event) {');
    for (const line of lines.slice(1)) {
      if (line.length === 0) continue;
      expect(line.startsWith('    ')).toBe(true);
    }
  });
});

/**
 * The reason this module exists: two generators, one handler. `#8754` was the
 * same defect in the game loop — fixed in the single-HTML exporter, re-found by
 * Sentry weeks later in the ZIP exporter — and the grounded mirror would have
 * been the next instance (PF-1214, review finding #7).
 */
describe('both exporters embed the same handler', () => {
  const fragment = generateEventCallbackFragment({ indent: '        ' });

  const singleHtml = generateGameHTML({
    title: 'Test Game',
    bgColor: '#000000',
    resolution: 'responsive',
    sceneData: '{"entities":[]}',
    scriptBundle: '',
    includeDebug: false,
  });

  const zipHtml = generateZipIndexHtml({
    title: 'Test Game',
    bgColor: '#000000',
    resolution: 'responsive',
    includeDebug: false,
    loadingScreenHtml: '',
    loadingScript: '',
    hasWebGPU: true,
    hasWebGL2: true,
  });

  it.each([
    ['single-HTML', () => singleHtml],
    ['ZIP', () => zipHtml],
  ])('the %s export embeds the shared fragment verbatim', (_label, get) => {
    expect(get()).toContain(fragment);
  });

  it.each([
    ['single-HTML', () => singleHtml],
    ['ZIP', () => zipHtml],
  ])('the %s export carries exactly one handler', (_label, get) => {
    // A second, hand-written copy alongside the fragment is the failure mode
    // the extraction removes; whichever one the engine installs last wins, and
    // nothing reports the other.
    expect(get().match(/function\(event\) \{/g)).toHaveLength(1);
  });
});
