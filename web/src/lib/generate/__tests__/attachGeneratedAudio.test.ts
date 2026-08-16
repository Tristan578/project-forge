/**
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest';
import {
  attachGeneratedAudio,
  generatedAudioAssetName,
  type GeneratedAudioSink,
} from '../attachGeneratedAudio';

function sink(): GeneratedAudioSink & {
  importAudio: ReturnType<typeof vi.fn>;
  setAudio: ReturnType<typeof vi.fn>;
} {
  return { importAudio: vi.fn(), setAudio: vi.fn() };
}

describe('generatedAudioAssetName', () => {
  it('prefixes with the kind and truncates the prompt', () => {
    expect(generatedAudioAssetName('sfx', 'a sword clashing against a metal shield')).toBe(
      'sfx-a sword clashing aga'
    );
  });

  it('is what the entity ends up pointing at, so the two must agree', () => {
    const s = sink();
    const name = attachGeneratedAudio({
      kind: 'voice',
      prompt: 'Welcome, adventurer',
      audioBase64: 'AAA',
      entityId: 'e1',
      sink: s,
    });

    expect(name).toBe(generatedAudioAssetName('voice', 'Welcome, adventurer'));
    expect(s.importAudio).toHaveBeenCalledWith('AAA', name);
    expect(s.setAudio.mock.calls[0][1].assetId).toBe(name);
  });
});

describe('attachGeneratedAudio', () => {
  it('imports without attaching when no entity is given', () => {
    const s = sink();
    attachGeneratedAudio({ kind: 'sfx', prompt: 'explosion', audioBase64: 'AAA', sink: s });

    expect(s.importAudio).toHaveBeenCalledTimes(1);
    expect(s.setAudio).not.toHaveBeenCalled();
  });

  it('puts a sound effect on the sfx bus and leaves it silent until played', () => {
    const s = sink();
    attachGeneratedAudio({
      kind: 'sfx',
      prompt: 'explosion',
      audioBase64: 'AAA',
      entityId: 'e1',
      sink: s,
    });

    const [entityId, data] = s.setAudio.mock.calls[0];
    expect(entityId).toBe('e1');
    expect(data.bus).toBe('sfx');
    expect(data.autoplay).toBe(false);
    expect(data.pitch).toBe(1.0);
  });

  it('puts dialogue on the voice bus', () => {
    const s = sink();
    attachGeneratedAudio({
      kind: 'voice',
      prompt: 'Hello there',
      audioBase64: 'AAA',
      entityId: 'e1',
      sink: s,
    });

    expect(s.setAudio.mock.calls[0][1].bus).toBe('voice');
  });

  it('makes music a non-spatial looping bed that starts on its own', () => {
    // Music is the one kind `getSpatialDefaults` has no category for: a track
    // that plays positionally, once, is not music.
    const s = sink();
    attachGeneratedAudio({
      kind: 'music',
      prompt: 'tense dungeon theme',
      audioBase64: 'AAA',
      entityId: 'e1',
      sink: s,
    });

    expect(s.setAudio.mock.calls[0][1]).toEqual({
      assetId: 'music-tense dungeon theme',
      volume: 0.7,
      pitch: 1.0,
      loopAudio: true,
      spatial: false,
      maxDistance: 100,
      refDistance: 1,
      rolloffFactor: 1,
      autoplay: true,
      bus: 'music',
    });
  });
});
