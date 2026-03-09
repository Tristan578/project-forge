export type PaletteId =
  | 'pico-8'
  | 'db16'
  | 'db32'
  | 'endesga-32'
  | 'endesga-64'
  | 'nes'
  | 'game-boy'
  | 'cga'
  | 'custom';

export interface PaletteDefinition {
  id: PaletteId;
  name: string;
  colors: string[];
}

export const PALETTES: Record<PaletteId, PaletteDefinition> = {
  'pico-8': {
    id: 'pico-8',
    name: 'Pico-8',
    colors: [
      '#000000', '#1d2b53', '#7e2553', '#008751',
      '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8',
      '#ff004d', '#ffa300', '#ffec27', '#00e436',
      '#29adff', '#83769c', '#ff77a8', '#ffccaa',
    ],
  },
  'db16': {
    id: 'db16',
    name: 'DawnBringer 16',
    colors: [
      '#140c1c', '#442434', '#30346d', '#4e4a4e',
      '#854c30', '#346524', '#d04648', '#757161',
      '#597dce', '#d27d2c', '#8595a1', '#6daa2c',
      '#d2aa99', '#6dc2ca', '#dad45e', '#deeed6',
    ],
  },
  'db32': {
    id: 'db32',
    name: 'DawnBringer 32',
    colors: [
      '#000000', '#222034', '#45283c', '#663931',
      '#8f563b', '#df7126', '#d9a066', '#eec39a',
      '#fbf236', '#99e550', '#6abe30', '#37946e',
      '#4b692f', '#524b24', '#323c39', '#3f3f74',
      '#306082', '#5b6ee1', '#639bff', '#5fcde4',
      '#cbdbfc', '#ffffff', '#9badb7', '#847e87',
      '#696a6a', '#595652', '#76428a', '#ac3232',
      '#d95763', '#d77bba', '#8f974a', '#8a6f30',
    ],
  },
  'endesga-32': {
    id: 'endesga-32',
    name: 'Endesga 32',
    colors: [
      '#be4a2f', '#d77643', '#ead4aa', '#e4a672',
      '#b86f50', '#733e39', '#3e2731', '#a22633',
      '#e43b44', '#f77622', '#feae34', '#fee761',
      '#63c74d', '#3e8948', '#265c42', '#193c3e',
      '#124e89', '#0099db', '#2ce8f5', '#ffffff',
      '#c0cbdc', '#8b9bb4', '#5a6988', '#3a4466',
      '#262b44', '#181425', '#ff0044', '#68386c',
      '#b55088', '#f6757a', '#e8b796', '#c28569',
    ],
  },
  'endesga-64': {
    id: 'endesga-64',
    name: 'Endesga 64',
    colors: [
      '#ff0040', '#131313', '#1b1b1b', '#272727',
      '#3d3d3d', '#5d5d5d', '#858585', '#b4b4b4',
      '#ffffff', '#c7cfdd', '#92a1b9', '#657392',
      '#424c6e', '#2a2f4e', '#1a1932', '#0e071b',
      '#1c121c', '#391f21', '#5d2c28', '#8a4836',
      '#bf6f4a', '#e69c69', '#f6ca9f', '#f9e6cf',
      '#edab50', '#e07438', '#c64524', '#8e251d',
      '#ff5000', '#ed7614', '#ffa214', '#ffc825',
      '#ffeb57', '#d3fc7e', '#99e65f', '#5ac54f',
      '#33984b', '#1a6f30', '#134c21', '#0c2e18',
      '#062f15', '#183d3f', '#2e555a', '#417577',
      '#5a9591', '#85c4b3', '#9cffbc', '#32a8a0',
      '#1e7a7f', '#15505a', '#0e2e36', '#0b4e6e',
      '#1177a1', '#2fa4d4', '#55d0ff', '#93e4ff',
      '#a0ceff', '#7393cc', '#4b6eb4', '#30459e',
      '#222187', '#1a1078', '#110b44', '#320956',
    ],
  },
  'nes': {
    id: 'nes',
    name: 'NES',
    colors: [
      '#7c7c7c', '#0000fc', '#0000bc', '#4428bc',
      '#940084', '#a80020', '#a81000', '#881400',
      '#503000', '#007800', '#006800', '#005800',
      '#004058', '#000000', '#bcbcbc', '#0078f8',
      '#0058f8', '#6844fc', '#d800cc', '#e40058',
      '#f83800', '#e45c10', '#ac7c00', '#00b800',
      '#00a800', '#00a844', '#008888', '#f8f8f8',
      '#3cbcfc', '#6888fc', '#9878f8', '#f878f8',
      '#f85898', '#f87858', '#fca044', '#f8b800',
      '#b8f818', '#58d854', '#58f898', '#00e8d8',
      '#787878', '#fcfcfc', '#a4e4fc', '#b8b8f8',
      '#d8b8f8', '#f8b8f8', '#f8a4c0', '#f0d0b0',
      '#fce0a8', '#f8d878', '#d8f878', '#b8f8b8',
      '#b8f8d8', '#00fcfc',
    ],
  },
  'game-boy': {
    id: 'game-boy',
    name: 'Game Boy',
    colors: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'],
  },
  'cga': {
    id: 'cga',
    name: 'CGA',
    colors: [
      '#000000', '#0000aa', '#00aa00', '#00aaaa',
      '#aa0000', '#aa00aa', '#aa5500', '#aaaaaa',
      '#555555', '#5555ff', '#55ff55', '#55ffff',
      '#ff5555', '#ff55ff', '#ffff55', '#ffffff',
    ],
  },
  'custom': {
    id: 'custom',
    name: 'Custom',
    colors: [],
  },
};

export function getPalette(id: PaletteId): PaletteDefinition | undefined {
  return PALETTES[id];
}

export function validateCustomPalette(colors: string[]): { valid: boolean; error?: string } {
  if (!Array.isArray(colors) || colors.length < 2) {
    return { valid: false, error: 'Custom palette must have at least 2 colors' };
  }
  if (colors.length > 256) {
    return { valid: false, error: 'Custom palette cannot exceed 256 colors' };
  }
  const hexRegex = /^#[0-9a-fA-F]{6}$/;
  for (const color of colors) {
    if (typeof color !== 'string' || !hexRegex.test(color)) {
      return { valid: false, error: `Invalid hex color: ${color}` };
    }
  }
  return { valid: true };
}
