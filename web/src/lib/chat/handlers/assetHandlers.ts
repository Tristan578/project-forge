/**
 * Asset pipeline handlers: glTF import, texture load/remove, asset placement/deletion, audio import.
 */

import { z } from 'zod';
import type { ToolHandler } from './types';
import { zEntityId, parseArgs } from './types';

export const assetHandlers: Record<string, ToolHandler> = {
  import_gltf: async (args, { store }) => {
    const p = parseArgs(z.object({ dataBase64: z.string().min(1), name: z.string().min(1) }), args);
    if (p.error) return p.error;
    store.importGltf(p.data.dataBase64, p.data.name);
    return { success: true, result: { message: `Importing glTF: ${p.data.name}` } };
  },

  load_texture: async (args, { store }) => {
    const p = parseArgs(z.object({
      dataBase64: z.string().min(1),
      name: z.string().min(1),
      entityId: zEntityId,
      slot: z.string().min(1),
    }), args);
    if (p.error) return p.error;
    store.loadTexture(p.data.dataBase64, p.data.name, p.data.entityId, p.data.slot);
    return { success: true, result: { message: `Loading texture: ${p.data.name} → ${p.data.slot}` } };
  },

  remove_texture: async (args, { store }) => {
    const p = parseArgs(z.object({ entityId: zEntityId, slot: z.string().min(1) }), args);
    if (p.error) return p.error;
    store.removeTexture(p.data.entityId, p.data.slot);
    return { success: true, result: { message: `Removed texture from ${p.data.slot}` } };
  },

  place_asset: async (args, { store }) => {
    const p = parseArgs(z.object({ assetId: z.string().min(1) }), args);
    if (p.error) return p.error;
    store.placeAsset(p.data.assetId);
    return { success: true, result: { message: `Placing asset: ${p.data.assetId}` } };
  },

  delete_asset: async (args, { store }) => {
    const p = parseArgs(z.object({ assetId: z.string().min(1) }), args);
    if (p.error) return p.error;
    store.deleteAsset(p.data.assetId);
    return { success: true, result: { message: `Deleted asset: ${p.data.assetId}` } };
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
    const p = parseArgs(z.object({ dataBase64: z.string().min(1), name: z.string().min(1) }), args);
    if (p.error) return p.error;
    store.importAudio(p.data.dataBase64, p.data.name);
    return { success: true, result: { message: `Importing audio: ${p.data.name}` } };
  },
};
