/**
 * Material, lighting, shader, and environment handlers.
 */

import { z } from 'zod';
import type { ToolHandler, MaterialData, LightData } from './types';
import { zEntityId, zVec3, parseArgs } from './types';
import { parseHandlerArgs } from '@/lib/validation/parseArgs';
import { entityId, boundedString } from '@/lib/validation/validators';
import { getPresetById } from '@/lib/materialPresets';

// Accepted update keys follow the declared engine schema, even for partial snapshots.
const MATERIAL_UPDATE_FIELDS = {
  baseColor: true,
  metallic: true,
  perceptualRoughness: true,
  reflectance: true,
  emissive: true,
  emissiveExposureWeight: true,
  alphaMode: true,
  alphaCutoff: true,
  doubleSided: true,
  unlit: true,
  baseColorTexture: true,
  normalMapTexture: true,
  metallicRoughnessTexture: true,
  emissiveTexture: true,
  occlusionTexture: true,
  uvOffset: true,
  uvScale: true,
  uvRotation: true,
  depthMapTexture: true,
  parallaxDepthScale: true,
  parallaxMappingMethod: true,
  maxParallaxLayerCount: true,
  parallaxReliefMaxSteps: true,
  clearcoat: true,
  clearcoatPerceptualRoughness: true,
  clearcoatTexture: true,
  clearcoatRoughnessTexture: true,
  clearcoatNormalTexture: true,
  specularTransmission: true,
  diffuseTransmission: true,
  ior: true,
  thickness: true,
  attenuationDistance: true,
  attenuationColor: true,
} satisfies Record<keyof MaterialData, true>;

const LIGHT_UPDATE_FIELDS = {
  lightType: true,
  color: true,
  intensity: true,
  shadowsEnabled: true,
  shadowDepthBias: true,
  shadowNormalBias: true,
  range: true,
  radius: true,
  innerAngle: true,
  outerAngle: true,
} satisfies Record<keyof LightData, true>;

/** Longest slice of a refused value echoed back in the error text. */
const MAX_ECHOED_VALUE_CHARS = 64;

/**
 * The engine's `update_material` keeps an explicit `attenuationDistance`
 * number only when it is finite and >= 0 AFTER narrowing to f32
 * (`is_valid_attenuation_distance`, engine/src/core/material.rs); infinity is
 * spelled `null`. It refuses anything else, and refuses the WHOLE update, so a
 * value the engine will drop has to be caught here, before
 * `store.updateMaterial` writes the material optimistically and the assistant
 * reports a success the engine never applied (#10267). `Math.fround` performs
 * the same round-to-nearest narrowing as serde's f64 -> f32 cast, so `1e300`
 * (finite in JS, `inf` in the engine) is refused here as it is there.
 */
function attenuationDistanceError(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value === 'number' && value >= 0 && Number.isFinite(Math.fround(value))) {
    return null;
  }
  let shown: string;
  if (typeof value === 'number') {
    shown = String(value);
  } else {
    try {
      shown = JSON.stringify(value) ?? String(value);
    } catch {
      shown = typeof value;
    }
  }
  if (shown.length > MAX_ECHOED_VALUE_CHARS) {
    shown = `${shown.slice(0, MAX_ECHOED_VALUE_CHARS)}…`;
  }
  return `attenuationDistance must be a finite number >= 0, got ${shown}; send null for infinity`;
}

export const materialHandlers: Record<string, ToolHandler> = {
  update_material: async (args, { store }) => {
    const p = parseArgs(z.object({ entityId: zEntityId }), args);
    if (p.error) return p.error;
    // Build a partial material, merge with current if available
    const matInput = { ...args } as Record<string, unknown>;
    delete matInput.entityId;

    // An absent key (or `undefined`, which never reaches the engine) keeps the
    // merged value; only a value the caller actually sent is checked.
    if (matInput.attenuationDistance !== undefined) {
      const error = attenuationDistanceError(matInput.attenuationDistance);
      if (error) return { success: false, error };
    }

    // Get current material as base, overlay with provided fields
    const baseMaterial: MaterialData = store.primaryMaterial ?? {
      baseColor: [1, 1, 1, 1],
      metallic: 0,
      perceptualRoughness: 0.5,
      reflectance: 0.5,
      emissive: [0, 0, 0, 1],
      emissiveExposureWeight: 1,
      alphaMode: 'opaque',
      alphaCutoff: 0.5,
      doubleSided: false,
      unlit: false,
      uvOffset: [0, 0],
      uvScale: [1, 1],
      uvRotation: 0,
      parallaxDepthScale: 0.1,
      parallaxMappingMethod: 'occlusion',
      maxParallaxLayerCount: 16,
      parallaxReliefMaxSteps: 5,
      clearcoat: 0,
      clearcoatPerceptualRoughness: 0.5,
      specularTransmission: 0,
      diffuseTransmission: 0,
      ior: 1.5,
      thickness: 0,
      attenuationDistance: null,
      attenuationColor: [1, 1, 1],
    };

    const merged: MaterialData = { ...baseMaterial };
    for (const [key, value] of Object.entries(matInput)) {
      if (Object.hasOwn(MATERIAL_UPDATE_FIELDS, key)) {
        (merged as unknown as Record<string, unknown>)[key] = value;
      }
    }

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
      if (Object.hasOwn(LIGHT_UPDATE_FIELDS, key)) {
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
