/**
 * Zustand store for editor state management.
 *
 * This store holds the selection state and scene graph data,
 * synchronized with the Rust engine via bridge events.
 */

import { create } from 'zustand';

// Scene node data matching Rust's SceneNodeData struct
export interface SceneNode {
  entityId: string;
  name: string;
  parentId: string | null;
  children: string[];
  components: string[];
  visible: boolean;
}

// Full scene graph matching Rust's SceneGraphData struct
export interface SceneGraph {
  nodes: Record<string, SceneNode>;
  rootIds: string[];
}

// Transform data for an entity
export interface TransformData {
  entityId: string;
  position: [number, number, number];
  rotation: [number, number, number]; // Euler angles in radians
  scale: [number, number, number];
}

// Gizmo manipulation mode
export type GizmoMode = 'translate' | 'rotate' | 'scale';

// Entity types that can be spawned
export type EntityType = 'cube' | 'sphere' | 'plane' | 'cylinder' | 'point_light' | 'directional_light' | 'spot_light';

// Snap settings
export interface SnapSettings {
  snapEnabled: boolean;
  translationSnap: number;
  rotationSnapDegrees: number;
  scaleSnap: number;
  gridVisible: boolean;
  gridSize: number;
  gridExtent: number;
}

// Camera preset types
export type CameraPreset = 'top' | 'front' | 'right' | 'perspective' | null;

// Coordinate mode type
export type CoordinateMode = 'world' | 'local';

// Engine mode type
export type EngineMode = 'edit' | 'play' | 'paused';

// Input binding data matching Rust's ActionDef
export interface InputBinding {
  actionName: string;
  actionType: 'digital' | 'axis';
  sources: string[];           // For digital: key/button codes
  positiveKeys?: string[];     // For axis: positive direction keys
  negativeKeys?: string[];     // For axis: negative direction keys
  deadZone?: number;
}

// Input preset names
export type InputPreset = 'fps' | 'platformer' | 'topdown' | 'racing' | null;

// Light data matching Rust's LightData struct
export interface LightData {
  lightType: 'point' | 'directional' | 'spot';
  color: [number, number, number];
  intensity: number;
  shadowsEnabled: boolean;
  shadowDepthBias: number;
  shadowNormalBias: number;
  range: number;
  radius: number;
  innerAngle: number;
  outerAngle: number;
}

// Ambient light data
export interface AmbientLightData {
  color: [number, number, number];
  brightness: number;
}

// Environment data matching Rust's EnvironmentSettings struct
export interface EnvironmentData {
  skyboxBrightness: number;
  iblIntensity: number;
  iblRotationDegrees: number;
  clearColor: [number, number, number];
  fogEnabled: boolean;
  fogColor: [number, number, number];
  fogStart: number;
  fogEnd: number;
}

// Physics data matching Rust's PhysicsData struct
export interface PhysicsData {
  bodyType: 'dynamic' | 'fixed' | 'kinematic_position' | 'kinematic_velocity';
  colliderShape: 'cuboid' | 'ball' | 'cylinder' | 'capsule' | 'auto';
  restitution: number;
  friction: number;
  density: number;
  gravityScale: number;
  lockTranslationX: boolean;
  lockTranslationY: boolean;
  lockTranslationZ: boolean;
  lockRotationX: boolean;
  lockRotationY: boolean;
  lockRotationZ: boolean;
  isSensor: boolean;
}

// Material data matching Rust's MaterialData struct
export interface MaterialData {
  baseColor: [number, number, number, number];
  metallic: number;
  perceptualRoughness: number;
  reflectance: number;
  emissive: [number, number, number, number];
  emissiveExposureWeight: number;
  alphaMode: 'opaque' | 'blend' | 'mask';
  alphaCutoff: number;
  doubleSided: boolean;
  unlit: boolean;
  baseColorTexture?: string | null;
  normalMapTexture?: string | null;
  metallicRoughnessTexture?: string | null;
  emissiveTexture?: string | null;
  occlusionTexture?: string | null;
}

// Asset metadata matching Rust's AssetMetadata struct
export interface AssetMetadata {
  id: string;
  name: string;
  kind: 'gltf_model' | 'texture' | 'audio';
  fileSize: number;
  source: { type: 'upload'; filename: string } | { type: 'url'; url: string } | { type: 'generated'; provider: string; prompt: string };
}

// Script data matching Rust's ScriptData struct
export interface ScriptData {
  source: string;
  enabled: boolean;
  template?: string | null;
}

// Script log entry from Worker
export interface ScriptLogEntry {
  entityId: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  timestamp: number;
}

// Audio data matching Rust's AudioData struct
export interface AudioData {
  assetId: string | null;
  volume: number;
  pitch: number;
  loopAudio: boolean;
  spatial: boolean;
  maxDistance: number;
  refDistance: number;
  rolloffFactor: number;
  autoplay: boolean;
  bus: string;
}

// Audio bus definition
export interface AudioBusDef {
  name: string;
  volume: number;
  muted: boolean;
  soloed: boolean;
  effects: AudioEffectDef[];
}

// Audio effect definition
export interface AudioEffectDef {
  effectType: string;
  params: Record<string, number>;
  enabled: boolean;
}

// Animation clip info matching Rust's AnimationClipInfo
export interface AnimationClipInfo {
  name: string;
  nodeIndex: number;
  durationSecs: number;
}

// Animation playback state matching Rust's AnimationPlaybackState
export interface AnimationPlaybackState {
  entityId: string;
  availableClips: AnimationClipInfo[];
  activeClipName: string | null;
  activeNodeIndex: number | null;
  isPlaying: boolean;
  isPaused: boolean;
  elapsedSecs: number;
  speed: number;
  isLooping: boolean;
  isFinished: boolean;
}

// Particle blend mode
export type ParticleBlendMode = 'additive' | 'alpha_blend' | 'premultiply';

// Emission shape
export type EmissionShape =
  | { type: 'point' }
  | { type: 'sphere'; radius: number }
  | { type: 'cone'; radius: number; height: number }
  | { type: 'box'; halfExtents: [number, number, number] }
  | { type: 'circle'; radius: number };

// Spawner mode
export type SpawnerMode =
  | { type: 'continuous'; rate: number }
  | { type: 'burst'; count: number }
  | { type: 'once'; count: number };

// Particle orientation
export type ParticleOrientation = 'billboard' | 'velocity_aligned' | 'fixed';

// Particle preset
export type ParticlePreset =
  | 'fire' | 'smoke' | 'sparks' | 'rain' | 'snow'
  | 'explosion' | 'magic_sparkle' | 'dust' | 'trail' | 'custom';

// Gradient stop
export interface GradientStop {
  position: number;
  color: [number, number, number, number];
}

// Size keyframe
export interface SizeKeyframe {
  position: number;
  size: number;
}

// Particle data matching Rust's ParticleData struct
export interface ParticleData {
  preset: ParticlePreset;
  spawnerMode: SpawnerMode;
  maxParticles: number;
  lifetimeMin: number;
  lifetimeMax: number;
  emissionShape: EmissionShape;
  velocityMin: [number, number, number];
  velocityMax: [number, number, number];
  acceleration: [number, number, number];
  linearDrag: number;
  sizeStart: number;
  sizeEnd: number;
  sizeKeyframes: SizeKeyframe[];
  colorGradient: GradientStop[];
  blendMode: ParticleBlendMode;
  orientation: ParticleOrientation;
  worldSpace: boolean;
}

// Bloom settings matching Rust's BloomSettings
export interface BloomData {
  enabled: boolean;
  intensity: number;
  lowFrequencyBoost: number;
  lowFrequencyBoostCurvature: number;
  highPassFrequency: number;
  prefilterThreshold: number;
  prefilterThresholdSoftness: number;
  compositeMode: 'energy_conserving' | 'additive';
  maxMipDimension: number;
}

// Chromatic aberration settings matching Rust's ChromaticAberrationSettings
export interface ChromaticAberrationData {
  enabled: boolean;
  intensity: number;
  maxSamples: number;
}

// Color grading global section
export interface ColorGradingGlobalData {
  exposure: number;
  temperature: number;
  tint: number;
  hue: number;
  postSaturation: number;
}

// Color grading per-range section
export interface ColorGradingSectionData {
  saturation: number;
  contrast: number;
  gamma: number;
  gain: number;
  lift: number;
}

// Color grading settings matching Rust's ColorGradingSettings
export interface ColorGradingData {
  enabled: boolean;
  global: ColorGradingGlobalData;
  shadows: ColorGradingSectionData;
  midtones: ColorGradingSectionData;
  highlights: ColorGradingSectionData;
}

// Sharpening settings matching Rust's SharpeningSettings
export interface SharpeningData {
  enabled: boolean;
  sharpeningStrength: number;
  denoise: boolean;
}

// Top-level post-processing data
export interface PostProcessingData {
  bloom: BloomData;
  chromaticAberration: ChromaticAberrationData;
  colorGrading: ColorGradingData;
  sharpening: SharpeningData;
}

export const DEFAULT_POST_PROCESSING: PostProcessingData = {
  bloom: {
    enabled: false,
    intensity: 0.15,
    lowFrequencyBoost: 0.7,
    lowFrequencyBoostCurvature: 0.95,
    highPassFrequency: 1.0,
    prefilterThreshold: 0.0,
    prefilterThresholdSoftness: 0.0,
    compositeMode: 'energy_conserving',
    maxMipDimension: 512,
  },
  chromaticAberration: {
    enabled: false,
    intensity: 0.02,
    maxSamples: 8,
  },
  colorGrading: {
    enabled: false,
    global: { exposure: 0.0, temperature: 0.0, tint: 0.0, hue: 0.0, postSaturation: 1.0 },
    shadows: { saturation: 1.0, contrast: 1.0, gamma: 1.0, gain: 1.0, lift: 0.0 },
    midtones: { saturation: 1.0, contrast: 1.0, gamma: 1.0, gain: 1.0, lift: 0.0 },
    highlights: { saturation: 1.0, contrast: 1.0, gamma: 1.0, gain: 1.0, lift: 0.0 },
  },
  sharpening: {
    enabled: false,
    sharpeningStrength: 0.6,
    denoise: false,
  },
};

export interface EditorState {
  // Hierarchy filter
  hierarchyFilter: string;
  // Selection state (multi-select)
  selectedIds: Set<string>;
  primaryId: string | null;
  primaryName: string | null;

  // Scene graph
  sceneGraph: SceneGraph;

  // Gizmo state
  gizmoMode: GizmoMode;
  primaryTransform: TransformData | null;

  // History state
  canUndo: boolean;
  canRedo: boolean;
  undoDescription: string | null;
  redoDescription: string | null;

  // Snap settings
  snapSettings: SnapSettings;

  // Camera preset state
  currentCameraPreset: CameraPreset;

  // Material state
  primaryMaterial: MaterialData | null;

  // Light state
  primaryLight: LightData | null;
  ambientLight: AmbientLightData;

  // Environment state
  environment: EnvironmentData;

  // Coordinate mode state
  coordinateMode: CoordinateMode;

  // Engine mode state
  engineMode: EngineMode;

  // Physics state
  primaryPhysics: PhysicsData | null;
  physicsEnabled: boolean;
  debugPhysics: boolean;

  // Input bindings state
  inputBindings: InputBinding[];
  inputPreset: InputPreset;

  // Asset registry state
  assetRegistry: Record<string, AssetMetadata>;

  // Script state
  primaryScript: ScriptData | null;
  allScripts: Record<string, ScriptData>;
  scriptLogs: ScriptLogEntry[];

  // Audio state
  primaryAudio: AudioData | null;
  audioBuses: AudioBusDef[];
  mixerPanelOpen: boolean;

  // Particle state
  primaryParticle: ParticleData | null;
  particleEnabled: boolean;

  // Animation state
  primaryAnimation: AnimationPlaybackState | null;

  // Post-processing state
  postProcessing: PostProcessingData;

  // Scene file state
  sceneName: string;
  sceneModified: boolean;
  autoSaveEnabled: boolean;

  // Export state
  isExporting: boolean;

  // Cloud project state
  projectId: string | null;
  cloudSaveStatus: 'idle' | 'saving' | 'saved' | 'error';
  lastCloudSave: string | null;

  // Selection actions
  selectEntity: (id: string, mode: 'replace' | 'add' | 'toggle') => void;
  selectRange: (fromId: string, toId: string) => void;
  clearSelection: () => void;
  setSelection: (
    selectedIds: string[],
    primaryId: string | null,
    primaryName: string | null
  ) => void;

  // Scene graph actions
  updateSceneGraph: (graph: SceneGraph) => void;

  // Visibility actions (sends command to Rust)
  toggleVisibility: (entityId: string) => void;

  // Gizmo actions
  setGizmoMode: (mode: GizmoMode) => void;
  setPrimaryTransform: (transform: TransformData) => void;

  // Inspector actions (sends commands to Rust)
  updateTransform: (
    entityId: string,
    field: 'position' | 'rotation' | 'scale',
    value: [number, number, number]
  ) => void;
  renameEntity: (entityId: string, newName: string) => void;

  // Entity CRUD actions
  spawnEntity: (type: EntityType, name?: string) => void;
  deleteSelectedEntities: () => void;
  duplicateSelectedEntity: () => void;
  reparentEntity: (
    entityId: string,
    newParentId: string | null,
    insertIndex?: number
  ) => void;

  // History actions
  undo: () => void;
  redo: () => void;
  setHistoryState: (
    canUndo: boolean,
    canRedo: boolean,
    undoDescription: string | null,
    redoDescription: string | null
  ) => void;

  // Snap actions
  setSnapSettings: (settings: Partial<SnapSettings>) => void;
  toggleGrid: () => void;

  // Camera preset actions
  setCameraPreset: (preset: 'top' | 'front' | 'right' | 'perspective') => void;
  setCurrentCameraPreset: (preset: CameraPreset) => void;

  // Material actions
  setPrimaryMaterial: (material: MaterialData) => void;
  updateMaterial: (entityId: string, material: MaterialData) => void;

  // Light actions
  setPrimaryLight: (light: LightData) => void;
  updateLight: (entityId: string, light: LightData) => void;
  setAmbientLight: (data: AmbientLightData) => void;
  updateAmbientLight: (data: Partial<AmbientLightData>) => void;

  // Environment actions
  setEnvironment: (data: EnvironmentData) => void;
  updateEnvironment: (data: Partial<EnvironmentData>) => void;

  // Coordinate mode actions
  setCoordinateMode: (mode: CoordinateMode) => void;
  toggleCoordinateMode: () => void;

  // Engine mode actions
  play: () => void;
  stop: () => void;
  pause: () => void;
  resume: () => void;
  setEngineMode: (mode: EngineMode) => void;

  // Physics actions
  setPrimaryPhysics: (data: PhysicsData | null, enabled: boolean) => void;
  updatePhysics: (entityId: string, data: PhysicsData) => void;
  togglePhysics: (entityId: string, enabled: boolean) => void;
  toggleDebugPhysics: () => void;
  setDebugPhysics: (enabled: boolean) => void;

  // Input binding actions
  setInputBinding: (binding: InputBinding) => void;
  removeInputBinding: (actionName: string) => void;
  setInputPreset: (preset: 'fps' | 'platformer' | 'topdown' | 'racing') => void;
  setInputBindings: (bindings: InputBinding[], preset: InputPreset) => void;

  // Script actions
  setScript: (entityId: string, source: string, enabled: boolean, template?: string) => void;
  removeScript: (entityId: string) => void;
  applyScriptTemplate: (entityId: string, templateId: string, source: string) => void;
  setPrimaryScript: (script: ScriptData | null) => void;
  setEntityScript: (entityId: string, script: ScriptData | null) => void;
  addScriptLog: (entry: ScriptLogEntry) => void;
  clearScriptLogs: () => void;

  // Audio actions
  setAudio: (entityId: string, data: Partial<AudioData>) => void;
  removeAudio: (entityId: string) => void;
  playAudio: (entityId: string) => void;
  stopAudio: (entityId: string) => void;
  pauseAudio: (entityId: string) => void;
  setEntityAudio: (entityId: string, audio: AudioData | null) => void;

  // Audio bus actions
  setAudioBuses: (buses: AudioBusDef[]) => void;
  updateAudioBus: (busName: string, update: { volume?: number; muted?: boolean; soloed?: boolean }) => void;
  createAudioBus: (name: string, volume?: number) => void;
  deleteAudioBus: (busName: string) => void;
  setBusEffects: (busName: string, effects: AudioEffectDef[]) => void;
  toggleMixerPanel: () => void;

  // Particle actions
  setParticle: (entityId: string, data: Partial<ParticleData>) => void;
  removeParticle: (entityId: string) => void;
  toggleParticle: (entityId: string, enabled: boolean) => void;
  setParticlePreset: (entityId: string, preset: ParticlePreset) => void;
  playParticle: (entityId: string) => void;
  stopParticle: (entityId: string) => void;
  burstParticle: (entityId: string, count?: number) => void;
  setEntityParticle: (entityId: string, data: ParticleData | null, enabled: boolean) => void;
  setPrimaryParticle: (data: ParticleData | null, enabled: boolean) => void;

  // Animation actions
  playAnimation: (entityId: string, clipName: string, crossfadeSecs?: number) => void;
  pauseAnimation: (entityId: string) => void;
  resumeAnimation: (entityId: string) => void;
  stopAnimation: (entityId: string) => void;
  seekAnimation: (entityId: string, timeSecs: number) => void;
  setAnimationSpeed: (entityId: string, speed: number) => void;
  setAnimationLoop: (entityId: string, looping: boolean) => void;
  setEntityAnimation: (entityId: string, state: AnimationPlaybackState | null) => void;
  setPrimaryAnimation: (state: AnimationPlaybackState | null) => void;

  // Asset actions
  importGltf: (dataBase64: string, name: string) => void;
  loadTexture: (dataBase64: string, name: string, entityId: string, slot: string) => void;
  removeTexture: (entityId: string, slot: string) => void;
  importAudio: (dataBase64: string, name: string) => void;
  placeAsset: (assetId: string) => void;
  deleteAsset: (assetId: string) => void;
  setAssetRegistry: (assets: Record<string, AssetMetadata>) => void;
  addAssetToRegistry: (asset: AssetMetadata) => void;
  removeAssetFromRegistry: (assetId: string) => void;

  // Scene file actions
  saveScene: () => void;
  loadScene: (json: string) => void;
  newScene: () => void;
  setSceneName: (name: string) => void;
  setSceneModified: (modified: boolean) => void;
  setAutoSaveEnabled: (enabled: boolean) => void;

  // Hierarchy filter actions
  setHierarchyFilter: (filter: string) => void;
  clearHierarchyFilter: () => void;

  // Export actions
  setExporting: (value: boolean) => void;

  // Cloud project actions
  setProjectId: (id: string | null) => void;
  saveToCloud: () => void;
  setCloudSaveStatus: (status: 'idle' | 'saving' | 'saved' | 'error') => void;

  // Post-processing actions
  updatePostProcessing: (partial: Partial<PostProcessingData>) => void;
  updateBloom: (partial: Partial<BloomData>) => void;
  updateChromaticAberration: (partial: Partial<ChromaticAberrationData>) => void;
  updateColorGrading: (partial: Partial<ColorGradingData>) => void;
  updateSharpening: (partial: Partial<SharpeningData>) => void;
  setPostProcessing: (data: PostProcessingData) => void;
}

// Command dispatcher type - will be set by useEngine hook
type CommandDispatcher = (command: string, payload: unknown) => void;
let dispatchCommand: CommandDispatcher | null = null;

export function setCommandDispatcher(dispatcher: CommandDispatcher): void {
  dispatchCommand = dispatcher;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  // Initial state
  selectedIds: new Set<string>(),
  primaryId: null,
  primaryName: null,
  sceneGraph: { nodes: {}, rootIds: [] },
  gizmoMode: 'translate',
  primaryTransform: null,
  canUndo: false,
  canRedo: false,
  undoDescription: null,
  redoDescription: null,
  snapSettings: {
    snapEnabled: false,
    translationSnap: 0.5,
    rotationSnapDegrees: 15,
    scaleSnap: 0.25,
    gridVisible: false,
    gridSize: 0.5,
    gridExtent: 20,
  },
  primaryMaterial: null,
  primaryLight: null,
  ambientLight: { color: [1, 1, 1], brightness: 300 },
  environment: {
    skyboxBrightness: 1000,
    iblIntensity: 900,
    iblRotationDegrees: 0,
    clearColor: [0.1, 0.1, 0.12],
    fogEnabled: false,
    fogColor: [0.5, 0.5, 0.55],
    fogStart: 30,
    fogEnd: 100,
  },
  currentCameraPreset: 'perspective',
  coordinateMode: 'world',
  engineMode: 'edit',
  primaryPhysics: null,
  physicsEnabled: false,
  debugPhysics: false,
  inputBindings: [],
  inputPreset: null,
  assetRegistry: {},
  primaryScript: null,
  allScripts: {},
  scriptLogs: [],
  primaryAudio: null,
  audioBuses: [
    { name: 'master', volume: 1.0, muted: false, soloed: false, effects: [] },
    { name: 'sfx', volume: 1.0, muted: false, soloed: false, effects: [] },
    { name: 'music', volume: 0.8, muted: false, soloed: false, effects: [] },
    { name: 'ambient', volume: 0.7, muted: false, soloed: false, effects: [] },
    { name: 'voice', volume: 1.0, muted: false, soloed: false, effects: [] },
  ],
  mixerPanelOpen: false,
  primaryParticle: null,
  particleEnabled: false,
  primaryAnimation: null,
  sceneName: 'Untitled',
  sceneModified: false,
  autoSaveEnabled: true,
  hierarchyFilter: '',
  isExporting: false,
  projectId: null,
  cloudSaveStatus: 'idle',
  lastCloudSave: null,
  postProcessing: DEFAULT_POST_PROCESSING,

  // Select a single entity or modify selection
  selectEntity: (id, mode) => {
    const state = get();

    switch (mode) {
      case 'replace':
        set({
          selectedIds: new Set([id]),
          primaryId: id,
          primaryName: state.sceneGraph.nodes[id]?.name ?? null,
        });
        break;
      case 'add':
        const newSet = new Set(state.selectedIds);
        newSet.add(id);
        set({
          selectedIds: newSet,
          primaryId: id,
          primaryName: state.sceneGraph.nodes[id]?.name ?? null,
        });
        break;
      case 'toggle':
        const toggleSet = new Set(state.selectedIds);
        if (toggleSet.has(id)) {
          toggleSet.delete(id);
          // Update primary if we removed it
          const newPrimaryId =
            state.primaryId === id
              ? (toggleSet.values().next().value ?? null)
              : state.primaryId;
          set({
            selectedIds: toggleSet,
            primaryId: newPrimaryId,
            primaryName: newPrimaryId
              ? (state.sceneGraph.nodes[newPrimaryId]?.name ?? null)
              : null,
          });
        } else {
          toggleSet.add(id);
          set({
            selectedIds: toggleSet,
            primaryId: id,
            primaryName: state.sceneGraph.nodes[id]?.name ?? null,
          });
        }
        break;
    }

    // Send command to Rust
    if (dispatchCommand) {
      dispatchCommand('select_entity', { entityId: id, mode });
    }
  },

  // Select a range of entities (Shift+Click)
  selectRange: (fromId, toId) => {
    const state = get();
    const { rootIds, nodes } = state.sceneGraph;

    // Flatten the tree to get ordered entity IDs
    const flattenTree = (ids: string[]): string[] => {
      const result: string[] = [];
      for (const id of ids) {
        result.push(id);
        const node = nodes[id];
        if (node?.children.length) {
          result.push(...flattenTree(node.children));
        }
      }
      return result;
    };

    const orderedIds = flattenTree(rootIds);
    const fromIndex = orderedIds.indexOf(fromId);
    const toIndex = orderedIds.indexOf(toId);

    if (fromIndex === -1 || toIndex === -1) return;

    const start = Math.min(fromIndex, toIndex);
    const end = Math.max(fromIndex, toIndex);
    const rangeIds = orderedIds.slice(start, end + 1);

    set({
      selectedIds: new Set(rangeIds),
      primaryId: toId,
      primaryName: nodes[toId]?.name ?? null,
    });

    // Send command to Rust
    if (dispatchCommand) {
      dispatchCommand('select_entities', { entityIds: rangeIds, mode: 'replace' });
    }
  },

  // Clear all selection
  clearSelection: () => {
    set({
      selectedIds: new Set(),
      primaryId: null,
      primaryName: null,
      primaryMaterial: null,
      primaryLight: null,
      primaryParticle: null,
      particleEnabled: false,
    });

    // Send command to Rust
    if (dispatchCommand) {
      dispatchCommand('clear_selection', {});
    }
  },

  // Set selection from Rust event (doesn't send command back)
  setSelection: (selectedIds, primaryId, primaryName) => {
    set({
      selectedIds: new Set(selectedIds),
      primaryId,
      primaryName,
    });
  },

  // Update scene graph from Rust event
  updateSceneGraph: (graph) => {
    set({ sceneGraph: graph });
  },

  // Toggle entity visibility
  toggleVisibility: (entityId) => {
    const state = get();
    const node = state.sceneGraph.nodes[entityId];
    if (!node) return;

    const newVisible = !node.visible;

    // Optimistically update local state
    set({
      sceneGraph: {
        ...state.sceneGraph,
        nodes: {
          ...state.sceneGraph.nodes,
          [entityId]: { ...node, visible: newVisible },
        },
      },
    });

    // Send command to Rust
    if (dispatchCommand) {
      dispatchCommand('set_visibility', { entityId, visible: newVisible });
    }
  },

  // Set gizmo mode
  setGizmoMode: (mode) => {
    set({ gizmoMode: mode });

    // Send command to Rust
    if (dispatchCommand) {
      dispatchCommand('set_gizmo_mode', { mode });
    }
  },

  // Set primary transform from Rust event (doesn't send command back)
  setPrimaryTransform: (transform) => {
    set({ primaryTransform: transform });
  },

  // Update transform and send to Rust
  updateTransform: (entityId, field, value) => {
    const state = get();

    // Optimistically update local state
    if (state.primaryTransform && state.primaryTransform.entityId === entityId) {
      set({
        primaryTransform: {
          ...state.primaryTransform,
          [field]: value,
        },
      });
    }

    // Send command to Rust
    if (dispatchCommand) {
      dispatchCommand('update_transform', {
        entityId,
        [field]: value,
      });
    }
  },

  // Rename entity and send to Rust
  renameEntity: (entityId, newName) => {
    const state = get();

    // Optimistically update local state
    const node = state.sceneGraph.nodes[entityId];
    if (node) {
      set({
        sceneGraph: {
          ...state.sceneGraph,
          nodes: {
            ...state.sceneGraph.nodes,
            [entityId]: { ...node, name: newName },
          },
        },
        // Update primaryName if this is the selected entity
        primaryName: state.primaryId === entityId ? newName : state.primaryName,
      });
    }

    // Send command to Rust
    if (dispatchCommand) {
      dispatchCommand('rename_entity', { entityId, name: newName });
    }
  },

  // Spawn a new entity
  spawnEntity: (type, name) => {
    if (dispatchCommand) {
      dispatchCommand('spawn_entity', { entityType: type, name });
    }
  },

  // Delete all selected entities
  deleteSelectedEntities: () => {
    const state = get();
    const entityIds = Array.from(state.selectedIds);

    if (entityIds.length === 0) return;

    // Clear selection optimistically
    set({
      selectedIds: new Set(),
      primaryId: null,
      primaryName: null,
      primaryTransform: null,
    });

    // Send command to Rust
    if (dispatchCommand) {
      dispatchCommand('delete_entities', { entityIds });
    }
  },

  // Duplicate the primary selected entity
  duplicateSelectedEntity: () => {
    const state = get();

    if (!state.primaryId) return;

    // Send command to Rust
    if (dispatchCommand) {
      dispatchCommand('duplicate_entity', { entityId: state.primaryId });
    }
  },

  // Reparent an entity to a new parent
  reparentEntity: (entityId, newParentId, insertIndex) => {
    if (dispatchCommand) {
      dispatchCommand('reparent_entity', {
        entityId,
        newParentId,
        insertIndex,
      });
    }
  },

  // Undo the last action
  undo: () => {
    if (dispatchCommand) {
      dispatchCommand('undo', {});
    }
  },

  // Redo the last undone action
  redo: () => {
    if (dispatchCommand) {
      dispatchCommand('redo', {});
    }
  },

  // Update history state from Rust event
  setHistoryState: (canUndo, canRedo, undoDescription, redoDescription) => {
    set({
      canUndo,
      canRedo,
      undoDescription,
      redoDescription,
    });
  },

  // Update snap settings and send to Rust
  setSnapSettings: (settings) => {
    const state = get();
    const newSettings = { ...state.snapSettings, ...settings };

    set({ snapSettings: newSettings });

    // Send command to Rust
    if (dispatchCommand) {
      dispatchCommand('set_snap_settings', settings);
    }
  },

  // Toggle grid visibility
  toggleGrid: () => {
    // Send command to Rust
    if (dispatchCommand) {
      dispatchCommand('toggle_grid', {});
    }
  },

  // Set camera preset (sends command to Rust)
  setCameraPreset: (preset) => {
    if (dispatchCommand) {
      dispatchCommand('set_camera_preset', { preset });
    }
  },

  // Update camera preset from Rust event (doesn't send command back)
  setCurrentCameraPreset: (preset) => {
    set({ currentCameraPreset: preset });
  },

  // Set primary material from Rust event (doesn't send command back)
  setPrimaryMaterial: (material) => {
    set({ primaryMaterial: material });
  },

  // Update material and send to Rust
  updateMaterial: (entityId, material) => {
    set({ primaryMaterial: material });

    if (dispatchCommand) {
      dispatchCommand('update_material', {
        entityId,
        baseColor: material.baseColor,
        metallic: material.metallic,
        perceptualRoughness: material.perceptualRoughness,
        reflectance: material.reflectance,
        emissive: material.emissive,
        emissiveExposureWeight: material.emissiveExposureWeight,
        alphaMode: material.alphaMode,
        alphaCutoff: material.alphaCutoff,
        doubleSided: material.doubleSided,
        unlit: material.unlit,
      });
    }
  },

  // Set primary light from Rust event (doesn't send command back)
  setPrimaryLight: (light) => {
    set({ primaryLight: light });
  },

  // Update light and send to Rust
  updateLight: (entityId, light) => {
    set({ primaryLight: light });

    if (dispatchCommand) {
      dispatchCommand('update_light', {
        entityId,
        color: light.color,
        intensity: light.intensity,
        shadowsEnabled: light.shadowsEnabled,
        shadowDepthBias: light.shadowDepthBias,
        shadowNormalBias: light.shadowNormalBias,
        range: light.range,
        radius: light.radius,
        innerAngle: light.innerAngle,
        outerAngle: light.outerAngle,
      });
    }
  },

  // Set ambient light from Rust event (doesn't send command back)
  setAmbientLight: (data) => {
    set({ ambientLight: data });
  },

  // Update ambient light and send to Rust
  updateAmbientLight: (data) => {
    const state = get();
    const newAmbient = { ...state.ambientLight, ...data };
    set({ ambientLight: newAmbient });

    if (dispatchCommand) {
      dispatchCommand('update_ambient_light', data);
    }
  },

  // Set environment from Rust event (doesn't send command back)
  setEnvironment: (data) => {
    set({ environment: data });
  },

  // Update environment and send to Rust
  updateEnvironment: (data) => {
    const state = get();
    const newEnv = { ...state.environment, ...data };
    set({ environment: newEnv });

    if (dispatchCommand) {
      dispatchCommand('update_environment', data);
    }
  },

  // Set coordinate mode (sends command to Rust)
  setCoordinateMode: (mode) => {
    set({ coordinateMode: mode });

    // Send command to Rust
    if (dispatchCommand) {
      dispatchCommand('set_coordinate_mode', { mode });
    }
  },

  // Toggle coordinate mode
  toggleCoordinateMode: () => {
    const currentMode = get().coordinateMode;
    const newMode = currentMode === 'world' ? 'local' : 'world';

    set({ coordinateMode: newMode });

    // Send command to Rust
    if (dispatchCommand) {
      dispatchCommand('set_coordinate_mode', { mode: newMode });
    }
  },

  // Play mode actions
  play: () => {
    if (dispatchCommand) {
      dispatchCommand('play', {});
    }
  },

  stop: () => {
    if (dispatchCommand) {
      dispatchCommand('stop', {});
    }
  },

  pause: () => {
    if (dispatchCommand) {
      dispatchCommand('pause', {});
    }
  },

  resume: () => {
    if (dispatchCommand) {
      dispatchCommand('resume', {});
    }
  },

  setEngineMode: (mode) => {
    set({ engineMode: mode });
  },

  // Set primary physics from Rust event (doesn't send command back)
  setPrimaryPhysics: (data, enabled) => {
    set({ primaryPhysics: data, physicsEnabled: enabled });
  },

  // Update physics and send to Rust
  updatePhysics: (entityId, data) => {
    set({ primaryPhysics: data });

    if (dispatchCommand) {
      dispatchCommand('update_physics', {
        entityId,
        bodyType: data.bodyType,
        colliderShape: data.colliderShape,
        restitution: data.restitution,
        friction: data.friction,
        density: data.density,
        gravityScale: data.gravityScale,
        lockTranslationX: data.lockTranslationX,
        lockTranslationY: data.lockTranslationY,
        lockTranslationZ: data.lockTranslationZ,
        lockRotationX: data.lockRotationX,
        lockRotationY: data.lockRotationY,
        lockRotationZ: data.lockRotationZ,
        isSensor: data.isSensor,
      });
    }
  },

  // Toggle physics on/off for an entity
  togglePhysics: (entityId, enabled) => {
    set({ physicsEnabled: enabled });

    if (dispatchCommand) {
      dispatchCommand('toggle_physics', { entityId, enabled });
    }
  },

  // Toggle debug physics wireframes
  toggleDebugPhysics: () => {
    if (dispatchCommand) {
      dispatchCommand('toggle_debug_physics', {});
    }
  },

  // Set debug physics state from Rust event
  setDebugPhysics: (enabled) => {
    set({ debugPhysics: enabled });
  },

  // Set input binding and send to Rust
  setInputBinding: (binding) => {
    if (dispatchCommand) {
      dispatchCommand('set_input_binding', {
        actionName: binding.actionName,
        actionType: binding.actionType,
        sources: binding.sources,
        positiveKeys: binding.positiveKeys ?? [],
        negativeKeys: binding.negativeKeys ?? [],
        deadZone: binding.deadZone ?? 0.1,
      });
    }
  },

  // Remove input binding and send to Rust
  removeInputBinding: (actionName) => {
    if (dispatchCommand) {
      dispatchCommand('remove_input_binding', { actionName });
    }
  },

  // Set input preset and send to Rust
  setInputPreset: (preset) => {
    if (dispatchCommand) {
      dispatchCommand('set_input_preset', { preset });
    }
  },

  // Bulk update input bindings from engine event (doesn't send command back)
  setInputBindings: (bindings, preset) => {
    set({ inputBindings: bindings, inputPreset: preset });
  },

  // Import a glTF/GLB file
  importGltf: (dataBase64, name) => {
    if (dispatchCommand) {
      dispatchCommand('import_gltf', { dataBase64, name });
    }
  },

  // Load a texture and assign to a material slot
  loadTexture: (dataBase64, name, entityId, slot) => {
    if (dispatchCommand) {
      dispatchCommand('load_texture', { dataBase64, name, entityId, slot });
    }
  },

  // Remove a texture from a material slot
  removeTexture: (entityId, slot) => {
    if (dispatchCommand) {
      dispatchCommand('remove_texture', { entityId, slot });
    }
  },

  // Import an audio file
  importAudio: (dataBase64, name) => {
    if (dispatchCommand) {
      dispatchCommand('import_audio', { dataBase64, name });
    }
  },

  // Place an asset instance in the scene
  placeAsset: (assetId) => {
    if (dispatchCommand) {
      dispatchCommand('place_asset', { assetId });
    }
  },

  // Delete an asset from the registry
  deleteAsset: (assetId) => {
    if (dispatchCommand) {
      dispatchCommand('delete_asset', { assetId });
    }
  },

  // Set the full asset registry from engine event
  setAssetRegistry: (assets) => {
    set({ assetRegistry: assets });
  },

  // Add a single asset to the registry
  addAssetToRegistry: (asset) => {
    const state = get();
    set({
      assetRegistry: { ...state.assetRegistry, [asset.id]: asset },
    });
  },

  // Remove a single asset from the registry
  removeAssetFromRegistry: (assetId) => {
    const state = get();
    const newRegistry = { ...state.assetRegistry };
    delete newRegistry[assetId];
    set({ assetRegistry: newRegistry });
  },

  // Set script on an entity and send to Rust
  setScript: (entityId, source, enabled, template) => {
    const script: ScriptData = { source, enabled, template: template ?? null };
    set({ primaryScript: script });
    const state = get();
    set({ allScripts: { ...state.allScripts, [entityId]: script } });
    if (dispatchCommand) {
      dispatchCommand('set_script', { entityId, source, enabled, template: template ?? null });
    }
  },

  // Remove script from an entity
  removeScript: (entityId) => {
    set({ primaryScript: null });
    const state = get();
    const newScripts = { ...state.allScripts };
    delete newScripts[entityId];
    set({ allScripts: newScripts });
    if (dispatchCommand) {
      dispatchCommand('remove_script', { entityId });
    }
  },

  // Apply a script template
  applyScriptTemplate: (entityId, templateId, source) => {
    const script: ScriptData = { source, enabled: true, template: templateId };
    set({ primaryScript: script });
    const state = get();
    set({ allScripts: { ...state.allScripts, [entityId]: script } });
    if (dispatchCommand) {
      dispatchCommand('apply_script_template', { entityId, template: templateId, source });
    }
  },

  // Set primary script from engine event (doesn't send command back)
  setPrimaryScript: (script) => {
    set({ primaryScript: script });
  },

  // Set script for a specific entity (from engine events)
  setEntityScript: (entityId, script) => {
    const state = get();
    if (script) {
      set({ allScripts: { ...state.allScripts, [entityId]: script } });
    } else {
      const newScripts = { ...state.allScripts };
      delete newScripts[entityId];
      set({ allScripts: newScripts });
    }
    if (state.primaryId === entityId) {
      set({ primaryScript: script });
    }
  },

  // Add a script log entry
  addScriptLog: (entry) => {
    const state = get();
    // Keep max 200 log entries
    const logs = [...state.scriptLogs, entry].slice(-200);
    set({ scriptLogs: logs });
  },

  // Clear script logs
  clearScriptLogs: () => {
    set({ scriptLogs: [] });
  },

  // Set audio on an entity and send to Rust
  setAudio: (entityId, data) => {
    if (dispatchCommand) {
      dispatchCommand('set_audio', { entityId, ...data });
    }
  },

  // Remove audio from an entity
  removeAudio: (entityId) => {
    set({ primaryAudio: null });
    if (dispatchCommand) {
      dispatchCommand('remove_audio', { entityId });
    }
  },

  // Play audio on an entity
  playAudio: (entityId) => {
    if (dispatchCommand) {
      dispatchCommand('play_audio', { entityId });
    }
  },

  // Stop audio on an entity
  stopAudio: (entityId) => {
    if (dispatchCommand) {
      dispatchCommand('stop_audio', { entityId });
    }
  },

  // Pause audio on an entity
  pauseAudio: (entityId) => {
    if (dispatchCommand) {
      dispatchCommand('pause_audio', { entityId });
    }
  },

  // Set audio for a specific entity (from engine events)
  setEntityAudio: (entityId, audio) => {
    const state = get();
    if (state.primaryId === entityId) {
      set({ primaryAudio: audio });
    }
  },

  // Save scene (triggers export, JS handles event for file download)
  saveScene: () => {
    if (dispatchCommand) {
      dispatchCommand('export_scene', {});
    }
  },

  // Load scene from JSON string
  loadScene: (json) => {
    if (dispatchCommand) {
      dispatchCommand('load_scene', { json });
    }
  },

  // New scene (clear everything)
  newScene: () => {
    if (dispatchCommand) {
      dispatchCommand('new_scene', {});
    }
  },

  // Set scene name
  setSceneName: (name) => {
    set({ sceneName: name, sceneModified: true });
  },

  // Set scene modified flag
  setSceneModified: (modified) => {
    set({ sceneModified: modified });
  },

  // Toggle auto-save
  setAutoSaveEnabled: (enabled) => {
    set({ autoSaveEnabled: enabled });
  },

  // Set hierarchy filter
  setHierarchyFilter: (filter) => {
    set({ hierarchyFilter: filter });
  },

  // Clear hierarchy filter
  clearHierarchyFilter: () => {
    set({ hierarchyFilter: '' });
  },

  // Set export state
  setExporting: (value) => {
    set({ isExporting: value });
  },

  // Cloud project actions
  setProjectId: (id) => {
    set({ projectId: id });
  },

  setCloudSaveStatus: (status) => {
    set({ cloudSaveStatus: status });
  },

  saveToCloud: () => {
    const { projectId, sceneName } = get();
    if (!projectId) return;

    set({ cloudSaveStatus: 'saving' });

    // Listen for scene export event to get JSON, then save to cloud
    const handler = async (e: CustomEvent<{ json: string; name: string }>) => {
      window.removeEventListener('forge:scene-exported', handler as unknown as EventListener);
      try {
        const res = await fetch(`/api/projects/${projectId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: sceneName,
            sceneData: JSON.parse(e.detail.json),
          }),
        });
        if (res.ok) {
          set({
            cloudSaveStatus: 'saved',
            lastCloudSave: new Date().toISOString(),
            sceneModified: false,
          });
        } else {
          set({ cloudSaveStatus: 'error' });
        }
      } catch {
        set({ cloudSaveStatus: 'error' });
      }
    };
    window.addEventListener('forge:scene-exported', handler as unknown as EventListener);
    if (dispatchCommand) {
      dispatchCommand('export_scene', {});
    }
  },

  // Post-processing actions
  updatePostProcessing: (partial) => {
    const current = get().postProcessing;
    const merged = {
      bloom: partial.bloom ?? current.bloom,
      chromaticAberration: partial.chromaticAberration ?? current.chromaticAberration,
      colorGrading: partial.colorGrading ?? current.colorGrading,
      sharpening: partial.sharpening ?? current.sharpening,
    };
    set({ postProcessing: merged });

    // Dispatch command to Rust
    if (dispatchCommand) {
      dispatchCommand('update_post_processing', {
        bloom: partial.bloom,
        chromaticAberration: partial.chromaticAberration,
        colorGrading: partial.colorGrading,
        sharpening: partial.sharpening,
      });
    }
  },

  updateBloom: (partial) => {
    const current = get().postProcessing.bloom;
    const merged = { ...current, ...partial };
    get().updatePostProcessing({ bloom: merged });
  },

  updateChromaticAberration: (partial) => {
    const current = get().postProcessing.chromaticAberration;
    const merged = { ...current, ...partial };
    get().updatePostProcessing({ chromaticAberration: merged });
  },

  updateColorGrading: (partial) => {
    const current = get().postProcessing.colorGrading;
    const merged = { ...current, ...partial };
    get().updatePostProcessing({ colorGrading: merged });
  },

  updateSharpening: (partial) => {
    const current = get().postProcessing.sharpening;
    const merged = { ...current, ...partial };
    get().updatePostProcessing({ sharpening: merged });
  },

  setPostProcessing: (data) => {
    set({ postProcessing: data });
  },

  // Audio bus actions
  setAudioBuses: (buses) => {
    set({ audioBuses: buses });
  },

  updateAudioBus: (busName, update) => {
    const state = get();
    const newBuses = state.audioBuses.map((bus) =>
      bus.name === busName ? { ...bus, ...update } : bus
    );
    set({ audioBuses: newBuses });

    // Dispatch command to Rust
    if (dispatchCommand) {
      dispatchCommand('update_audio_bus', { busName, ...update });
    }

    // Apply immediately to audioManager for zero-latency
    import('@/lib/audio/audioManager').then(({ audioManager }) => {
      if (update.volume !== undefined) audioManager.setBusVolume(busName, update.volume);
      if (update.muted !== undefined) audioManager.muteBus(busName, update.muted);
      if (update.soloed !== undefined) audioManager.soloBus(busName, update.soloed);
    });
  },

  createAudioBus: (name, volume) => {
    if (dispatchCommand) {
      dispatchCommand('create_audio_bus', { name, volume: volume ?? 1.0 });
    }
  },

  deleteAudioBus: (busName) => {
    if (dispatchCommand) {
      dispatchCommand('delete_audio_bus', { busName });
    }
  },

  setBusEffects: (busName, effects) => {
    if (dispatchCommand) {
      dispatchCommand('set_bus_effects', { busName, effects });
    }
  },

  toggleMixerPanel: () => {
    set((state) => ({ mixerPanelOpen: !state.mixerPanelOpen }));
  },

  // Particle actions
  setParticle: (entityId, data) => {
    if (dispatchCommand) {
      dispatchCommand('set_particle', { entityId, ...data });
    }
  },

  removeParticle: (entityId) => {
    set({ primaryParticle: null, particleEnabled: false });
    if (dispatchCommand) {
      dispatchCommand('remove_particle', { entityId });
    }
  },

  toggleParticle: (entityId, enabled) => {
    set({ particleEnabled: enabled });
    if (dispatchCommand) {
      dispatchCommand('toggle_particle', { entityId, enabled });
    }
  },

  setParticlePreset: (entityId, preset) => {
    if (dispatchCommand) {
      dispatchCommand('set_particle_preset', { entityId, preset });
    }
  },

  playParticle: (entityId) => {
    if (dispatchCommand) {
      dispatchCommand('play_particle', { entityId });
    }
  },

  stopParticle: (entityId) => {
    if (dispatchCommand) {
      dispatchCommand('stop_particle', { entityId });
    }
  },

  burstParticle: (entityId, count) => {
    if (dispatchCommand) {
      dispatchCommand('burst_particle', { entityId, count });
    }
  },

  setEntityParticle: (entityId, data, enabled) => {
    const state = get();
    if (state.primaryId === entityId) {
      set({ primaryParticle: data, particleEnabled: enabled });
    }
  },

  setPrimaryParticle: (data, enabled) => {
    set({ primaryParticle: data, particleEnabled: enabled });
  },

  // Animation actions
  playAnimation: (entityId, clipName, crossfadeSecs) => {
    if (dispatchCommand) {
      dispatchCommand('play_animation', { entityId, clipName, crossfadeSecs: crossfadeSecs ?? 0.3 });
    }
  },

  pauseAnimation: (entityId) => {
    if (dispatchCommand) {
      dispatchCommand('pause_animation', { entityId });
    }
  },

  resumeAnimation: (entityId) => {
    if (dispatchCommand) {
      dispatchCommand('resume_animation', { entityId });
    }
  },

  stopAnimation: (entityId) => {
    if (dispatchCommand) {
      dispatchCommand('stop_animation', { entityId });
    }
  },

  seekAnimation: (entityId, timeSecs) => {
    if (dispatchCommand) {
      dispatchCommand('seek_animation', { entityId, timeSecs });
    }
  },

  setAnimationSpeed: (entityId, speed) => {
    if (dispatchCommand) {
      dispatchCommand('set_animation_speed', { entityId, speed });
    }
  },

  setAnimationLoop: (entityId, looping) => {
    if (dispatchCommand) {
      dispatchCommand('set_animation_loop', { entityId, looping });
    }
  },

  setEntityAnimation: (entityId, state) => {
    const current = get();
    if (current.primaryId === entityId) {
      set({ primaryAnimation: state });
    }
  },

  setPrimaryAnimation: (state) => {
    set({ primaryAnimation: state });
  },
}));
