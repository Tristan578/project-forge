/**
 * Material, lighting, shader, and environment handlers.
 */

import { z } from 'zod';
import type { ToolHandler, LightData } from './types';
import { zEntityId, zVec3, parseArgs } from './types';
import { parseHandlerArgs } from '@/lib/validation/parseArgs';
import { entityId, boundedString } from '@/lib/validation/validators';
import { getPresetById } from '@/lib/materialPresets';
import { buildMaterialFromPartial } from './helpers';

export const materialHandlers: Record<string, ToolHandler> = {
  update_material: async (args, { store }) => {
    const p = parseArgs(z.object({ entityId: zEntityId }), args);
    if (p.error) return p.error;
    // Build a partial material, merge with current if available
    const matInput = { ...args } as Record<string, unknown>;
    delete matInput.entityId;

    // Merge incoming fields over current material, then validate with buildMaterialFromPartial
    const baseMaterial = store.primaryMaterial ?? {};
    const merged = buildMaterialFromPartial({ ...baseMaterial, ...matInput });

    store.updateMaterial(p.data.entityId, merged);
    return { success: true };
  },

  // Uses shared validation framework (parseHandlerArgs) instead of Zod
  apply_material_preset: async (args, { store }) => {
    const p = parseHandlerArgs(args, {
      entityId: { validate: entityId() },
      presetId: { validate: boundedString(1, 128) },
    });
    if (p.error) return p.error;
    const preset = getPresetById(p.data.presetId);
    if (!preset) {
      return { success: false, error: `Unknown material preset: ${p.data.presetId}` };
    }
    store.updateMaterial(p.data.entityId, preset.data);
    return { success: true };
  },

  set_custom_shader: async (args, { store }) => {
    const p = parseArgs(z.object({ entityId: zEntityId, shaderType: z.string().min(1) }), args);
    if (p.error) return p.error;
    const params = { ...args } as Record<string, unknown>;
    delete params.entityId;
    store.updateShaderEffect(p.data.entityId, { shaderType: p.data.shaderType, ...params } as Parameters<typeof store.updateShaderEffect>[1]);
    return { success: true, result: { message: `Applied ${p.data.shaderType} shader to ${p.data.entityId}` } };
  },

  remove_custom_shader: async (args, { store }) => {
    const p = parseArgs(z.object({ entityId: zEntityId }), args);
    if (p.error) return p.error;
    store.removeShaderEffect(p.data.entityId);
    return { success: true, result: { message: `Removed custom shader from ${p.data.entityId}` } };
  },

  list_shaders: async (_args, _ctx) => {
    const shaders = [
      { type: 'dissolve', name: 'Dissolve', description: 'Dissolve / burn away effect with glowing edges' },
      { type: 'hologram', name: 'Hologram', description: 'Holographic scan lines with transparency' },
      { type: 'force_field', name: 'Force Field', description: 'Energy shield with Fresnel glow and noise' },
      { type: 'lava_flow', name: 'Lava / Flow', description: 'Flowing liquid with scrolling UVs and distortion' },
      { type: 'toon', name: 'Toon', description: 'Cel-shaded cartoon bands' },
      { type: 'fresnel_glow', name: 'Fresnel Glow', description: 'Rim lighting glow effect' },
    ];
    return { success: true, result: { shaders, count: shaders.length } };
  },

  update_light: async (args, { store }) => {
    const p = parseArgs(z.object({ entityId: zEntityId }), args);
    if (p.error) return p.error;
    const lightInput = { ...args } as Record<string, unknown>;
    delete lightInput.entityId;

    const baseLight: LightData = store.primaryLight ?? {
      lightType: 'point',
      color: [1, 1, 1],
      intensity: 800,
      shadowsEnabled: false,
      shadowDepthBias: 0.02,
      shadowNormalBias: 1.8,
      range: 20,
      radius: 0,
      innerAngle: 0.4,
      outerAngle: 0.8,
    };

    const merged: LightData = { ...baseLight };
    for (const [key, value] of Object.entries(lightInput)) {
      if (key in merged) {
        (merged as unknown as Record<string, unknown>)[key] = value;
      }
    }

    store.updateLight(p.data.entityId, merged);
    return { success: true };
  },

  update_ambient_light: async (args, { store }) => {
    const p = parseArgs(z.object({ color: zVec3.optional(), brightness: z.number().optional() }), args);
    if (p.error) return p.error;
    const partial: Record<string, unknown> = {};
    if (p.data.color !== undefined) partial.color = p.data.color;
    if (p.data.brightness !== undefined) partial.brightness = p.data.brightness;
    store.updateAmbientLight(partial);
    return { success: true };
  },

  update_environment: async (args, { store }) => {
    store.updateEnvironment(args as Record<string, unknown>);
    return { success: true };
  },

  set_skybox: async (args, { store }) => {
    const p = parseArgs(z.object({ preset: z.string().min(1).optional() }), args);
    if (p.error) return p.error;
    if (p.data.preset) {
      store.setSkybox(p.data.preset);
    }
    return { success: true };
  },

  remove_skybox: async (_args, { store }) => {
    store.removeSkybox();
    return { success: true };
  },

  update_skybox: async (args, { store }) => {
    const p = parseArgs(z.object({ brightness: z.number().optional(), iblIntensity: z.number().optional(), rotation: z.number().optional() }), args);
    if (p.error) return p.error;
    store.updateSkybox(p.data);
    return { success: true };
  },

  set_custom_skybox: async (args, { store }) => {
    const p = parseArgs(z.object({ assetId: z.string().min(1), dataBase64: z.string().min(1) }), args);
    if (p.error) return p.error;
    store.setCustomSkybox(p.data.assetId, p.data.dataBase64);
    return { success: true };
  },

  update_post_processing: async (args, { store }) => {
    store.updatePostProcessing(args as Record<string, unknown>);
    return { success: true };
  },

  get_post_processing: async (_args, { store }) => {
    return { success: true, result: store.postProcessing };
  },
};
