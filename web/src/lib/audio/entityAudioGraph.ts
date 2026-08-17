/**
 * Gets imported audio bytes, and per-entity `AudioData`, into the Web Audio graph.
 *
 * `audioManager` has always had the two halves of entity playback —
 * `loadBuffer` (decode bytes under an asset id) and `createInstance` (build the
 * gain/panner nodes for an entity) — and until now neither had a production
 * call site. Every `play_audio` the product could issue therefore took
 * `play()`'s `if (!instance)` branch and warned. This module is the missing
 * middle: it holds imported bytes until the engine names them, and it turns an
 * entity's `AudioData` into a real instance.
 *
 * TWO ID PROBLEMS MAKE THIS MORE THAN A FUNCTION CALL.
 *
 * 1. The engine does not echo the bytes back, and it does not let JS choose the
 *    asset id. `import_audio` carries `dataBase64`, but `ImportAudioPayload`
 *    declares only `name` (`engine/src/core/commands/scene.rs`), so the bytes
 *    are dropped on the floor and `apply_audio_import` mints a fresh
 *    `Uuid::new_v4()`. The only thing correlating the import with the resulting
 *    `ASSET_IMPORTED` event is the name the engine echoes back — hence the
 *    name-keyed queue below rather than a plain `Map<assetId, bytes>`.
 *
 * 2. `assetId` on an entity is not always an asset id. The generation handlers
 *    call `importAudio(base64, assetName)` and then `setAudio(entityId, {
 *    assetId: assetName })`, so the entity points at the human-readable name
 *    while the registry keys the uuid. `resolveAudioAssetId` bridges the two.
 *    Rewriting either side is an engine change (a stable, JS-supplied asset id)
 *    and is tracked separately; the alias is what makes the audio audible
 *    without one.
 *
 * The queue is bounded and take-once. Bounded by BOTH entry count and total
 * bytes, because an `ASSET_IMPORTED` that never arrives — a rejected file, a
 * dropped command — would otherwise pin whole decoded files in memory forever,
 * and 32 uncompressed WAVs is a count a byte budget would have refused. Take-
 * once because `decodeAudioData` DETACHES the `ArrayBuffer` it is handed: a
 * second decode of the same buffer fails, so an entry that is consumed must
 * leave.
 *
 * The alias is name-keyed, so re-importing a name already in use rebinds it to
 * the newer asset — which is what re-importing a file means everywhere else in
 * the asset panel. The byte queue is unaffected: same-named imports each get
 * their own id and their own bytes, in dispatch order. Entities already holding
 * an instance keep it, since instances are keyed by entity and are only rebuilt
 * when that entity's own `AudioData` changes.
 */

import type { AudioData } from '@/stores/slices/types';
import { audioManager } from './audioManager';

/**
 * How many decoded-but-unclaimed imports to hold. Imports are claimed within a
 * frame or two in practice; anything still queued past this many later imports
 * is one the engine never acknowledged.
 */
const MAX_PENDING_IMPORTS = 32;

/**
 * And how many bytes, which is the budget that actually matters: 32 entries is
 * a few hundred KB of MP3 or well over half a gigabyte of uncompressed WAV.
 */
const MAX_PENDING_BYTES = 64 * 1024 * 1024;

interface PendingImport {
  name: string;
  data: ArrayBuffer;
}

const pendingImports: PendingImport[] = [];

/** Import name → the asset id the engine minted for it. See problem 2 above. */
const assetIdByImportName = new Map<string, string>();

/**
 * Entity → the graph state last applied for it.
 *
 * `createInstance` destroys the previous instance and every layer attached to
 * it, so rebuilding on an unchanged component is not a no-op — it stops the
 * sound. The engine re-emits `AUDIO_CHANGED` on every selection change
 * (`emit_audio_on_selection`) and on every audio query, so clicking an entity
 * in the hierarchy during Play would otherwise tear down its own music.
 */
const appliedSignatures = new Map<string, string>();

/**
 * Decode a base64 payload into bytes, tolerating a `data:…;base64,` prefix.
 *
 * Returns `null` rather than throwing: this runs on the way to an engine
 * dispatch that must still happen, since the engine's copy of the asset
 * metadata is what the scene and the asset panel are built from. A clip whose
 * bytes we cannot decode should be a silent clip, not a failed import.
 *
 * The parameter is `unknown` because the callers upstream are generation
 * handlers reading a field off an HTTP response body. A provider can answer 200
 * with no artifact at all (see the documented provider-success-with-no-artifact
 * class), and `undefined.startsWith` is a `TypeError` thrown out of a store
 * action — not the silent clip this function promises.
 */
export function decodeBase64ToArrayBuffer(base64: unknown): ArrayBuffer | null {
  if (typeof base64 !== 'string') return null;
  const payload = base64.startsWith('data:') ? (base64.split(',')[1] ?? '') : base64;
  if (!payload) return null;
  try {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  } catch {
    // `atob` throws on a malformed payload. Same reasoning as above.
    return null;
  }
}

/** Hold an import's bytes until `ASSET_IMPORTED` names it. */
export function queueAudioImport(name: string, data: ArrayBuffer): void {
  pendingImports.push({ name, data });
  // Drop the OLDEST first, on either budget: an entry that has outlived this
  // many later imports is the one that was never going to be claimed. The
  // just-queued entry is always kept, even if it alone exceeds the byte
  // budget — dropping it would make a large import silently unimportable.
  let queuedBytes = pendingImports.reduce((total, entry) => total + entry.data.byteLength, 0);
  while (
    pendingImports.length > 1 &&
    (pendingImports.length > MAX_PENDING_IMPORTS || queuedBytes > MAX_PENDING_BYTES)
  ) {
    queuedBytes -= pendingImports.shift()!.data.byteLength;
  }
}

/**
 * Claim the earliest queued import under `name`, removing it.
 *
 * FIFO rather than a map because two files may legitimately share a name — the
 * engine mints a distinct id for each, and the events arrive in dispatch order.
 */
export function takeAudioImport(name: string): ArrayBuffer | null {
  const index = pendingImports.findIndex(entry => entry.name === name);
  if (index === -1) return null;
  return pendingImports.splice(index, 1)[0]!.data;
}

/** Record that `name` was imported as `assetId`. */
export function registerImportedAudioAsset(assetId: string, name: string): void {
  assetIdByImportName.set(name, assetId);
}

/**
 * Drop every alias pointing at a deleted asset, and the buffer it was decoded
 * into.
 *
 * Without the alias sweep the map only ever grows, and a name reused after its
 * asset was deleted would resolve to the dead id — handing `createInstance` an
 * id with no decoded buffer, i.e. a permanently silent entity.
 *
 * The buffer belongs here for the same reason and nowhere else: nothing ever
 * deleted from `audioManager`'s buffer map, so every clip a user imported and
 * then deleted stayed decoded for the life of the tab, and decoded PCM is much
 * larger than the file it came from. Asset deletion is the one moment the
 * buffer is provably unreachable — scene changes and Stop deliberately keep it
 * (see `resetEntityAudioGraphForScene`).
 */
export function forgetImportedAudioAsset(assetId: string): void {
  for (const [name, id] of assetIdByImportName) {
    if (id === assetId) assetIdByImportName.delete(name);
  }
  audioManager.releaseBuffer(assetId);
}

/**
 * Forget an entity's graph state so the next sync rebuilds it.
 *
 * Deleting an entity, or loading a new scene, leaves an instance connected to
 * the bus graph for the life of the tab; the engine emits no per-entity delete
 * event, so removal has to be driven from the JS side.
 */
export function releaseEntityAudio(entityId: string): void {
  appliedSignatures.delete(entityId);
  audioManager.destroyInstance(entityId);
}

/**
 * Map whatever an entity calls its clip onto the id the buffer is keyed under.
 * An id that is already an asset id passes through untouched.
 */
export function resolveAudioAssetId(idOrName: string): string {
  return assetIdByImportName.get(idOrName) ?? idOrName;
}

/**
 * Make the graph match one entity's `AudioData`.
 *
 * Rebuilds only when the entity's component actually differs from what is
 * already applied, because `createInstance` is destructive: it tears down the
 * previous instance AND every layer on it, stopping whatever was playing. The
 * engine re-emits `AUDIO_CHANGED` on selection and on query, so an unguarded
 * rebuild would silence an entity every time the user clicked it.
 *
 * `force` is for the one case where nothing about the component changed but the
 * graph did: the buffer finished decoding after the component arrived, so the
 * earlier `createInstance` bailed on a missing buffer and has to be re-run.
 */
export function syncEntityAudioInstance(
  entityId: string,
  audio: AudioData | null,
  options?: { force?: boolean }
): void {
  const assetId = audio && audio.assetId !== null ? resolveAudioAssetId(audio.assetId) : null;
  const signature = assetId === null ? 'none' : `${assetId} ${JSON.stringify(audio)}`;
  if (!options?.force && appliedSignatures.get(entityId) === signature) return;
  appliedSignatures.set(entityId, signature);

  if (assetId === null || !audio) {
    audioManager.destroyInstance(entityId);
    return;
  }
  audioManager.createInstance(entityId, assetId, audio);
}

/**
 * Re-create instances for every entity pointing at `assetId`.
 *
 * The ordering that needs this: a scene loads (entities get their `AudioData`
 * before any buffer exists), or an entity is assigned a clip that is still
 * decoding. Without it, whichever of the two arrived first would be the one
 * that silently lost.
 */
export function syncEntitiesUsingAudioAsset(
  assetId: string,
  entityAudio: Record<string, AudioData>
): void {
  for (const [entityId, audio] of Object.entries(entityAudio)) {
    if (audio.assetId !== null && resolveAudioAssetId(audio.assetId) === assetId) {
      // Forced: the component is unchanged — the buffer is what just arrived.
      syncEntityAudioInstance(entityId, audio, { force: true });
    }
  }
}

/**
 * Claim an import's bytes, decode them under the engine's asset id, and wire up
 * every entity already pointing at it.
 *
 * `getEntityAudio` is a getter rather than a store import on purpose: this
 * module is plain library code, and a value-import of `@/stores/` from `lib/`
 * is the module edge that broke `next build` in PF-1118. A function carries no
 * such edge.
 */
export async function ingestImportedAudioAsset(
  assetId: string,
  name: string,
  getEntityAudio: () => Record<string, AudioData>
): Promise<void> {
  const data = takeAudioImport(name);
  // No queued bytes is the normal case for an asset the engine reports but JS
  // never imported — a scene load, say. Nothing to decode, nothing to warn about.
  if (!data) return;

  registerImportedAudioAsset(assetId, name);
  try {
    await audioManager.loadBuffer(assetId, data);
  } catch {
    // `loadBuffer` has already logged the decode failure with the asset id.
    // Rethrowing here would surface as an unhandled rejection in the event
    // handler that has no way to act on it.
    return;
  }
  syncEntitiesUsingAudioAsset(assetId, getEntityAudio());
}

/**
 * Drop every queued import, name alias, and applied-graph record.
 *
 * The whole module's state, for tests between cases. Scene load wants the
 * narrower `resetEntityAudioGraphForScene` — see the note there.
 */
export function resetEntityAudioGraph(): void {
  pendingImports.length = 0;
  assetIdByImportName.clear();
  appliedSignatures.clear();
}

/**
 * Scene load: drop everything keyed by an entity, keep everything keyed by an
 * asset.
 *
 * The alias map is deliberately NOT cleared here. It is asset-lifetime state,
 * not scene-lifetime state, and it is already torn down at the right moment —
 * `forgetImportedAudioAsset` on `ASSET_DELETED`. Clearing it on scene load
 * silently un-plays every AI-attached clip: `audioManager.destroyAll` destroys
 * instances and one-shots but never touches its decoded buffers, so the buffer
 * survives under its uuid and the asset survives in the registry, while the
 * name→uuid alias that is the only bridge between them is gone. Every entity
 * whose `assetId` is an import name (which is every clip the generation
 * handlers attach — see problem 2 at the top of this file) then resolves to a
 * name `createInstance` has no buffer for, and is permanently silent.
 */
export function resetEntityAudioGraphForScene(): void {
  audioManager.destroyAll();
  pendingImports.length = 0;
  appliedSignatures.clear();
}
