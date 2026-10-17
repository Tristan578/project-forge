/**
 * Asset pipeline handlers: glTF import, texture load/remove, asset placement/deletion, audio import.
 */

import { z } from 'zod';
import { checkTexturePayload } from '@/lib/engine/textureFormatGuard';
import type { ToolHandler } from './types';
import { zEntityId, parseArgs } from './types';

/**
 * A store answer of `{ success: false }` is the engine's (or the format
 * gate's) refusal, relayed to the model verbatim so it can act on it. Test
 * doubles that return nothing are not reporting failure.
 */
function refusedBy(outcome: { success: boolean; error?: string } | undefined): string | null {
  if (!outcome || outcome.success !== false) return null;
  return outcome.error ?? 'The engine rejected the change.';
}

export const assetHandlers: Record<string, ToolHandler> = {
  import_gltf: async (args, { store }) => {
    const p = parseArgs(z.object({
      dataBase64: z.string().min(1),
      name: z.string().min(1),
      // Optional: replace this existing entity's model in place instead of spawning new.
      targetEntityId: z.string().min(1).optional(),
    }), args);
    if (p.error) return p.error;
    // The engine refuses a model whose images are KTX2 or Basis Universal, or
    // a file it cannot read, before queueing it (#10396); the reason names the
    // image and what to convert it to.
    const refusal = refusedBy(store.importGltf(p.data.dataBase64, p.data.name, p.data.targetEntityId));
    if (refusal !== null) return { success: false, error: refusal };
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
    // Checked before the store is touched, so this tool never reports success
    // for a texture the engine will refuse (#10396): only PNG and JPEG are
    // accepted, and the error names them.
    const check = checkTexturePayload(p.data.dataBase64);
    if (!check.ok) return { success: false, error: check.error };
    const refusal = refusedBy(store.loadTexture(p.data.dataBase64, p.data.name, p.data.entityId, p.data.slot));
    if (refusal !== null) return { success: false, error: refusal };
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
