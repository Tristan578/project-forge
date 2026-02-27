/**
 * Asset pipeline handlers: glTF import, texture load/remove, asset placement/deletion, audio import.
 */

import type { ToolHandler } from './types';

export const assetHandlers: Record<string, ToolHandler> = {
  import_gltf: async (args, { store }) => {
    const dataBase64 = args.dataBase64 as string;
    const name = args.name as string;
    if (!dataBase64 || !name) return { success: false, error: 'Missing dataBase64 or name' };
    store.importGltf(dataBase64, name);
    return { success: true, result: { message: `Importing glTF: ${name}` } };
  },

  load_texture: async (args, { store }) => {
    const dataBase64 = args.dataBase64 as string;
    const name = args.name as string;
    const entityId = args.entityId as string;
    const slot = args.slot as string;
    if (!dataBase64 || !name || !entityId || !slot) return { success: false, error: 'Missing required parameters' };
    store.loadTexture(dataBase64, name, entityId, slot);
    return { success: true, result: { message: `Loading texture: ${name} → ${slot}` } };
  },

  remove_texture: async (args, { store }) => {
    const entityId = args.entityId as string;
    const slot = args.slot as string;
    if (!entityId || !slot) return { success: false, error: 'Missing entityId or slot' };
    store.removeTexture(entityId, slot);
    return { success: true, result: { message: `Removed texture from ${slot}` } };
  },

  place_asset: async (args, { store }) => {
    const assetId = args.assetId as string;
    if (!assetId) return { success: false, error: 'Missing assetId' };
    store.placeAsset(assetId);
    return { success: true, result: { message: `Placing asset: ${assetId}` } };
  },

  delete_asset: async (args, { store }) => {
    const assetId = args.assetId as string;
    if (!assetId) return { success: false, error: 'Missing assetId' };
    store.deleteAsset(assetId);
    return { success: true, result: { message: `Deleted asset: ${assetId}` } };
  },

  list_assets: async (_args, { store }) => {
    const assets = Object.values(store.assetRegistry);
    return {
      success: true,
      result: {
        assets: assets.map((a) => ({ id: a.id, name: a.name, kind: a.kind, fileSize: a.fileSize })),
        count: assets.length,
      },
    };
  },

  import_audio: async (args, { store }) => {
    const dataBase64 = args.dataBase64 as string;
    const name = args.name as string;
    if (!dataBase64 || !name) return { success: false, error: 'Missing dataBase64 or name' };
    store.importAudio(dataBase64, name);
    return { success: true, result: { message: `Importing audio: ${name}` } };
  },
};
