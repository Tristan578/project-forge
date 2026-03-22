/**
 * Tier 1 Evaluation — Heuristic scoring (no API calls, instant)
 *
 * Analyzes scene graph state after compound action execution.
 * Returns a score 0-60 based on structural quality signals.
 */

export interface SceneState {
  entities: EntityInfo[];
  environment?: {
    ambientColor?: string;
    fogEnabled?: boolean;
    skyboxPreset?: string;
  };
  postProcessing?: {
    bloomEnabled?: boolean;
    bloomIntensity?: number;
  };
  sceneName?: string;
}

export interface EntityInfo {
  id: string;
  name: string;
  type: string;
  visible: boolean;
  parentId: string | null;
  childCount: number;
  position: { x: number; y: number; z: number };
  components: string[];
  hasPhysics: boolean;
  hasAudio: boolean;
  hasScript: boolean;
  materialName?: string;
}

export interface HeuristicResult {
  score: number;
  maxScore: number;
  breakdown: Record<string, { score: number; max: number; reason: string }>;
}

export interface BenchmarkPrompt {
  id: string;
  prompt: string;
  expectedElements: {
    entities: string[];
    materials: string[];
    lighting: string[];
    audio: string[];
    physics: string[];
    mood: string;
  };
  minEntities: number;
  maxEntities: number;
  category: string;
}

export function scoreHeuristics(
  scene: SceneState,
  prompt: BenchmarkPrompt
): HeuristicResult {
  const breakdown: HeuristicResult['breakdown'] = {};

  // 1. Entity count (0-10)
  const entityCount = scene.entities.length;
  const inRange =
    entityCount >= prompt.minEntities && entityCount <= prompt.maxEntities;
  const countScore = inRange
    ? 10
    : entityCount < prompt.minEntities
      ? Math.max(0, 10 - (prompt.minEntities - entityCount) * 2)
      : Math.max(0, 10 - (entityCount - prompt.maxEntities));
  breakdown.entityCount = {
    score: countScore,
    max: 10,
    reason: `${entityCount} entities (expected ${prompt.minEntities}-${prompt.maxEntities})`,
  };

  // 2. Material diversity (0-10)
  const uniqueMaterials = new Set(
    scene.entities.map((e) => e.materialName).filter(Boolean)
  );
  const expectedMaterialCount = prompt.expectedElements.materials.length;
  const materialScore = Math.min(
    10,
    Math.round((uniqueMaterials.size / Math.max(1, expectedMaterialCount)) * 10)
  );
  breakdown.materialDiversity = {
    score: materialScore,
    max: 10,
    reason: `${uniqueMaterials.size} unique materials (expected ~${expectedMaterialCount})`,
  };

  // 3. Lighting presence (0-10)
  const lights = scene.entities.filter(
    (e) => e.type === 'light' || e.components.some((c) => c.includes('Light'))
  );
  const hasNonAmbient = lights.length > 0;
  const expectedLightCount = prompt.expectedElements.lighting.length;
  const lightScore = hasNonAmbient
    ? Math.min(10, Math.round((lights.length / Math.max(1, expectedLightCount)) * 10))
    : 0;
  breakdown.lighting = {
    score: lightScore,
    max: 10,
    reason: `${lights.length} lights (expected ~${expectedLightCount})`,
  };

  // 4. Spatial distribution (0-10)
  const positions = scene.entities
    .filter((e) => e.type !== 'light')
    .map((e) => e.position);
  const spatialScore = scoreSpatialDistribution(positions);
  breakdown.spatialDistribution = {
    score: spatialScore,
    max: 10,
    reason: spatialScore >= 7 ? 'well distributed' : 'clustered or sparse',
  };

  // 5. Component coverage (0-10)
  const hasPhysicsEntities = scene.entities.some((e) => e.hasPhysics);
  const hasAudioEntities = scene.entities.some((e) => e.hasAudio);
  const expectsPhysics = prompt.expectedElements.physics.length > 0;
  const expectsAudio = prompt.expectedElements.audio.length > 0;

  let componentScore = 5; // base for having entities at all
  if (expectsPhysics && hasPhysicsEntities) componentScore += 2.5;
  if (expectsPhysics && !hasPhysicsEntities) componentScore -= 2;
  if (expectsAudio && hasAudioEntities) componentScore += 2.5;
  if (expectsAudio && !hasAudioEntities) componentScore -= 1;
  if (!expectsPhysics && !expectsAudio) componentScore = 7; // simple scene, just having entities is fine
  componentScore = Math.max(0, Math.min(10, Math.round(componentScore)));
  breakdown.componentCoverage = {
    score: componentScore,
    max: 10,
    reason: `physics: ${hasPhysicsEntities ? 'yes' : 'no'} (expected: ${expectsPhysics}), audio: ${hasAudioEntities ? 'yes' : 'no'} (expected: ${expectsAudio})`,
  };

  // 6. Hierarchy depth (0-10)
  const withParent = scene.entities.filter((e) => e.parentId !== null).length;
  const hierarchyRatio = entityCount > 0 ? withParent / entityCount : 0;
  // Good scenes have 20-60% of entities as children (grouped objects)
  const hierarchyScore =
    hierarchyRatio >= 0.15 && hierarchyRatio <= 0.7
      ? 10
      : hierarchyRatio < 0.15
        ? Math.round(hierarchyRatio * 66) // scale up to 10
        : Math.max(0, 10 - Math.round((hierarchyRatio - 0.7) * 30));
  breakdown.hierarchy = {
    score: hierarchyScore,
    max: 10,
    reason: `${withParent}/${entityCount} entities have parents (${Math.round(hierarchyRatio * 100)}%)`,
  };

  const totalScore = Object.values(breakdown).reduce((sum, b) => sum + b.score, 0);

  return {
    score: totalScore,
    maxScore: 60,
    breakdown,
  };
}

function scoreSpatialDistribution(
  positions: { x: number; y: number; z: number }[]
): number {
  if (positions.length < 2) return 3;

  // Calculate standard deviation of positions
  const mean = {
    x: positions.reduce((s, p) => s + p.x, 0) / positions.length,
    y: positions.reduce((s, p) => s + p.y, 0) / positions.length,
    z: positions.reduce((s, p) => s + p.z, 0) / positions.length,
  };

  // Suppress unused variable warning — y mean is tracked for potential future use
  void mean.y;

  const variance =
    positions.reduce((s, p) => {
      return s + (p.x - mean.x) ** 2 + (p.z - mean.z) ** 2; // XZ plane spread
    }, 0) / positions.length;

  const stdDev = Math.sqrt(variance);

  // Ideal: objects spread 2-15 units apart on average
  if (stdDev >= 2 && stdDev <= 15) return 10;
  if (stdDev >= 1 && stdDev < 2) return 7;
  if (stdDev > 15 && stdDev <= 25) return 7;
  if (stdDev < 1) return 3; // all piled at origin
  return 5; // very spread out
}
