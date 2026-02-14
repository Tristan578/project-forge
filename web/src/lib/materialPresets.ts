import type { MaterialData } from '@/stores/editorStore';

export type MaterialCategory = 'basic' | 'metal' | 'natural' | 'glass' | 'special' | 'fabric' | 'plastic' | 'stone' | 'wood';

export interface MaterialPreset {
  id: string;
  name: string;
  category: MaterialCategory;
  description: string;
  tags: string[];
  data: MaterialData;
}

/** Default MaterialData values used as base for all presets. */
function d(): MaterialData {
  return {
    baseColor: [0.5, 0.5, 0.5, 1.0],
    metallic: 0.0,
    perceptualRoughness: 0.5,
    reflectance: 0.5,
    emissive: [0.0, 0.0, 0.0, 1.0],
    emissiveExposureWeight: 0.0,
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
}

export const MATERIAL_PRESETS: MaterialPreset[] = [
  // ══════════════ BASIC (6) ══════════════
  {
    id: 'default_gray', name: 'Default Gray', category: 'basic',
    description: 'Standard neutral gray material',
    tags: ['neutral', 'default', 'gray'],
    data: { ...d() },
  },
  {
    id: 'matte_white', name: 'Matte White', category: 'basic',
    description: 'Flat white, low reflectance',
    tags: ['white', 'flat', 'matte'],
    data: { ...d(), baseColor: [0.9, 0.9, 0.9, 1], perceptualRoughness: 0.8 },
  },
  {
    id: 'matte_black', name: 'Matte Black', category: 'basic',
    description: 'Deep matte black surface',
    tags: ['black', 'dark', 'matte'],
    data: { ...d(), baseColor: [0.05, 0.05, 0.05, 1], perceptualRoughness: 0.9 },
  },
  {
    id: 'chalk_white', name: 'Chalk White', category: 'basic',
    description: 'Powdery white chalk surface',
    tags: ['white', 'chalk', 'powder'],
    data: { ...d(), baseColor: [0.95, 0.94, 0.92, 1], perceptualRoughness: 0.95 },
  },
  {
    id: 'clay', name: 'Clay', category: 'basic',
    description: 'Warm terracotta clay',
    tags: ['warm', 'earth', 'terracotta'],
    data: { ...d(), baseColor: [0.72, 0.45, 0.3, 1], perceptualRoughness: 0.85 },
  },
  {
    id: 'plastic_basic', name: 'Plastic', category: 'basic',
    description: 'Smooth non-metallic plastic',
    tags: ['smooth', 'plastic', 'basic'],
    data: { ...d(), baseColor: [0.9, 0.9, 0.9, 1], perceptualRoughness: 0.5, reflectance: 0.5 },
  },

  // ══════════════ METAL (10) ══════════════
  {
    id: 'polished_metal', name: 'Polished Metal', category: 'metal',
    description: 'Mirror-like metallic surface',
    tags: ['shiny', 'mirror', 'reflective'],
    data: { ...d(), baseColor: [0.85, 0.85, 0.87, 1], perceptualRoughness: 0.1, metallic: 1.0 },
  },
  {
    id: 'brushed_metal', name: 'Brushed Metal', category: 'metal',
    description: 'Slightly rough industrial metal',
    tags: ['industrial', 'brushed', 'rough'],
    data: { ...d(), baseColor: [0.6, 0.6, 0.62, 1], perceptualRoughness: 0.4, metallic: 0.9 },
  },
  {
    id: 'gold', name: 'Gold', category: 'metal',
    description: 'Warm gold metallic',
    tags: ['gold', 'warm', 'precious', 'shiny'],
    data: { ...d(), baseColor: [1.0, 0.766, 0.336, 1], perceptualRoughness: 0.2, metallic: 1.0 },
  },
  {
    id: 'silver', name: 'Silver', category: 'metal',
    description: 'Cool silver metallic',
    tags: ['silver', 'cool', 'precious', 'shiny'],
    data: { ...d(), baseColor: [0.97, 0.96, 0.91, 1], perceptualRoughness: 0.15, metallic: 1.0 },
  },
  {
    id: 'copper', name: 'Copper', category: 'metal',
    description: 'Warm reddish copper',
    tags: ['copper', 'warm', 'red'],
    data: { ...d(), baseColor: [0.95, 0.64, 0.54, 1], perceptualRoughness: 0.25, metallic: 1.0 },
  },
  {
    id: 'bronze', name: 'Bronze', category: 'metal',
    description: 'Aged bronze with patina',
    tags: ['bronze', 'aged', 'warm'],
    data: { ...d(), baseColor: [0.8, 0.5, 0.2, 1], perceptualRoughness: 0.4, metallic: 0.85 },
  },
  {
    id: 'iron', name: 'Iron', category: 'metal',
    description: 'Dark raw iron',
    tags: ['iron', 'dark', 'heavy', 'industrial'],
    data: { ...d(), baseColor: [0.35, 0.33, 0.31, 1], perceptualRoughness: 0.5, metallic: 0.9 },
  },
  {
    id: 'chrome', name: 'Chrome', category: 'metal',
    description: 'Highly reflective chrome plating',
    tags: ['chrome', 'mirror', 'reflective', 'shiny'],
    data: { ...d(), baseColor: [0.95, 0.93, 0.88, 1], perceptualRoughness: 0.05, metallic: 1.0 },
  },
  {
    id: 'titanium', name: 'Titanium', category: 'metal',
    description: 'Light gray titanium',
    tags: ['titanium', 'light', 'aerospace'],
    data: { ...d(), baseColor: [0.72, 0.71, 0.68, 1], perceptualRoughness: 0.3, metallic: 0.95 },
  },
  {
    id: 'aluminum', name: 'Aluminum', category: 'metal',
    description: 'Lightweight brushed aluminum',
    tags: ['aluminum', 'light', 'brushed'],
    data: { ...d(), baseColor: [0.88, 0.87, 0.85, 1], perceptualRoughness: 0.35, metallic: 0.9 },
  },

  // ══════════════ NATURAL (8) ══════════════
  {
    id: 'concrete', name: 'Concrete', category: 'natural',
    description: 'Rough gray concrete',
    tags: ['gray', 'rough', 'construction'],
    data: { ...d(), baseColor: [0.55, 0.53, 0.5, 1], perceptualRoughness: 0.9 },
  },
  {
    id: 'marble', name: 'Marble', category: 'natural',
    description: 'Polished white marble',
    tags: ['white', 'polished', 'luxury', 'stone'],
    data: { ...d(), baseColor: [0.95, 0.93, 0.9, 1], perceptualRoughness: 0.15, reflectance: 0.6 },
  },
  {
    id: 'granite', name: 'Granite', category: 'natural',
    description: 'Speckled gray granite',
    tags: ['gray', 'speckled', 'stone'],
    data: { ...d(), baseColor: [0.45, 0.43, 0.42, 1], perceptualRoughness: 0.6 },
  },
  {
    id: 'sand', name: 'Sand', category: 'natural',
    description: 'Warm beach sand',
    tags: ['warm', 'beach', 'yellow'],
    data: { ...d(), baseColor: [0.82, 0.73, 0.54, 1], perceptualRoughness: 0.95 },
  },
  {
    id: 'dirt', name: 'Dirt', category: 'natural',
    description: 'Dark earthy soil',
    tags: ['earth', 'dark', 'brown', 'ground'],
    data: { ...d(), baseColor: [0.35, 0.25, 0.15, 1], perceptualRoughness: 0.95 },
  },
  {
    id: 'brick', name: 'Brick', category: 'natural',
    description: 'Red clay brick',
    tags: ['red', 'clay', 'construction'],
    data: { ...d(), baseColor: [0.65, 0.25, 0.15, 1], perceptualRoughness: 0.85 },
  },
  {
    id: 'leather', name: 'Leather', category: 'natural',
    description: 'Rich brown leather',
    tags: ['brown', 'rich', 'luxury'],
    data: { ...d(), baseColor: [0.42, 0.22, 0.1, 1], perceptualRoughness: 0.65, reflectance: 0.4 },
  },
  {
    id: 'ice', name: 'Ice', category: 'natural',
    description: 'Translucent ice crystal',
    tags: ['cold', 'translucent', 'blue'],
    data: { ...d(), baseColor: [0.8, 0.92, 0.98, 0.7], perceptualRoughness: 0.1, specularTransmission: 0.5, ior: 1.31, alphaMode: 'blend' },
  },

  // ══════════════ GLASS (5) ══════════════
  {
    id: 'glass', name: 'Glass', category: 'glass',
    description: 'Transparent glass with refraction',
    tags: ['clear', 'transparent', 'refraction'],
    data: { ...d(), baseColor: [1.0, 1.0, 1.0, 0.1], perceptualRoughness: 0.05, specularTransmission: 0.9, ior: 1.5, alphaMode: 'blend' },
  },
  {
    id: 'water', name: 'Water', category: 'glass',
    description: 'Semi-transparent water surface',
    tags: ['blue', 'transparent', 'liquid'],
    data: { ...d(), baseColor: [0.2, 0.4, 0.6, 0.3], perceptualRoughness: 0.05, specularTransmission: 0.8, ior: 1.33, alphaMode: 'blend' },
  },
  {
    id: 'frosted_glass', name: 'Frosted Glass', category: 'glass',
    description: 'Diffused frosted glass',
    tags: ['frosted', 'diffuse', 'translucent'],
    data: { ...d(), baseColor: [0.95, 0.97, 1.0, 0.4], perceptualRoughness: 0.6, specularTransmission: 0.7, ior: 1.5, alphaMode: 'blend' },
  },
  {
    id: 'crystal', name: 'Crystal', category: 'glass',
    description: 'Clear prismatic crystal',
    tags: ['clear', 'prismatic', 'sparkle'],
    data: { ...d(), baseColor: [0.98, 0.98, 1.0, 0.15], perceptualRoughness: 0.02, specularTransmission: 0.95, ior: 2.0, alphaMode: 'blend' },
  },
  {
    id: 'diamond', name: 'Diamond', category: 'glass',
    description: 'Brilliant diamond refraction',
    tags: ['precious', 'sparkle', 'brilliant'],
    data: { ...d(), baseColor: [1.0, 1.0, 1.0, 0.05], perceptualRoughness: 0.0, specularTransmission: 0.95, ior: 2.42, alphaMode: 'blend' },
  },

  // ══════════════ SPECIAL (6) ══════════════
  {
    id: 'ceramic', name: 'Ceramic', category: 'special',
    description: 'Glazed ceramic with clearcoat sheen',
    tags: ['glazed', 'shiny', 'clearcoat'],
    data: { ...d(), baseColor: [0.95, 0.93, 0.88, 1], perceptualRoughness: 0.3, clearcoat: 0.8, clearcoatPerceptualRoughness: 0.1 },
  },
  {
    id: 'car_paint', name: 'Car Paint', category: 'special',
    description: 'Glossy car paint with clearcoat',
    tags: ['glossy', 'clearcoat', 'automotive'],
    data: { ...d(), baseColor: [0.8, 0.1, 0.1, 1], perceptualRoughness: 0.2, metallic: 0.5, clearcoat: 1.0, clearcoatPerceptualRoughness: 0.05 },
  },
  {
    id: 'neon_glow', name: 'Neon Glow', category: 'special',
    description: 'Bright emissive neon material',
    tags: ['emissive', 'glow', 'neon', 'bright'],
    data: { ...d(), baseColor: [0.0, 0.8, 1.0, 1], emissive: [0.0, 0.8, 1.0, 5.0], emissiveExposureWeight: 0.5, unlit: true },
  },
  {
    id: 'lava', name: 'Lava', category: 'special',
    description: 'Hot glowing lava',
    tags: ['hot', 'emissive', 'glow', 'fire'],
    data: { ...d(), baseColor: [0.15, 0.02, 0.0, 1], emissive: [1.0, 0.3, 0.0, 4.0], emissiveExposureWeight: 0.8, perceptualRoughness: 0.9 },
  },
  {
    id: 'holographic', name: 'Holographic', category: 'special',
    description: 'Iridescent holographic surface',
    tags: ['iridescent', 'futuristic', 'scifi'],
    data: { ...d(), baseColor: [0.5, 0.3, 0.8, 1], metallic: 0.8, perceptualRoughness: 0.15, clearcoat: 1.0, clearcoatPerceptualRoughness: 0.05 },
  },
  {
    id: 'mirror', name: 'Mirror', category: 'special',
    description: 'Perfect mirror surface',
    tags: ['mirror', 'reflective', 'perfect'],
    data: { ...d(), baseColor: [1.0, 1.0, 1.0, 1], metallic: 1.0, perceptualRoughness: 0.0 },
  },

  // ══════════════ FABRIC (6) ══════════════
  {
    id: 'cotton', name: 'Cotton', category: 'fabric',
    description: 'Soft white cotton fabric',
    tags: ['soft', 'white', 'cloth'],
    data: { ...d(), baseColor: [0.92, 0.9, 0.86, 1], perceptualRoughness: 0.9, reflectance: 0.35 },
  },
  {
    id: 'silk', name: 'Silk', category: 'fabric',
    description: 'Smooth lustrous silk',
    tags: ['smooth', 'shiny', 'luxury'],
    data: { ...d(), baseColor: [0.85, 0.15, 0.2, 1], perceptualRoughness: 0.3, reflectance: 0.6 },
  },
  {
    id: 'velvet', name: 'Velvet', category: 'fabric',
    description: 'Deep rich velvet',
    tags: ['deep', 'rich', 'soft'],
    data: { ...d(), baseColor: [0.25, 0.05, 0.15, 1], perceptualRoughness: 0.85, reflectance: 0.3 },
  },
  {
    id: 'denim', name: 'Denim', category: 'fabric',
    description: 'Classic blue denim',
    tags: ['blue', 'casual', 'jeans'],
    data: { ...d(), baseColor: [0.18, 0.25, 0.45, 1], perceptualRoughness: 0.8, reflectance: 0.3 },
  },
  {
    id: 'wool', name: 'Wool', category: 'fabric',
    description: 'Cozy knit wool',
    tags: ['warm', 'cozy', 'knit'],
    data: { ...d(), baseColor: [0.7, 0.65, 0.55, 1], perceptualRoughness: 0.95, reflectance: 0.25 },
  },
  {
    id: 'canvas', name: 'Canvas', category: 'fabric',
    description: 'Sturdy canvas fabric',
    tags: ['sturdy', 'rough', 'natural'],
    data: { ...d(), baseColor: [0.75, 0.7, 0.6, 1], perceptualRoughness: 0.9, reflectance: 0.3 },
  },

  // ══════════════ PLASTIC (5) ══════════════
  {
    id: 'glossy_plastic', name: 'Glossy Plastic', category: 'plastic',
    description: 'Shiny smooth plastic',
    tags: ['shiny', 'smooth', 'toy'],
    data: { ...d(), baseColor: [0.9, 0.2, 0.15, 1], perceptualRoughness: 0.15, reflectance: 0.5 },
  },
  {
    id: 'matte_plastic', name: 'Matte Plastic', category: 'plastic',
    description: 'Soft-touch matte plastic',
    tags: ['matte', 'soft-touch'],
    data: { ...d(), baseColor: [0.3, 0.3, 0.35, 1], perceptualRoughness: 0.7, reflectance: 0.4 },
  },
  {
    id: 'rubber_soft', name: 'Rubber', category: 'plastic',
    description: 'Soft dark rubber',
    tags: ['dark', 'soft', 'grippy'],
    data: { ...d(), baseColor: [0.15, 0.15, 0.15, 1], perceptualRoughness: 0.95 },
  },
  {
    id: 'acrylic', name: 'Acrylic', category: 'plastic',
    description: 'Clear acrylic plastic',
    tags: ['clear', 'transparent', 'plastic'],
    data: { ...d(), baseColor: [0.95, 0.95, 0.98, 0.5], perceptualRoughness: 0.1, specularTransmission: 0.6, ior: 1.49, alphaMode: 'blend' },
  },
  {
    id: 'resin', name: 'Resin', category: 'plastic',
    description: 'Amber translucent resin',
    tags: ['amber', 'translucent', 'warm'],
    data: { ...d(), baseColor: [0.75, 0.45, 0.1, 0.6], perceptualRoughness: 0.2, specularTransmission: 0.5, ior: 1.55, alphaMode: 'blend' },
  },

  // ══════════════ STONE (5) ══════════════
  {
    id: 'slate', name: 'Slate', category: 'stone',
    description: 'Dark layered slate',
    tags: ['dark', 'layered', 'roof'],
    data: { ...d(), baseColor: [0.3, 0.3, 0.33, 1], perceptualRoughness: 0.75 },
  },
  {
    id: 'limestone', name: 'Limestone', category: 'stone',
    description: 'Warm beige limestone',
    tags: ['warm', 'beige', 'building'],
    data: { ...d(), baseColor: [0.78, 0.74, 0.65, 1], perceptualRoughness: 0.8 },
  },
  {
    id: 'obsidian', name: 'Obsidian', category: 'stone',
    description: 'Glassy black volcanic stone',
    tags: ['black', 'glassy', 'volcanic'],
    data: { ...d(), baseColor: [0.05, 0.05, 0.07, 1], perceptualRoughness: 0.1, reflectance: 0.6 },
  },
  {
    id: 'sandstone', name: 'Sandstone', category: 'stone',
    description: 'Warm sandy stone',
    tags: ['sandy', 'warm', 'desert'],
    data: { ...d(), baseColor: [0.8, 0.65, 0.45, 1], perceptualRoughness: 0.85 },
  },
  {
    id: 'cobblestone', name: 'Cobblestone', category: 'stone',
    description: 'Rough cobblestone surface',
    tags: ['rough', 'street', 'old'],
    data: { ...d(), baseColor: [0.5, 0.48, 0.44, 1], perceptualRoughness: 0.9 },
  },

  // ══════════════ WOOD (5) ══════════════
  {
    id: 'oak', name: 'Oak', category: 'wood',
    description: 'Classic warm oak wood',
    tags: ['warm', 'classic', 'furniture'],
    data: { ...d(), baseColor: [0.52, 0.33, 0.15, 1], perceptualRoughness: 0.7 },
  },
  {
    id: 'pine', name: 'Pine', category: 'wood',
    description: 'Light yellowish pine',
    tags: ['light', 'yellow', 'soft'],
    data: { ...d(), baseColor: [0.72, 0.58, 0.35, 1], perceptualRoughness: 0.7 },
  },
  {
    id: 'walnut', name: 'Walnut', category: 'wood',
    description: 'Dark rich walnut',
    tags: ['dark', 'rich', 'luxury'],
    data: { ...d(), baseColor: [0.32, 0.18, 0.08, 1], perceptualRoughness: 0.65 },
  },
  {
    id: 'bamboo', name: 'Bamboo', category: 'wood',
    description: 'Light natural bamboo',
    tags: ['light', 'natural', 'eco'],
    data: { ...d(), baseColor: [0.78, 0.68, 0.42, 1], perceptualRoughness: 0.6 },
  },
  {
    id: 'plywood', name: 'Plywood', category: 'wood',
    description: 'Layered plywood panel',
    tags: ['layered', 'construction', 'cheap'],
    data: { ...d(), baseColor: [0.7, 0.55, 0.35, 1], perceptualRoughness: 0.75 },
  },
];

export const ALL_CATEGORIES: MaterialCategory[] = ['basic', 'metal', 'natural', 'glass', 'special', 'fabric', 'plastic', 'stone', 'wood'];

export function getPresetById(id: string): MaterialPreset | undefined {
  return MATERIAL_PRESETS.find((p) => p.id === id);
}

export function getPresetsByCategory(category: string): MaterialPreset[] {
  return MATERIAL_PRESETS.filter((p) => p.category === category);
}

/** Custom materials stored in localStorage */
const CUSTOM_MATERIALS_KEY = 'forge-custom-materials';

export interface CustomMaterial {
  id: string;
  name: string;
  data: MaterialData;
  createdAt: number;
}

export function loadCustomMaterials(): CustomMaterial[] {
  try {
    const stored = localStorage.getItem(CUSTOM_MATERIALS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function saveCustomMaterial(name: string, data: MaterialData): CustomMaterial {
  const customs = loadCustomMaterials();
  const material: CustomMaterial = {
    id: `custom_${Date.now()}`,
    name,
    data,
    createdAt: Date.now(),
  };
  customs.push(material);
  localStorage.setItem(CUSTOM_MATERIALS_KEY, JSON.stringify(customs));
  return material;
}

export function deleteCustomMaterial(id: string): void {
  const customs = loadCustomMaterials().filter((m) => m.id !== id);
  localStorage.setItem(CUSTOM_MATERIALS_KEY, JSON.stringify(customs));
}
