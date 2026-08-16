/**
 * Turn a generated clip into an imported asset, and optionally into an entity's
 * `AudioData`.
 *
 * This exists because there are TWO surfaces that generate a sound — the chat
 * tool (`generate_sfx` / `generate_voice`) and the `GenerateSoundDialog` — and
 * only one of them ever consumed the result. The dialog POSTed, discarded the
 * response body, and returned `true`, so a sound generated from the UI spent
 * the user's tokens and produced nothing: no asset in the panel, no component
 * on the entity, no sound. Sharing the consumption keeps the two from drifting
 * again, and makes the spatial defaults one decision rather than two.
 *
 * The store actions arrive as arguments rather than through a `@/stores/`
 * import: this is `lib/` code, and a value-import of the store from `lib/` is
 * the module edge that broke `next build` in PF-1118.
 */

import type { AudioData } from '@/stores/slices/types';
import { inferSfxCategory, getSpatialDefaults } from '@/lib/generate/postProcess';

/** The two store actions this needs, passed in rather than imported. */
export interface GeneratedAudioSink {
  importAudio: (dataBase64: string, name: string) => void;
  setAudio: (entityId: string, data: Partial<AudioData>) => void;
}

export type GeneratedAudioKind = 'sfx' | 'voice' | 'music';

export interface AttachGeneratedAudioOptions {
  /** Which generator produced it — decides the bus and the spatial profile. */
  kind: GeneratedAudioKind;
  /** The prompt (SFX/music) or spoken text (voice), used to name the asset. */
  prompt: string;
  audioBase64: string;
  /** Absent means "import it, attach it to nothing". */
  entityId?: string;
  sink: GeneratedAudioSink;
}

/**
 * Music is not spatial and is not a one-shot: it is a non-positional bed that
 * starts on its own and loops. `getSpatialDefaults` has no category for that,
 * hence the literals.
 */
const MUSIC_DEFAULTS = {
  volume: 0.7,
  loopAudio: true,
  spatial: false,
  maxDistance: 100,
  refDistance: 1,
  rolloffFactor: 1,
  autoplay: true,
} as const;

/**
 * The asset name is also what lands in the entity's `assetId`, which is not an
 * asset id — see the header of `lib/audio/entityAudioGraph.ts` for why the
 * engine leaves us no way to supply one.
 */
export function generatedAudioAssetName(kind: GeneratedAudioKind, prompt: string): string {
  return `${kind}-${prompt.slice(0, 20)}`;
}

/** Returns the asset name the clip was imported under. */
export function attachGeneratedAudio({
  kind,
  prompt,
  audioBase64,
  entityId,
  sink,
}: AttachGeneratedAudioOptions): string {
  const assetName = generatedAudioAssetName(kind, prompt);
  sink.importAudio(audioBase64, assetName);

  if (entityId) {
    if (kind === 'music') {
      sink.setAudio(entityId, { assetId: assetName, pitch: 1.0, bus: 'music', ...MUSIC_DEFAULTS });
    } else {
      const spatial = getSpatialDefaults(kind === 'voice' ? 'voice' : inferSfxCategory(prompt));
      sink.setAudio(entityId, {
        assetId: assetName,
        volume: spatial.volume,
        pitch: 1.0,
        loopAudio: spatial.loopAudio,
        spatial: spatial.spatial,
        maxDistance: spatial.maxDistance,
        refDistance: spatial.refDistance,
        rolloffFactor: spatial.rolloffFactor,
        autoplay: false,
        bus: kind === 'voice' ? 'voice' : 'sfx',
      });
    }
  }

  return assetName;
}
