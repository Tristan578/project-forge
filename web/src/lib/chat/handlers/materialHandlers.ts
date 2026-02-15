/**
 * Material, lighting, shader, and environment handlers.
 */

import type { ToolHandler, MaterialData, LightData } from './types';
// Import helpers (currently unused as defaults are inlined, but available if needed)
// import { buildMaterialFromPartial, buildLightFromPartial } from './helpers';
import { getPresetById } from '@/lib/materialPresets';

export const materialHandlers: Record<string, ToolHandler> = {
  update_material: async (args, { store }) => {
    const entityId = args.entityId as string;
    // Build a partial material, merge with current if available
    const matInput = { ...args } as Record<string, unknown>;
    delete matInput.entityId;

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
      (merged as unknown as Record<string, unknown>)[key] = value;
    }

    store.updateMaterial(entityId, merged);
    return { success: true };
  },

  apply_material_preset: async (args, { store }) => {
    const entityId = args.entityId as string;
    const presetId = args.presetId as string;
    const preset = getPresetById(presetId);
    if (!preset) {
      return { success: false, error: `Unknown material preset: ${presetId}` };
    }
    store.updateMaterial(entityId, preset.data);
    return { success: true };
  },

  set_custom_shader: async (args, { store }) => {
    const { entityId, shaderType, ...params } = args;
    store.updateShaderEffect(entityId as string, { shaderType: shaderType as string, ...params as Record<string, unknown> } as Parameters<typeof store.updateShaderEffect>[1]);
    return { success: true, result: { message: `Applied ${shaderType} shader to ${entityId}` } };
  },

  remove_custom_shader: async (args, { store }) => {
    const { entityId } = args;
    store.removeShaderEffect(entityId as string);
    return { success: true, result: { message: `Removed custom shader from ${entityId}` } };
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
    const entityId = args.entityId as string;
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

    store.updateLight(entityId, merged);
    return { success: true };
  },

  update_ambient_light: async (args, { store }) => {
    const partial: Record<string, unknown> = {};
    if (args.color !== undefined) partial.color = args.color;
    if (args.brightness !== undefined) partial.brightness = args.brightness;
    store.updateAmbientLight(partial);
    return { success: true };
  },

  update_environment: async (args, { store }) => {
    store.updateEnvironment(args as Record<string, unknown>);
    return { success: true };
  },

  set_skybox: async (args, { store }) => {
    if (args.preset) {
      store.setSkybox(args.preset as string);
    }
    return { success: true };
  },

  remove_skybox: async (args, { store }) => {
    store.removeSkybox();
    return { success: true };
  },

  update_skybox: async (args, { store }) => {
    store.updateSkybox(args as { brightness?: number; iblIntensity?: number; rotation?: number });
    return { success: true };
  },

  set_custom_skybox: async (_args) => {
    // This command exists in MCP manifest but implementation is TODO
    return { success: true, result: { message: 'Custom skybox generation will be handled by AI asset generation' } };
  },

  update_post_processing: async (args, { store }) => {
    store.updatePostProcessing(args as Record<string, unknown>);
    return { success: true };
  },

  get_post_processing: async (args, { store }) => {
    return { success: true, result: store.postProcessing };
  },
};
