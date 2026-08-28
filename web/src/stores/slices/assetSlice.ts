/**
 * Asset slice - manages asset registry and texture loading.
 */

import { StateCreator } from 'zustand';
import { decodeBase64ToArrayBuffer, queueAudioImport } from '@/lib/audio/entityAudioGraph';
import type { AssetMetadata } from './types';

export interface AssetSlice {
  assetRegistry: Record<string, AssetMetadata>;

  importGltf: (dataBase64: string, name: string, targetEntityId?: string) => void;
  loadTexture: (dataBase64: string, name: string, entityId: string, slot: string) => void;
  removeTexture: (entityId: string, slot: string) => void;
  importAudio: (dataBase64: string, name: string) => void;
  placeAsset: (assetId: string) => void;
  deleteAsset: (assetId: string) => void;
  setAssetRegistry: (assets: Record<string, AssetMetadata>) => void;
  addAssetToRegistry: (asset: AssetMetadata) => void;
  removeAssetFromRegistry: (assetId: string) => void;
}

let dispatchCommand: ((command: string, payload: unknown) => void) | null = null;

export function setAssetDispatcher(dispatcher: (command: string, payload: unknown) => void): void {
  dispatchCommand = dispatcher;
}

export const createAssetSlice: StateCreator<AssetSlice, [], [], AssetSlice> = (set, get) => ({
  assetRegistry: {},

  importGltf: (dataBase64, name, targetEntityId) => {
    // Conditional spread: when no target is supplied (or it's an empty string),
    // the payload is byte-identical to the original { dataBase64, name } so existing
    // callers and tests are unaffected. When present, the engine replaces that
    // entity's model/mesh in place instead of spawning a new root.
    if (dispatchCommand) {
      dispatchCommand('import_gltf', {
        dataBase64,
        name,
        ...(targetEntityId ? { targetEntityId } : {}),
      });
    }
  },
  loadTexture: (dataBase64, name, entityId, slot) => {
    if (dispatchCommand) dispatchCommand('load_texture', { dataBase64, name, entityId, slot });
  },
  removeTexture: (entityId, slot) => {
    if (dispatchCommand) dispatchCommand('remove_texture', { entityId, slot });
  },
  importAudio: (dataBase64, name) => {
    // The engine receives `dataBase64` to validate the payload and record its
    // decoded size, while playback remains JS-side. Hold the bytes until
    // `ASSET_IMPORTED` names the asset id the engine minted, then
    // `ingestImportedAudioAsset` decodes them under that id.
    //
    // Queued only when the dispatch actually happens: the queue is drained by
    // `ASSET_IMPORTED`, which only ever arrives in response to this command, so
    // queueing without dispatching leaves an entry that nothing can claim —
    // occupying one of the FIFO's slots until it is evicted by real imports.
    if (!dispatchCommand) return;
    const bytes = decodeBase64ToArrayBuffer(dataBase64);
    if (bytes) queueAudioImport(name, bytes);
    dispatchCommand('import_audio', { dataBase64, name });
  },
  placeAsset: (assetId) => {
    if (dispatchCommand) dispatchCommand('place_asset', { assetId });
  },
  deleteAsset: (assetId) => {
    set(state => {
      const { [assetId]: _, ...rest } = state.assetRegistry;
      return { assetRegistry: rest };
    });
    if (dispatchCommand) dispatchCommand('delete_asset', { assetId });
  },
  setAssetRegistry: (assets) => set({ assetRegistry: assets }),
  addAssetToRegistry: (asset) => {
    const state = get();
    set({ assetRegistry: { ...state.assetRegistry, [asset.id]: asset } });
  },
  removeAssetFromRegistry: (assetId) => {
    set(state => {
      const { [assetId]: _, ...rest } = state.assetRegistry;
      return { assetRegistry: rest };
    });
  },
});
