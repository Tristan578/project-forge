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
 * The queue is bounded and take-once. Bounded because an `ASSET_IMPORTED` that
 * never arrives — a rejected file, a dropped command — would otherwise pin
 * whole decoded files in memory forever. Take-once because `decodeAudioData`
 * DETACHES the `ArrayBuffer` it is handed: a second decode of the same buffer
 * fails, so an entry that is consumed must leave.
 */

import type { AudioData } from '@/stores/slices/types';
import { audioManager } from './audioManager';

/**
 * How many decoded-but-unclaimed imports to hold. Imports are claimed within a
 * frame or two in practice; anything still queued past this many later imports
 * is one the engine never acknowledged.
 */
const MAX_PENDING_IMPORTS = 32;

interface PendingImport {
  name: string;
  data: ArrayBuffer;
}

const pendingImports: PendingImport[] = [];

/** Import name → the asset id the engine minted for it. See problem 2 above. */
const assetIdByImportName = new Map<string, string>();

/**
 * Decode a base64 payload into bytes, tolerating a `data:…;base64,` prefix.
 *
 * Returns `null` rather than throwing: this runs on the way to an engine
 * dispatch that must still happen, since the engine's copy of the asset
 * metadata is what the scene and the asset panel are built from. A clip whose
 * bytes we cannot decode should be a silent clip, not a failed import.
 */
export function decodeBase64ToArrayBuffer(base64: string): ArrayBuffer | null {
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
  // Drop the OLDEST first: an entry that has outlived this many later imports
  // is the one that was never going to be claimed.
  while (pendingImports.length > MAX_PENDING_IMPORTS) {
    pendingImports.shift();
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
 * Map whatever an entity calls its clip onto the id the buffer is keyed under.
 * An id that is already an asset id passes through untouched.
 */
export function resolveAudioAssetId(idOrName: string): string {
  return assetIdByImportName.get(idOrName) ?? idOrName;
}

/**
 * Make the graph match one entity's `AudioData`.
 *
 * Creating an instance is idempotent from the caller's side — `createInstance`
 * destroys any previous one — so this is safe to call on every `AUDIO_CHANGED`.
 * If the buffer has not been decoded yet, `createInstance` warns and returns;
 * `syncEntitiesUsingAudioAsset` re-runs it once the bytes land.
 */
export function syncEntityAudioInstance(entityId: string, audio: AudioData | null): void {
  if (!audio || audio.assetId === null) {
    audioManager.destroyInstance(entityId);
    return;
  }
  audioManager.createInstance(entityId, resolveAudioAssetId(audio.assetId), audio);
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
      syncEntityAudioInstance(entityId, audio);
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

/** Test seam: drop all queued imports and name aliases. */
export function resetEntityAudioGraph(): void {
  pendingImports.length = 0;
  assetIdByImportName.clear();
}
