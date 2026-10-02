/**
 * `boundEngineError` caps engine refusal text before it is stored or relayed
 * (#10267, review-board round 3): serde_json embeds the ENTIRE offending value
 * in `invalid type: string "…"`, and a remixed scene is a stranger's input, so
 * without a bound a scene could dictate the size of the non-dismissible load
 * notice, a toast, or the tool-error text fed back to the model.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  boundEngineError,
  describeSceneRefusal,
  ENGINE_ERROR_TRUNCATED,
  ENVELOPE_REFUSAL,
  ENVELOPE_REFUSAL_FOR_CREATORS,
  MAX_ENGINE_ERROR_CHARS,
  emptySceneFile,
  setSceneValidator,
  validateSceneFile,
} from '../sceneValidation';

afterEach(() => setSceneValidator(null));

/** A refusal shaped exactly like serde_json's, carrying `kib` KiB of scene content. */
function hostileRefusal(kib: number): string {
  return `Invalid scene file: invalid type: string "${'A'.repeat(kib * 1024)}", expected f32 at line 1 column 9`;
}

describe('boundEngineError', () => {
  it('returns short text unchanged, without a marker', () => {
    const short = 'Invalid scene file: missing field `entities` at line 1 column 2';
    expect(boundEngineError(short)).toBe(short);
  });

  it('returns text exactly at the bound unchanged', () => {
    const exact = 'x'.repeat(MAX_ENGINE_ERROR_CHARS);
    expect(boundEngineError(exact)).toBe(exact);
  });

  it('caps a multi-KiB refusal at the bound, keeps the field-naming head, and ends with the marker', () => {
    const bounded = boundEngineError(hostileRefusal(64));
    expect(bounded.length).toBe(MAX_ENGINE_ERROR_CHARS);
    expect(bounded.startsWith('Invalid scene file: invalid type: string "AAAA')).toBe(true);
    expect(bounded.endsWith(ENGINE_ERROR_TRUNCATED)).toBe(true);
  });

  it('honours a caller-supplied bound', () => {
    const bounded = boundEngineError(hostileRefusal(1), 64);
    expect(bounded.length).toBe(64);
    expect(bounded.endsWith(ENGINE_ERROR_TRUNCATED)).toBe(true);
  });

  it('never ends the kept head on half of a surrogate pair', () => {
    // Fill so that the cut would land exactly between the two halves of an
    // astral character: `max - marker` units of ASCII, then an emoji.
    const headLength = 64 - ENGINE_ERROR_TRUNCATED.length;
    const input = 'a'.repeat(headLength - 1) + '\u{1F600}' + 'z'.repeat(100);
    const bounded = boundEngineError(input, 64);
    expect(bounded.endsWith(ENGINE_ERROR_TRUNCATED)).toBe(true);
    const head = bounded.slice(0, -ENGINE_ERROR_TRUNCATED.length);
    const last = head.charCodeAt(head.length - 1);
    expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
    expect(head).toBe('a'.repeat(headLength - 1));
  });
});

describe('describeSceneRefusal', () => {
  it('drops the engine prefix and serde position, and ends the sentence', () => {
    expect(describeSceneRefusal('Invalid scene file: invalid type: string "x", expected f32 at line 1 column 900'))
      .toBe('Invalid type: string "x", expected f32.');
  });

  it('drops a repeated prefix', () => {
    expect(describeSceneRefusal('Invalid scene file: Invalid scene file: missing field `entities` at line 3 column 14'))
      .toBe('Missing field `entities`.');
  });

  it('keeps an engine message that has neither, punctuating it once', () => {
    expect(describeSceneRefusal('Scene transforms must contain finite numbers'))
      .toBe('Scene transforms must contain finite numbers.');
    expect(describeSceneRefusal('Scene hierarchy contains a cycle.')).toBe('Scene hierarchy contains a cycle.');
  });

  it('replaces the browser-side refusal with plain words', () => {
    expect(describeSceneRefusal(ENVELOPE_REFUSAL)).toBe(ENVELOPE_REFUSAL_FOR_CREATORS);
    expect(ENVELOPE_REFUSAL_FOR_CREATORS).not.toMatch(/envelope|Invalid scene file/i);
  });

  it('leaves a truncation marker readable and does not add a period after it', () => {
    const bounded = boundEngineError(hostileRefusal(64));
    const described = describeSceneRefusal(bounded);
    expect(described.startsWith('Invalid type: string "AAAA')).toBe(true);
    expect(described.endsWith(ENGINE_ERROR_TRUNCATED)).toBe(true);
  });

  it('says so when nothing is left after stripping', () => {
    expect(describeSceneRefusal('Invalid scene file: ')).toBe('The engine gave no further detail.');
  });
});

describe('validateSceneFile', () => {
  it('reports a real envelope refusal with a reason, never as "unavailable"', () => {
    // A decoder IS attached; the envelope check refuses before it runs.
    setSceneValidator(() => ({ valid: true }));
    expect(validateSceneFile({ formatVersion: 3, entities: [] })).toEqual({ valid: false, reason: ENVELOPE_REFUSAL });
  });

  it('reports null only when no decoder is attached or it throws', () => {
    const scene = emptySceneFile('Envelope ok');
    expect(validateSceneFile(scene)).toEqual({ valid: false, reason: null });
    setSceneValidator(() => { throw new Error('decoder crashed'); });
    expect(validateSceneFile(scene)).toEqual({ valid: false, reason: null });
  });

  it('passes the decoder verdict through', () => {
    const scene = emptySceneFile('Decoded');
    setSceneValidator(() => ({ valid: true }));
    expect(validateSceneFile(scene)).toEqual({ valid: true });
    setSceneValidator(() => ({ valid: false, reason: 'Invalid scene file: entity 0: bad' }));
    expect(validateSceneFile(scene)).toEqual({ valid: false, reason: 'Invalid scene file: entity 0: bad' });
  });
});
