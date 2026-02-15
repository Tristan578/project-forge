/**
 * Asset slice - manages asset registry and texture loading.
 * TODO: Extract full implementation from editorStore.ts
 */

import { StateCreator } from 'zustand';
import type { AssetMetadata } from './types';

export interface AssetSlice {
  assetRegistry: Record<string, AssetMetadata>;

  importGltf: (dataBase64: string, name: string) => void;
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

  importGltf: (dataBase64, name) => {
    if (dispatchCommand) dispatchCommand('import_gltf', { dataBase64, name });
  },
  loadTexture: (dataBase64, name, entityId, slot) => {
    if (dispatchCommand) dispatchCommand('load_texture', { dataBase64, name, entityId, slot });
  },
  removeTexture: (entityId, slot) => {
    if (dispatchCommand) dispatchCommand('remove_texture', { entityId, slot });
  },
  importAudio: (dataBase64, name) => {
    if (dispatchCommand) dispatchCommand('import_audio', { dataBase64, name });
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
