/**
 * Scene Advisor — proactive AI suggestions for common scene issues.
 * Analyzes the current scene state and produces actionable advice.
 */

/**
 * Minimal interfaces for scene analysis — only the fields the advisor reads.
 * This avoids coupling to the full EditorStore types and makes testing easy.
 */

export interface AdvisorTransform {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}

export interface AdvisorMaterial {
  baseColor: [number, number, number] | [number, number, number, number];
  metallic: number;
  perceptualRoughness: number;
}

export interface AdvisorLight {
  lightType: string;
  color: [number, number, number];
  intensity: number;
  shadowsEnabled: boolean;
}

export interface AdvisorPhysics {
  bodyType: string;
  colliderShape: string;
}

export interface AdvisorAmbientLight {
  color: [number, number, number];
  brightness: number;
}

export interface AdvisorEnvironment {
  fogEnabled: boolean;
}

export type AdvisorSeverity = 'info' | 'warning' | 'error';
export type AdvisorCategory =
  | 'lighting'
  | 'physics'
  | 'performance'
  | 'materials'
  | 'scene-structure'
  | 'gameplay';

export interface SceneAdvice {
  id: string;
  severity: AdvisorSeverity;
  category: AdvisorCategory;
  title: string;
  description: string;
  /** Suggested action text (shown as a clickable suggestion) */
  suggestion?: string;
  /** Entity IDs involved */
  entityIds?: string[];
}

export interface SceneAnalysisInput {
  sceneGraph: { rootIds: string[]; nodes: Record<string, unknown> };
  transforms: Record<string, AdvisorTransform>;
  materials: Record<string, AdvisorMaterial>;
  lights: Record<string, AdvisorLight>;
  physics: Record<string, AdvisorPhysics>;
  physicsEnabled: Record<string, boolean>;
  ambientLight: AdvisorAmbientLight;
  environment: AdvisorEnvironment;
  entityCount: number;
}

/**
 * Analyze a scene and return advice items.
 */
export function analyzeScene(input: SceneAnalysisInput): SceneAdvice[] {
  const advice: SceneAdvice[] = [];

  checkEmptyScene(input, advice);
  checkNoLighting(input, advice);
  checkOverlappingEntities(input, advice);
  checkNoPhysicsGround(input, advice);
  checkHighEntityCount(input, advice);
  checkDefaultMaterials(input, advice);
  checkDarkScene(input, advice);
  checkFloatingEntities(input, advice);
  checkNoShadows(input, advice);
  checkTooManyLights(input, advice);

  return advice;
}

function checkEmptyScene(input: SceneAnalysisInput, advice: SceneAdvice[]): void {
  if (input.entityCount === 0) {
    advice.push({
      id: 'empty-scene',
      severity: 'info',
      category: 'scene-structure',
      title: 'Empty scene',
      description: 'Your scene has no entities. Start by adding some objects.',
      suggestion: 'Create a basic 3D scene with ground plane and lighting',
    });
  }
}

function checkNoLighting(input: SceneAnalysisInput, advice: SceneAdvice[]): void {
  if (input.entityCount === 0) return;

  const lightCount = Object.keys(input.lights).length;
  if (lightCount === 0 && input.ambientLight.brightness < 0.1) {
    advice.push({
      id: 'no-lighting',
      severity: 'warning',
      category: 'lighting',
      title: 'No lights in scene',
      description: 'Your scene has no light sources and low ambient light. Objects will appear very dark.',
      suggestion: 'Add a directional light for basic illumination',
    });
  }
}

function checkOverlappingEntities(input: SceneAnalysisInput, advice: SceneAdvice[]): void {
  const positions = Object.entries(input.transforms);
  const overlaps: string[] = [];
  const checked = new Set<string>();

  for (let i = 0; i < positions.length; i++) {
    const [idA, tA] = positions[i];
    for (let j = i + 1; j < positions.length; j++) {
      const [idB, tB] = positions[j];
      const key = `${idA}-${idB}`;
      if (checked.has(key)) continue;
      checked.add(key);

      const dist = Math.sqrt(
        (tA.position[0] - tB.position[0]) ** 2 +
        (tA.position[1] - tB.position[1]) ** 2 +
        (tA.position[2] - tB.position[2]) ** 2,
      );

      if (dist < 0.01) {
        overlaps.push(idA, idB);
      }
    }
  }

  if (overlaps.length > 0) {
    const uniqueIds = [...new Set(overlaps)];
    advice.push({
      id: 'overlapping-entities',
      severity: 'warning',
      category: 'scene-structure',
      title: 'Overlapping entities detected',
      description: `${uniqueIds.length} entities share the same position. This may cause visual artifacts or physics issues.`,
      entityIds: uniqueIds,
      suggestion: 'Spread out overlapping entities',
    });
  }
}

function checkNoPhysicsGround(input: SceneAnalysisInput, advice: SceneAdvice[]): void {
  const hasDynamic = Object.entries(input.physics).some(
    ([id, p]) => input.physicsEnabled[id] && p.bodyType === 'dynamic',
  );
  const hasFixed = Object.entries(input.physics).some(
    ([id, p]) => input.physicsEnabled[id] && (p.bodyType === 'fixed' || p.bodyType === 'kinematic_position'),
  );

  if (hasDynamic && !hasFixed) {
    advice.push({
      id: 'no-physics-ground',
      severity: 'warning',
      category: 'physics',
      title: 'Dynamic bodies without ground',
      description: 'You have dynamic physics objects but no fixed body to act as ground. Objects will fall indefinitely.',
      suggestion: 'Add a ground plane with a fixed physics body',
    });
  }
}

function checkHighEntityCount(input: SceneAnalysisInput, advice: SceneAdvice[]): void {
  if (input.entityCount > 200) {
    advice.push({
      id: 'high-entity-count',
      severity: 'warning',
      category: 'performance',
      title: 'High entity count',
      description: `Scene has ${input.entityCount} entities. Consider using LOD, combining meshes, or instancing for better performance.`,
      suggestion: 'Review entity count and consider optimization',
    });
  } else if (input.entityCount > 100) {
    advice.push({
      id: 'moderate-entity-count',
      severity: 'info',
      category: 'performance',
      title: 'Moderate entity count',
      description: `Scene has ${input.entityCount} entities. Performance should be fine but keep an eye on frame rate.`,
    });
  }
}

function checkDefaultMaterials(input: SceneAnalysisInput, advice: SceneAdvice[]): void {
  const defaultMats = Object.entries(input.materials).filter(([_id, m]) => {
    return (
      m.baseColor[0] === 1 &&
      m.baseColor[1] === 1 &&
      m.baseColor[2] === 1 &&
      m.metallic === 0 &&
      m.perceptualRoughness === 0.5
    );
  });

  if (defaultMats.length > 3) {
    advice.push({
      id: 'default-materials',
      severity: 'info',
      category: 'materials',
      title: 'Multiple default materials',
      description: `${defaultMats.length} entities use default white material. Consider applying distinct materials for visual variety.`,
      entityIds: defaultMats.map(([id]) => id),
      suggestion: 'Apply materials from the Material Library',
    });
  }
}

function checkDarkScene(input: SceneAnalysisInput, advice: SceneAdvice[]): void {
  if (input.entityCount === 0) return;

  const lightCount = Object.keys(input.lights).length;
  const totalIntensity = Object.values(input.lights).reduce((sum, l) => sum + l.intensity, 0);
  const ambientBrightness = input.ambientLight.brightness;

  if (lightCount > 0 && totalIntensity < 500 && ambientBrightness < 0.05) {
    advice.push({
      id: 'dark-scene',
      severity: 'info',
      category: 'lighting',
      title: 'Scene may be too dark',
      description: 'Light intensities are low and ambient brightness is minimal. Scene may appear very dark.',
      suggestion: 'Increase light intensity or ambient brightness',
    });
  }
}

function checkFloatingEntities(input: SceneAnalysisInput, advice: SceneAdvice[]): void {
  const floating: string[] = [];

  for (const [id, t] of Object.entries(input.transforms)) {
    // Skip lights (they're usually positioned above the scene)
    if (input.lights[id]) continue;

    if (t.position[1] > 20) {
      floating.push(id);
    }
  }

  if (floating.length > 2) {
    advice.push({
      id: 'floating-entities',
      severity: 'info',
      category: 'scene-structure',
      title: 'Entities high above ground',
      description: `${floating.length} entities are positioned more than 20 units above ground level.`,
      entityIds: floating,
    });
  }
}

function checkNoShadows(input: SceneAnalysisInput, advice: SceneAdvice[]): void {
  if (input.entityCount === 0) return;

  const lightValues = Object.values(input.lights);
  if (lightValues.length > 0 && !lightValues.some((l) => l.shadowsEnabled)) {
    advice.push({
      id: 'no-shadows',
      severity: 'info',
      category: 'lighting',
      title: 'No shadows enabled',
      description: 'None of your lights have shadows enabled. Shadows add depth and realism.',
      suggestion: 'Enable shadows on your primary directional light',
    });
  }
}

function checkTooManyLights(input: SceneAnalysisInput, advice: SceneAdvice[]): void {
  const shadowLights = Object.values(input.lights).filter((l) => l.shadowsEnabled);
  if (shadowLights.length > 4) {
    advice.push({
      id: 'too-many-shadow-lights',
      severity: 'warning',
      category: 'performance',
      title: 'Too many shadow-casting lights',
      description: `${shadowLights.length} lights cast shadows. This significantly impacts performance. Consider limiting to 1-2 shadow-casting lights.`,
      suggestion: 'Reduce shadow-casting lights to improve performance',
    });
  }
}
