/**
 * Accessibility auto-generator for published games.
 *
 * Analyzes scene context and generates:
 * - Colorblind mode configurations (protanopia, deuteranopia, tritanopia, achromatopsia)
 * - Screen reader descriptions for entities
 * - Input remapping alternatives
 * - Subtitle and font size configurations
 * - Accessibility audit with scoring
 */

import type { SceneGraph, SceneNode, MaterialData, LightData } from '@/stores/slices/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ColorblindType = 'protanopia' | 'deuteranopia' | 'tritanopia' | 'achromatopsia';

export interface ColorblindConfig {
  enabled: boolean;
  mode: ColorblindType;
  filterStrength: number; // 0-1
}

export interface ScreenReaderConfig {
  enabled: boolean;
  entityDescriptions: Map<string, string>;
  navigationAnnouncements: boolean;
}

export interface InputRemapping {
  action: string;
  primaryKey: string;
  alternativeKeys: string[];
  gamepadButton?: string;
  touchGesture?: string;
}

export interface InputConfig {
  enabled: boolean;
  remappings: InputRemapping[];
  onScreenControls: boolean;
}

export interface SubtitleConfig {
  enabled: boolean;
  fontSize: 'small' | 'medium' | 'large' | 'extra-large';
  backgroundColor: string;
  textColor: string;
  opacity: number; // 0-1
}

export interface FontSizeConfig {
  enabled: boolean;
  scale: number; // 1.0 = default, 1.5 = 150%, etc.
  minSize: number; // px
}

export interface AccessibilityProfile {
  colorblindMode: ColorblindConfig;
  screenReader: ScreenReaderConfig;
  inputRemapping: InputConfig;
  subtitles: SubtitleConfig;
  fontSize: FontSizeConfig;
}

export type AccessibilitySeverity = 'critical' | 'major' | 'minor' | 'info';

export interface AccessibilityIssue {
  severity: AccessibilitySeverity;
  category: 'visual' | 'auditory' | 'motor' | 'cognitive';
  entityId?: string;
  entityName?: string;
  message: string;
  suggestion: string;
}

export interface AccessibilityAudit {
  score: number; // 0-100
  issues: AccessibilityIssue[];
  passedChecks: string[];
  totalChecks: number;
}

/**
 * Summary of an entity for description generation.
 */
export interface EntitySummary {
  entityId: string;
  name: string;
  entityType: string;
  components: string[];
  hasPhysics: boolean;
  hasScript: boolean;
  hasAudio: boolean;
  materialColor?: [number, number, number, number];
}

/**
 * Minimal scene context for accessibility analysis.
 */
export interface SceneContext {
  sceneGraph: SceneGraph;
  materials: Record<string, MaterialData>;
  lights: Record<string, LightData>;
  scripts: Record<string, { enabled: boolean }>;
  inputBindings?: Array<{ actionName: string; keys: string[] }>;
  audioEntities?: Set<string>;
  gameComponents?: Record<string, Array<{ type: string }>>;
}

// ---------------------------------------------------------------------------
// CSS color-vision filter matrices (SVG feColorMatrix values)
// ---------------------------------------------------------------------------

/**
 * Colorblind simulation filter matrices.
 * These are standard 5x4 feColorMatrix values used in SVG filters.
 * Each matrix simulates how a person with the given condition perceives color.
 *
 * Sources: Machado et al. (2009), Brettel et al. (1997)
 */
export const COLORBLIND_FILTERS: Record<ColorblindType, string> = {
  // Red-blind (affects ~1% of males)
  protanopia: [
    '0.567, 0.433, 0.000, 0, 0',
    '0.558, 0.442, 0.000, 0, 0',
    '0.000, 0.242, 0.758, 0, 0',
    '0,     0,     0,     1, 0',
  ].join(' '),

  // Green-blind (affects ~5% of males)
  deuteranopia: [
    '0.625, 0.375, 0.000, 0, 0',
    '0.700, 0.300, 0.000, 0, 0',
    '0.000, 0.300, 0.700, 0, 0',
    '0,     0,     0,     1, 0',
  ].join(' '),

  // Blue-blind (rare, ~0.01%)
  tritanopia: [
    '0.950, 0.050, 0.000, 0, 0',
    '0.000, 0.433, 0.567, 0, 0',
    '0.000, 0.475, 0.525, 0, 0',
    '0,     0,     0,     1, 0',
  ].join(' '),

  // Total color blindness (very rare)
  achromatopsia: [
    '0.299, 0.587, 0.114, 0, 0',
    '0.299, 0.587, 0.114, 0, 0',
    '0.299, 0.587, 0.114, 0, 0',
    '0,     0,     0,     1, 0',
  ].join(' '),
};

// ---------------------------------------------------------------------------
// Color utilities
// ---------------------------------------------------------------------------

/**
 * Compute relative luminance of a linear RGB color (0-1 range).
 * Per WCAG 2.1 definition.
 */
export function relativeLuminance(r: number, g: number, b: number): number {
  // sRGB to linear
  const toLinear = (c: number): number =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

  const rl = toLinear(r);
  const gl = toLinear(g);
  const bl = toLinear(b);

  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

/**
 * Compute WCAG contrast ratio between two luminance values.
 */
export function contrastRatio(l1: number, l2: number): number {
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Check if two colors have sufficient contrast for WCAG AA (4.5:1 for normal text).
 */
export function hasAdequateContrast(
  color1: [number, number, number],
  color2: [number, number, number],
  level: 'AA' | 'AAA' = 'AA',
): boolean {
  const l1 = relativeLuminance(color1[0], color1[1], color1[2]);
  const l2 = relativeLuminance(color2[0], color2[1], color2[2]);
  const ratio = contrastRatio(l1, l2);
  return level === 'AA' ? ratio >= 4.5 : ratio >= 7;
}

/**
 * Simulate how a color appears under a colorblind condition.
 * Uses a simplified matrix transform.
 */
export function simulateColorblind(
  r: number,
  g: number,
  b: number,
  type: ColorblindType,
): [number, number, number] {
  const matrices: Record<ColorblindType, number[][]> = {
    protanopia: [
      [0.567, 0.433, 0.0],
      [0.558, 0.442, 0.0],
      [0.0, 0.242, 0.758],
    ],
    deuteranopia: [
      [0.625, 0.375, 0.0],
      [0.7, 0.3, 0.0],
      [0.0, 0.3, 0.7],
    ],
    tritanopia: [
      [0.95, 0.05, 0.0],
      [0.0, 0.433, 0.567],
      [0.0, 0.475, 0.525],
    ],
    achromatopsia: [
      [0.299, 0.587, 0.114],
      [0.299, 0.587, 0.114],
      [0.299, 0.587, 0.114],
    ],
  };

  const m = matrices[type];
  return [
    Math.min(1, Math.max(0, m[0][0] * r + m[0][1] * g + m[0][2] * b)),
    Math.min(1, Math.max(0, m[1][0] * r + m[1][1] * g + m[1][2] * b)),
    Math.min(1, Math.max(0, m[2][0] * r + m[2][1] * g + m[2][2] * b)),
  ];
}

/**
 * Determine if two colors are distinguishable under a colorblind condition.
 * Returns true if the simulated colors have a perceptible difference.
 */
export function colorsDistinguishableForColorblind(
  color1: [number, number, number],
  color2: [number, number, number],
  type: ColorblindType,
): boolean {
  const sim1 = simulateColorblind(color1[0], color1[1], color1[2], type);
  const sim2 = simulateColorblind(color2[0], color2[1], color2[2], type);

  // Euclidean distance in RGB space — threshold is approximate
  const dist = Math.sqrt(
    (sim1[0] - sim2[0]) ** 2 +
    (sim1[1] - sim2[1]) ** 2 +
    (sim1[2] - sim2[2]) ** 2,
  );

  // Colors with < 0.1 distance in normalized RGB are hard to distinguish
  return dist >= 0.1;
}

// ---------------------------------------------------------------------------
// Entity type inference
// ---------------------------------------------------------------------------

function inferEntityType(node: SceneNode): string {
  if (node.components.includes('TerrainEnabled')) return 'terrain';
  if (node.components.includes('PointLight')) return 'point_light';
  if (node.components.includes('DirectionalLight')) return 'directional_light';
  if (node.components.includes('SpotLight')) return 'spot_light';
  if (node.components.includes('Mesh3d')) return 'mesh';
  if (node.components.includes('Sprite')) return 'sprite';
  return 'entity';
}

// ---------------------------------------------------------------------------
// Accessibility Audit
// ---------------------------------------------------------------------------

/**
 * Analyze a scene for accessibility issues. This is a synchronous, rule-based
 * analysis that does not require AI — it checks for common accessibility
 * anti-patterns in game scenes.
 */
export function analyzeAccessibility(context: SceneContext): AccessibilityAudit {
  const issues: AccessibilityIssue[] = [];
  const passedChecks: string[] = [];
  let totalChecks = 0;

  const { sceneGraph, materials, lights, scripts, inputBindings, audioEntities, gameComponents } = context;
  const nodes = Object.values(sceneGraph.nodes);

  // ---- Check 1: Scene has adequate lighting ----
  totalChecks++;
  const lightEntities = Object.keys(lights);
  if (lightEntities.length === 0 && nodes.length > 0) {
    issues.push({
      severity: 'major',
      category: 'visual',
      message: 'Scene has no light sources. Users with low vision may not see anything.',
      suggestion: 'Add at least one directional light for consistent scene illumination.',
    });
  } else {
    passedChecks.push('Scene has adequate lighting');
  }

  // ---- Check 2: Color contrast between entities ----
  totalChecks++;
  const materialColors: Array<{ entityId: string; name: string; color: [number, number, number] }> = [];
  for (const node of nodes) {
    const mat = materials[node.entityId];
    if (mat) {
      materialColors.push({
        entityId: node.entityId,
        name: node.name,
        color: [mat.baseColor[0], mat.baseColor[1], mat.baseColor[2]],
      });
    }
  }

  let hasContrastIssue = false;
  // Check pairs of entities for contrast (limit to first 20 to avoid O(n^2) explosion)
  const colorsToCheck = materialColors.slice(0, 20);
  for (let i = 0; i < colorsToCheck.length; i++) {
    for (let j = i + 1; j < colorsToCheck.length; j++) {
      const a = colorsToCheck[i];
      const b = colorsToCheck[j];
      const l1 = relativeLuminance(a.color[0], a.color[1], a.color[2]);
      const l2 = relativeLuminance(b.color[0], b.color[1], b.color[2]);
      const ratio = contrastRatio(l1, l2);
      if (ratio < 1.5) {
        hasContrastIssue = true;
        issues.push({
          severity: 'minor',
          category: 'visual',
          entityId: a.entityId,
          entityName: a.name,
          message: `"${a.name}" and "${b.name}" have very similar colors (contrast ratio ${ratio.toFixed(2)}:1).`,
          suggestion: 'Consider using more distinct colors or adding outlines/patterns to distinguish objects.',
        });
      }
    }
  }
  if (!hasContrastIssue) {
    passedChecks.push('Entity colors have adequate contrast');
  }

  // ---- Check 3: Colorblind-safe palettes ----
  totalChecks++;
  let hasColorblindIssue = false;
  const cbTypes: ColorblindType[] = ['protanopia', 'deuteranopia', 'tritanopia'];
  for (const cbType of cbTypes) {
    for (let i = 0; i < colorsToCheck.length; i++) {
      for (let j = i + 1; j < colorsToCheck.length; j++) {
        const a = colorsToCheck[i];
        const b = colorsToCheck[j];
        if (!colorsDistinguishableForColorblind(a.color, b.color, cbType)) {
          hasColorblindIssue = true;
          issues.push({
            severity: 'major',
            category: 'visual',
            entityId: a.entityId,
            entityName: a.name,
            message: `"${a.name}" and "${b.name}" are indistinguishable for users with ${cbType}.`,
            suggestion: `Use shapes, patterns, or labels in addition to color to differentiate these entities.`,
          });
        }
      }
    }
  }
  if (!hasColorblindIssue) {
    passedChecks.push('Color palette is distinguishable for common colorblind types');
  }

  // ---- Check 4: Input alternatives ----
  totalChecks++;
  if (inputBindings && inputBindings.length > 0) {
    const hasAlternatives = inputBindings.every((b) => b.keys.length >= 2);
    if (!hasAlternatives) {
      issues.push({
        severity: 'major',
        category: 'motor',
        message: 'Some input actions have only one key binding.',
        suggestion: 'Add alternative key bindings and gamepad support for all actions.',
      });
    } else {
      passedChecks.push('All input actions have alternative bindings');
    }
  } else {
    passedChecks.push('No input bindings to check');
  }

  // ---- Check 5: Audio entities have visual indicators ----
  totalChecks++;
  if (audioEntities && audioEntities.size > 0) {
    let allHaveVisuals = true;
    for (const entityId of audioEntities) {
      const node = sceneGraph.nodes[entityId];
      if (node) {
        const hasMesh = node.components.includes('Mesh3d') || node.components.includes('Sprite');
        if (!hasMesh) {
          allHaveVisuals = false;
          issues.push({
            severity: 'major',
            category: 'auditory',
            entityId,
            entityName: node.name,
            message: `Audio entity "${node.name}" has no visual representation.`,
            suggestion: 'Add a visible mesh or sprite to audio sources so deaf/hard-of-hearing users can locate them.',
          });
        }
      }
    }
    if (allHaveVisuals) {
      passedChecks.push('All audio entities have visual indicators');
    }
  } else {
    passedChecks.push('No audio-only entities to check');
  }

  // ---- Check 6: Interactive entities have scripts ----
  totalChecks++;
  if (gameComponents) {
    let allInteractiveHaveScripts = true;
    for (const [entityId, components] of Object.entries(gameComponents)) {
      const hasInteractive = components.some((c) =>
        ['characterController', 'collectible', 'checkpoint', 'teleporter'].includes(c.type),
      );
      if (hasInteractive && !scripts[entityId]) {
        allInteractiveHaveScripts = false;
        const node = sceneGraph.nodes[entityId];
        issues.push({
          severity: 'info',
          category: 'cognitive',
          entityId,
          entityName: node?.name,
          message: `Interactive entity "${node?.name ?? entityId}" may need scripted feedback.`,
          suggestion: 'Add visual/audio feedback scripts so players understand when they interact with this entity.',
        });
      }
    }
    if (allInteractiveHaveScripts) {
      passedChecks.push('Interactive entities have feedback scripts');
    }
  } else {
    passedChecks.push('No game components to check');
  }

  // ---- Check 7: Scene complexity (cognitive) ----
  totalChecks++;
  if (nodes.length > 100) {
    issues.push({
      severity: 'info',
      category: 'cognitive',
      message: `Scene has ${nodes.length} entities, which may be overwhelming for some users.`,
      suggestion: 'Consider progressive disclosure — reveal complexity gradually as the player learns.',
    });
  } else {
    passedChecks.push('Scene complexity is manageable');
  }

  // ---- Check 8: Very dark or very bright materials ----
  totalChecks++;
  let hasExtremeColors = false;
  for (const entry of materialColors) {
    const lum = relativeLuminance(entry.color[0], entry.color[1], entry.color[2]);
    if (lum < 0.01 || lum > 0.95) {
      hasExtremeColors = true;
      issues.push({
        severity: 'minor',
        category: 'visual',
        entityId: entry.entityId,
        entityName: entry.name,
        message: `"${entry.name}" has ${lum < 0.01 ? 'very dark' : 'very bright'} coloring (luminance ${lum.toFixed(3)}).`,
        suggestion: 'Extreme brightness/darkness can cause visibility issues for low-vision users. Consider softer tones.',
      });
    }
  }
  if (!hasExtremeColors) {
    passedChecks.push('No extreme brightness/darkness in materials');
  }

  // ---- Calculate score ----
  const severityWeights: Record<AccessibilitySeverity, number> = {
    critical: 25,
    major: 15,
    minor: 5,
    info: 2,
  };

  let deductions = 0;
  for (const issue of issues) {
    deductions += severityWeights[issue.severity];
  }

  const score = Math.max(0, Math.min(100, 100 - deductions));

  return {
    score,
    issues,
    passedChecks,
    totalChecks,
  };
}

// ---------------------------------------------------------------------------
// Entity description generation (AI-assisted stub)
// ---------------------------------------------------------------------------

/**
 * Generate human-readable screen reader descriptions for entities.
 *
 * This is the non-AI fallback that produces descriptions based on entity
 * metadata. The AI-enhanced version (generateEntityDescriptionsAI) would
 * call Claude to produce richer descriptions, but this works offline.
 */
export function generateEntityDescriptions(
  entities: EntitySummary[],
): Map<string, string> {
  const descriptions = new Map<string, string>();

  for (const entity of entities) {
    const parts: string[] = [];

    // Base description from type
    switch (entity.entityType) {
      case 'mesh':
        parts.push(`3D object named "${entity.name}"`);
        break;
      case 'point_light':
        parts.push(`Point light named "${entity.name}"`);
        break;
      case 'directional_light':
        parts.push(`Directional light named "${entity.name}"`);
        break;
      case 'spot_light':
        parts.push(`Spotlight named "${entity.name}"`);
        break;
      case 'terrain':
        parts.push(`Terrain surface named "${entity.name}"`);
        break;
      case 'sprite':
        parts.push(`2D sprite named "${entity.name}"`);
        break;
      default:
        parts.push(`Game object named "${entity.name}"`);
    }

    // Add behavioral context
    if (entity.hasPhysics) {
      parts.push('with physics simulation');
    }
    if (entity.hasScript) {
      parts.push('with interactive behavior');
    }
    if (entity.hasAudio) {
      parts.push('with sound effects');
    }

    // Color description for visually impaired
    if (entity.materialColor) {
      const colorName = describeColor(entity.materialColor);
      if (colorName) {
        parts.push(`colored ${colorName}`);
      }
    }

    descriptions.set(entity.entityId, parts.join(', '));
  }

  return descriptions;
}

/**
 * Provide a human-readable color name for a normalized RGBA color.
 */
function describeColor(color: [number, number, number, number]): string {
  const [r, g, b] = color;
  const lum = relativeLuminance(r, g, b);

  if (lum < 0.05) return 'dark/black';
  if (lum > 0.9) return 'white/bright';

  // Simple hue detection
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const range = max - min;

  if (range < 0.1) {
    return lum < 0.3 ? 'dark gray' : lum < 0.7 ? 'gray' : 'light gray';
  }

  if (r > g && r > b) {
    if (g > 0.4 * r) return 'orange/yellow';
    return 'red';
  }
  if (g > r && g > b) return 'green';
  if (b > r && b > g) {
    if (r > 0.4 * b) return 'purple';
    return 'blue';
  }
  if (r > 0.7 && g > 0.7) return 'yellow';
  if (g > 0.5 && b > 0.5) return 'cyan';
  if (r > 0.5 && b > 0.5) return 'magenta';

  return '';
}

// ---------------------------------------------------------------------------
// Profile generation
// ---------------------------------------------------------------------------

/**
 * Build entity summaries from scene context.
 */
export function buildEntitySummaries(context: SceneContext): EntitySummary[] {
  const summaries: EntitySummary[] = [];

  for (const node of Object.values(context.sceneGraph.nodes)) {
    summaries.push({
      entityId: node.entityId,
      name: node.name,
      entityType: inferEntityType(node),
      components: node.components,
      hasPhysics: node.components.includes('PhysicsEnabled') || node.components.includes('Physics2dEnabled'),
      hasScript: !!context.scripts[node.entityId]?.enabled,
      hasAudio: context.audioEntities?.has(node.entityId) ?? false,
      materialColor: context.materials[node.entityId]?.baseColor,
    });
  }

  return summaries;
}

/**
 * Generate a complete accessibility profile for a scene.
 * This is the synchronous, rule-based version. An AI-enhanced version
 * could use Claude to generate richer descriptions and smarter remappings.
 */
export function generateAccessibilityProfile(
  context: SceneContext,
): AccessibilityProfile {
  const entities = buildEntitySummaries(context);
  const descriptions = generateEntityDescriptions(entities);

  // Build input remappings from existing bindings
  const remappings: InputRemapping[] = (context.inputBindings ?? []).map((binding) => ({
    action: binding.actionName,
    primaryKey: binding.keys[0] ?? '',
    alternativeKeys: binding.keys.slice(1),
    gamepadButton: guessGamepadButton(binding.actionName),
    touchGesture: guessTouchGesture(binding.actionName),
  }));

  return {
    colorblindMode: {
      enabled: false,
      mode: 'deuteranopia', // most common type
      filterStrength: 1.0,
    },
    screenReader: {
      enabled: false,
      entityDescriptions: descriptions,
      navigationAnnouncements: true,
    },
    inputRemapping: {
      enabled: false,
      remappings,
      onScreenControls: true,
    },
    subtitles: {
      enabled: true,
      fontSize: 'medium',
      backgroundColor: 'rgba(0, 0, 0, 0.75)',
      textColor: '#FFFFFF',
      opacity: 1.0,
    },
    fontSize: {
      enabled: false,
      scale: 1.0,
      minSize: 14,
    },
  };
}

/**
 * Guess a reasonable gamepad button for a given action name.
 */
function guessGamepadButton(actionName: string): string {
  const lower = actionName.toLowerCase();
  if (lower.includes('jump') || lower.includes('confirm')) return 'A';
  if (lower.includes('attack') || lower.includes('action')) return 'X';
  if (lower.includes('cancel') || lower.includes('back')) return 'B';
  if (lower.includes('interact') || lower.includes('use')) return 'Y';
  if (lower.includes('move') || lower.includes('walk')) return 'Left Stick';
  if (lower.includes('look') || lower.includes('aim')) return 'Right Stick';
  if (lower.includes('sprint') || lower.includes('run')) return 'Left Bumper';
  if (lower.includes('shoot') || lower.includes('fire')) return 'Right Trigger';
  return 'A';
}

/**
 * Guess a reasonable touch gesture for a given action name.
 */
function guessTouchGesture(actionName: string): string {
  const lower = actionName.toLowerCase();
  if (lower.includes('jump')) return 'tap';
  if (lower.includes('move') || lower.includes('walk')) return 'virtual joystick';
  if (lower.includes('look') || lower.includes('aim')) return 'swipe';
  if (lower.includes('attack') || lower.includes('shoot')) return 'tap (right side)';
  if (lower.includes('interact') || lower.includes('use')) return 'double tap';
  return 'tap';
}

// ---------------------------------------------------------------------------
// CSS filter generation for colorblind simulation
// ---------------------------------------------------------------------------

/**
 * Generate a CSS filter string for colorblind simulation in the game viewport.
 */
export function getColorblindFilterCSS(config: ColorblindConfig): string {
  if (!config.enabled) return 'none';

  const matrix = COLORBLIND_FILTERS[config.mode];
  if (!matrix) return 'none';

  // SVG filter approach — return the url reference for the filter
  return `url(#colorblind-${config.mode})`;
}

/**
 * Generate an inline SVG filter definition for colorblind simulation.
 * This should be placed once in the DOM for the CSS filter to reference.
 */
export function getColorblindSVGFilter(config: ColorblindConfig): string {
  if (!config.enabled) return '';

  const matrix = COLORBLIND_FILTERS[config.mode];
  if (!matrix) return '';

  const strength = config.filterStrength;
  // Interpolate between identity matrix and colorblind matrix
  // Identity: 1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0
  const identity = '1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0';

  const matrixValues = strength >= 1
    ? matrix
    : interpolateMatrices(identity, matrix, strength);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" style="position:absolute;width:0;height:0">`,
    `  <filter id="colorblind-${config.mode}">`,
    `    <feColorMatrix type="matrix" values="${matrixValues}" />`,
    `  </filter>`,
    `</svg>`,
  ].join('\n');
}

/**
 * Interpolate between two feColorMatrix value strings.
 */
function interpolateMatrices(a: string, b: string, t: number): string {
  const aValues = a.split(/[\s,]+/).map(Number);
  const bValues = b.split(/[\s,]+/).map(Number);

  return aValues
    .map((av, i) => {
      const bv = bValues[i] ?? av;
      return (av + (bv - av) * t).toFixed(4);
    })
    .join(' ');
}

// ---------------------------------------------------------------------------
// Default profile factory
// ---------------------------------------------------------------------------

/**
 * Create a default (empty) accessibility profile.
 */
export function createDefaultProfile(): AccessibilityProfile {
  return {
    colorblindMode: {
      enabled: false,
      mode: 'deuteranopia',
      filterStrength: 1.0,
    },
    screenReader: {
      enabled: false,
      entityDescriptions: new Map(),
      navigationAnnouncements: true,
    },
    inputRemapping: {
      enabled: false,
      remappings: [],
      onScreenControls: false,
    },
    subtitles: {
      enabled: false,
      fontSize: 'medium',
      backgroundColor: 'rgba(0, 0, 0, 0.75)',
      textColor: '#FFFFFF',
      opacity: 1.0,
    },
    fontSize: {
      enabled: false,
      scale: 1.0,
      minSize: 14,
    },
  };
}
