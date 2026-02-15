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
export type EntityType = 'cube' | 'sphere' | 'plane' | 'cylinder' | 'cone' | 'torus' | 'capsule' | 'terrain' | 'point_light' | 'directional_light' | 'spot_light' | 'csg_result' | 'procedural_mesh' | 'sprite';

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

// Scene transition config
export interface SceneTransitionConfig {
  type: 'fade' | 'wipe' | 'instant';
  duration: number;
  color: string;
  direction?: 'left' | 'right' | 'up' | 'down';
  easing: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';
}

export const DEFAULT_TRANSITION: SceneTransitionConfig = {
  type: 'fade',
  duration: 500,
  color: '#000000',
  easing: 'ease-in-out',
};

// Quality preset type
export type QualityPreset = 'low' | 'medium' | 'high' | 'ultra' | 'custom';

// 2D Project types
export type ProjectType = '2d' | '3d';

export interface SpriteData {
  textureAssetId: string | null;
  colorTint: [number, number, number, number]; // RGBA 0-1
  flipX: boolean;
  flipY: boolean;
  customSize: [number, number] | null;
  sortingLayer: string;
  sortingOrder: number;
  anchor: SpriteAnchor;
}

export type SpriteAnchor = 'center' | 'top_left' | 'top_center' | 'top_right' | 'middle_left' | 'middle_right' | 'bottom_left' | 'bottom_center' | 'bottom_right';

export interface Camera2dData {
  zoom: number;
  pixelPerfect: boolean;
  bounds: { minX: number; maxX: number; minY: number; maxY: number } | null;
}

export interface SortingLayerData {
  name: string;
  order: number;
  visible: boolean;
}

export interface Grid2dSettings {
  enabled: boolean;
  size: number;
  color: string;
  opacity: number;
  snapToGrid: boolean;
}

// Sprite Animation types (Phase 2D-2)
export interface SpriteSheetData {
  assetId: string;
  sliceMode: SliceMode;
  frames: FrameRect[];
  clips: Record<string, SpriteAnimClip>;
}

export type SliceMode =
  | { type: 'grid'; columns: number; rows: number; tileSize: [number, number]; padding: [number, number]; offset: [number, number] }
  | { type: 'manual'; regions: FrameRect[] };

export interface FrameRect {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SpriteAnimClip {
  name: string;
  frames: number[];
  frameDurations: { type: 'uniform'; duration: number } | { type: 'perFrame'; durations: number[] };
  looping: boolean;
  pingPong: boolean;
}

export interface SpriteAnimatorData {
  spriteSheetId: string;
  currentClip: string | null;
  frameIndex: number;
  playing: boolean;
  speed: number;
}

export interface AnimationStateMachineData {
  states: Record<string, string>; // stateName -> clipName
  transitions: StateTransitionData[];
  currentState: string;
  parameters: Record<string, AnimParamData>;
}

export interface StateTransitionData {
  fromState: string;
  toState: string;
  condition: TransitionCondition;
  duration: number;
}

export type TransitionCondition =
  | { type: 'always' }
  | { type: 'paramBool'; name: string; value: boolean }
  | { type: 'paramFloat'; name: string; op: 'greater' | 'less' | 'equal'; threshold: number }
  | { type: 'paramTrigger'; name: string };

export type AnimParamData =
  | { type: 'bool'; value: boolean }
  | { type: 'float'; value: number }
  | { type: 'trigger'; value: boolean };

// Skeletal 2D Animation types (Phase 2D-5)
export interface SkeletonData2d {
  bones: Bone2dDef[];
  slots: SlotDef[];
  skins: Record<string, SkinData2d>;
  activeSkin: string;
  ikConstraints: IkConstraint2d[];
}

export interface Bone2dDef {
  name: string;
  parentBone: string | null;
  localPosition: [number, number];
  localRotation: number;
  localScale: [number, number];
  length: number;
  color: [number, number, number, number];
}

export interface SlotDef {
  name: string;
  boneName: string;
  spritePart: string;
  blendMode: 'normal' | 'additive' | 'multiply' | 'screen';
  attachment: string | null;
}

export interface SkinData2d {
  name: string;
  attachments: Record<string, AttachmentData2d>;
}

export interface AttachmentData2d {
  type: 'sprite' | 'mesh';
  textureId: string;
  offset?: [number, number];
  rotation?: number;
  scale?: [number, number];
  vertices?: [number, number][];
  uvs?: [number, number][];
  triangles?: number[];
}

export interface IkConstraint2d {
  name: string;
  boneChain: string[];
  targetEntityId: number;
  bendDirection: number;
  mix: number;
}

export interface SkeletalAnimation2d {
  name: string;
  duration: number;
  looping: boolean;
  tracks: Record<string, BoneKeyframe2d[]>;
}

export interface BoneKeyframe2d {
  time: number;
  position?: [number, number];
  rotation?: number;
  scale?: [number, number];
  easing: 'linear' | 'ease_in' | 'ease_out' | 'ease_in_out' | 'step';
}

// Tilemap types (Phase 2D-3)
export interface TileMetadata {
  tileId: number;
  name: string | null;
  collision: boolean;
  animation: TileAnimation | null;
}

export interface TileAnimation {
  frameIds: number[];
  frameDuration: number;
}

export interface TilesetData {
  assetId: string;
  name: string | null;
  tileSize: [number, number];
  gridSize: [number, number];
  spacing: number;
  margin: number;
  tiles: TileMetadata[];
}

export interface TilemapLayer {
  name: string;
  tiles: (number | null)[];
  visible: boolean;
  opacity: number;
  isCollision: boolean;
}

export interface TilemapData {
  tilesetAssetId: string;
  tileSize: [number, number];
  mapSize: [number, number];
  layers: TilemapLayer[];
  origin: 'TopLeft' | 'Center';
}

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
  skyboxPreset: string | null;
  skyboxAssetId: string | null;
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

// Joint data matching Rust's JointData struct
export interface JointData {
  jointType: 'fixed' | 'revolute' | 'spherical' | 'prismatic' | 'rope' | 'spring';
  connectedEntityId: string;
  anchorSelf: [number, number, number];
  anchorOther: [number, number, number];
  axis: [number, number, number];
  limits: { min: number; max: number } | null;
  motor: { targetVelocity: number; maxForce: number } | null;
}

// 2D Physics data matching Rust's Physics2dData struct
export interface Physics2dData {
  bodyType: 'dynamic' | 'static' | 'kinematic';
  colliderShape: 'box' | 'circle' | 'capsule' | 'convex_polygon' | 'edge' | 'auto';
  size: [number, number];
  radius: number;
  vertices: [number, number][];
  mass: number;
  friction: number;
  restitution: number;
  gravityScale: number;
  isSensor: boolean;
  lockRotation: boolean;
  continuousDetection: boolean;
  oneWayPlatform: boolean;
  surfaceVelocity: [number, number];
}

// 2D Joint data matching Rust's PhysicsJoint2d struct
export interface Joint2dData {
  targetEntityId: number;
  jointType: 'revolute' | 'prismatic' | 'rope' | 'spring';
  localAnchor1: [number, number];
  localAnchor2: [number, number];
  limits?: [number, number];
  motorVelocity?: number;
  motorMaxForce?: number;
  axis?: [number, number];
  maxDistance?: number;
  restLength?: number;
  stiffness?: number;
  damping?: number;
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
  // UV Transform (E-1a)
  uvOffset?: [number, number];
  uvScale?: [number, number];
  uvRotation?: number;
  // Parallax Mapping (E-1b)
  depthMapTexture?: string | null;
  parallaxDepthScale?: number;
  parallaxMappingMethod?: 'occlusion' | 'relief';
  maxParallaxLayerCount?: number;
  parallaxReliefMaxSteps?: number;
  // Clearcoat (E-1c)
  clearcoat?: number;
  clearcoatPerceptualRoughness?: number;
  clearcoatTexture?: string | null;
  clearcoatRoughnessTexture?: string | null;
  clearcoatNormalTexture?: string | null;
  // Transmission (E-1d)
  specularTransmission?: number;
  diffuseTransmission?: number;
  ior?: number;
  thickness?: number;
  attenuationDistance?: number | null;
  attenuationColor?: [number, number, number];
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

// HUD element for in-game UI
export interface HudElement {
  id: string;
  text: string;
  x: number;
  y: number;
  fontSize?: number;
  color?: string;
  visible: boolean;
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

export type ReverbShape =
  | { type: 'box'; size: [number, number, number] }
  | { type: 'sphere'; radius: number };

export interface ReverbZoneData {
  shape: ReverbShape;
  preset: string; // "hall" | "room" | "cave" | "outdoor" | "custom"
  wetMix: number; // 0.0-1.0
  decayTime: number; // seconds
  preDelay: number; // milliseconds
  blendRadius: number; // distance from edge to start blending
  priority: number; // higher wins in overlaps
}

// Shader effect data matching Rust's ShaderEffectData struct
export interface ShaderEffectData {
  shaderType: string; // "none" | "dissolve" | "hologram" | "force_field" | "lava_flow" | "toon" | "fresnel_glow"
  customColor: [number, number, number, number];
  noiseScale: number;
  emissionStrength: number;
  dissolveThreshold: number;
  dissolveEdgeWidth: number;
  scanLineFrequency: number;
  scanLineSpeed: number;
  scrollSpeed: [number, number];
  distortionStrength: number;
  toonBands: number;
  fresnelPower: number;
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

// Keyframe property animation (D-2)
export interface AnimationKeyframe {
  time: number;
  value: number;
  interpolation: 'step' | 'linear' | 'ease_in' | 'ease_out' | 'ease_in_out';
}

export interface AnimationTrack {
  target: string;  // PropertyTarget enum as snake_case string
  keyframes: AnimationKeyframe[];
}

export interface AnimationClipData {
  tracks: AnimationTrack[];
  duration: number;
  playMode: 'once' | 'loop' | 'ping_pong';
  playing: boolean;
  speed: number;
  currentTime: number;
  forward: boolean;
  autoplay: boolean;
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

// SSAO settings matching Rust's SsaoSettings
export interface SsaoData {
  quality: 'low' | 'medium' | 'high' | 'ultra';
}

// Depth of field settings matching Rust's DepthOfFieldSettings
export interface DepthOfFieldData {
  mode: 'gaussian' | 'bokeh';
  focalDistance: number;
  apertureFStops: number;
  sensorHeight: number;
  maxCircleOfConfusionDiameter: number;
  maxDepth: number;
}

// Motion blur settings matching Rust's MotionBlurSettings
export interface MotionBlurData {
  shutterAngle: number;
  samples: number;
}

// Top-level post-processing data
export interface PostProcessingData {
  bloom: BloomData;
  chromaticAberration: ChromaticAberrationData;
  colorGrading: ColorGradingData;
  sharpening: SharpeningData;
  ssao: SsaoData | null;
  depthOfField: DepthOfFieldData | null;
  motionBlur: MotionBlurData | null;
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
  ssao: null,
  depthOfField: null,
  motionBlur: null,
};

// Terrain data matching Rust's TerrainData struct
export interface TerrainDataState {
  noiseType: 'perlin' | 'simplex' | 'value';
  octaves: number;
  frequency: number;
  amplitude: number;
  heightScale: number;
  seed: number;
  resolution: number;
  size: number;
}

// Game component data types matching Rust's game_components.rs
export interface CharacterControllerData {
  speed: number;
  jumpHeight: number;
  gravityScale: number;
  canDoubleJump: boolean;
}

export interface HealthData {
  maxHp: number;
  currentHp: number;
  invincibilitySecs: number;
  respawnOnDeath: boolean;
  respawnPoint: [number, number, number];
}

export interface CollectibleData {
  value: number;
  destroyOnCollect: boolean;
  pickupSoundAsset: string | null;
  rotateSpeed: number;
}

export interface DamageZoneData {
  damagePerSecond: number;
  oneShot: boolean;
}

export interface CheckpointData {
  autoSave: boolean;
}

export interface TeleporterData {
  targetPosition: [number, number, number];
  cooldownSecs: number;
}

export type PlatformLoopMode = 'pingPong' | 'loop' | 'once';

export interface MovingPlatformData {
  speed: number;
  waypoints: [number, number, number][];
  pauseDuration: number;
  loopMode: PlatformLoopMode;
}

export interface TriggerZoneData {
  eventName: string;
  oneShot: boolean;
}

export interface SpawnerData {
  entityType: string;
  intervalSecs: number;
  maxCount: number;
  spawnOffset: [number, number, number];
  onTrigger: string | null;
}

export interface FollowerData {
  targetEntityId: string | null;
  speed: number;
  stopDistance: number;
  lookAtTarget: boolean;
}

export interface ProjectileData {
  speed: number;
  damage: number;
  lifetimeSecs: number;
  gravity: boolean;
  destroyOnHit: boolean;
}

export type WinConditionType = 'score' | 'collectAll' | 'reachGoal';

export interface WinConditionData {
  conditionType: WinConditionType;
  targetScore: number | null;
  targetEntityId: string | null;
}

// Dialogue trigger data matching Rust's DialogueTriggerData struct
export interface DialogueTriggerData {
  treeId: string;
  triggerRadius: number;
  requireInteract: boolean;
  interactKey: string;
  oneShot: boolean;
}

// Mobile touch controls configuration
export interface VirtualJoystickConfig {
  position: 'bottom-left' | 'bottom-right';
  size: number;
  deadZone: number;
  opacity: number;
  mode: 'fixed' | 'floating';
  actions: {
    horizontal: string;
    vertical: string | null;
  };
}

export interface VirtualButtonConfig {
  id: string;
  action: string;
  position: { x: number; y: number };
  size: number;
  icon: string;
  label?: string;
  opacity: number;
}

export interface MobileTouchConfig {
  enabled: boolean;
  autoDetect: boolean;
  preset: string;
  joystick: VirtualJoystickConfig | null;
  lookJoystick?: VirtualJoystickConfig | null;
  buttons: VirtualButtonConfig[];
  preferredOrientation: 'any' | 'landscape' | 'portrait';
  autoReduceQuality: boolean;
}

// Game camera modes matching Rust's GameCameraMode enum
export type GameCameraMode = 'thirdPersonFollow' | 'firstPerson' | 'sideScroller' | 'topDown' | 'fixed' | 'orbital';

// Game camera data matching Rust's GameCameraData struct
export interface GameCameraData {
  mode: GameCameraMode;
  targetEntity: string | null;
  // Mode-specific params
  followDistance?: number;
  followHeight?: number;
  followLookAhead?: number;
  followSmoothing?: number;
  firstPersonHeight?: number;
  firstPersonMouseSensitivity?: number;
  sideScrollerDistance?: number;
  sideScrollerHeight?: number;
  topDownHeight?: number;
  topDownAngle?: number;
  orbitalDistance?: number;
  orbitalAutoRotateSpeed?: number;
}

// Discriminated union for all game component types
export type GameComponentData =
  | { type: 'characterController'; characterController: CharacterControllerData }
  | { type: 'health'; health: HealthData }
  | { type: 'collectible'; collectible: CollectibleData }
  | { type: 'damageZone'; damageZone: DamageZoneData }
  | { type: 'checkpoint'; checkpoint: CheckpointData }
  | { type: 'teleporter'; teleporter: TeleporterData }
  | { type: 'movingPlatform'; movingPlatform: MovingPlatformData }
  | { type: 'triggerZone'; triggerZone: TriggerZoneData }
  | { type: 'spawner'; spawner: SpawnerData }
  | { type: 'follower'; follower: FollowerData }
  | { type: 'projectile'; projectile: ProjectileData }
  | { type: 'winCondition'; winCondition: WinConditionData }
  | { type: 'dialogueTrigger'; dialogueTrigger: DialogueTriggerData };

// All available component type names
export const GAME_COMPONENT_TYPES = [
  'character_controller', 'health', 'collectible', 'damage_zone',
  'checkpoint', 'teleporter', 'moving_platform', 'trigger_zone',
  'spawner', 'follower', 'projectile', 'win_condition', 'dialogue_trigger',
] as const;

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
  primaryShaderEffect: ShaderEffectData | null;

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
  primaryJoint: JointData | null;

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

  // Reverb zone state
  reverbZones: Record<string, ReverbZoneData>;
  reverbZonesEnabled: Record<string, boolean>;

  // Particle state
  primaryParticle: ParticleData | null;
  particleEnabled: boolean;

  // Animation state
  primaryAnimation: AnimationPlaybackState | null;
  primaryAnimationClip: AnimationClipData | null;

  // Post-processing state
  postProcessing: PostProcessingData;

  // Quality preset state
  qualityPreset: QualityPreset;

  // Terrain state
  terrainData: Record<string, TerrainDataState>;

  // 2D project state
  projectType: ProjectType;
  sprites: Record<string, SpriteData>;
  camera2dData: Camera2dData | null;
  sortingLayers: SortingLayerData[];
  grid2d: Grid2dSettings;

  // Sprite animation state (Phase 2D-2)
  spriteSheets: Record<string, SpriteSheetData>;
  spriteAnimators: Record<string, SpriteAnimatorData>;
  animationStateMachines: Record<string, AnimationStateMachineData>;

  // Skeletal 2D animation state (Phase 2D-5)
  skeletons2d: Record<string, SkeletonData2d>;
  skeletalAnimations2d: Record<string, SkeletalAnimation2d[]>;
  selectedBone: string | null;

  // 2D Physics state (Phase 2D-4)
  physics2d: Record<string, Physics2dData>;
  physics2dEnabled: Record<string, boolean>;
  joints2d: Record<string, Joint2dData>;

  // Tilemap state (Phase 2D-3)
  tilesets: Record<string, TilesetData>;
  tilemaps: Record<string, TilemapData>;
  activeTilesetId: string | null;
  tilemapActiveTool: 'paint' | 'erase' | 'fill' | 'rectangle' | 'picker' | null;
  tilemapActiveLayerIndex: number | null;

  // Multi-scene
  scenes: Array<{ id: string; name: string; isStartScene: boolean }>;
  activeSceneId: string | null;
  sceneSwitching: boolean;

  // Scene transitions
  sceneTransition: {
    active: boolean;
    config: SceneTransitionConfig | null;
    targetScene: string | null;
  };
  defaultTransition: SceneTransitionConfig;

  // HUD state (for in-game UI during play mode)
  hudElements: HudElement[];

  // Game component state
  allGameComponents: Record<string, GameComponentData[]>;
  primaryGameComponents: GameComponentData[] | null;

  // Game camera state
  allGameCameras: Record<string, GameCameraData>;
  activeGameCameraId: string | null;
  primaryGameCamera: GameCameraData | null;

  // Mobile touch controls
  mobileTouchConfig: MobileTouchConfig;

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

  // Shader effect actions
  setPrimaryShaderEffect: (data: ShaderEffectData | null) => void;
  updateShaderEffect: (entityId: string, data: Partial<ShaderEffectData> & { shaderType: string }) => void;
  removeShaderEffect: (entityId: string) => void;

  // Light actions
  setPrimaryLight: (light: LightData) => void;
  updateLight: (entityId: string, light: LightData) => void;
  setAmbientLight: (data: AmbientLightData) => void;
  updateAmbientLight: (data: Partial<AmbientLightData>) => void;

  // Environment actions
  setEnvironment: (data: EnvironmentData) => void;
  updateEnvironment: (data: Partial<EnvironmentData>) => void;
  setSkybox: (preset: string) => void;
  removeSkybox: () => void;
  updateSkybox: (changes: { brightness?: number; iblIntensity?: number; rotation?: number }) => void;

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

  // Joint actions
  setPrimaryJoint: (data: JointData | null) => void;
  createJoint: (entityId: string, data: JointData) => void;
  updateJoint: (entityId: string, updates: Partial<JointData>) => void;
  removeJoint: (entityId: string) => void;

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

  // Audio layering/transition actions (JS-only, no WASM dispatch)
  crossfadeAudio: (fromEntityId: string, toEntityId: string, durationMs: number) => void;

  // Reverb zone actions
  setReverbZone: (entityId: string, data: ReverbZoneData, enabled: boolean) => void;
  removeReverbZone: (entityId: string) => void;
  updateReverbZone: (entityId: string, data: ReverbZoneData) => void;
  fadeInAudio: (entityId: string, durationMs: number) => void;
  fadeOutAudio: (entityId: string, durationMs: number) => void;
  playOneShotAudio: (assetId: string, options?: { position?: [number, number, number]; bus?: string; volume?: number; pitch?: number }) => void;
  addAudioLayer: (entityId: string, slotName: string, assetId: string, options?: { volume?: number; loop?: boolean; bus?: string }) => void;
  removeAudioLayer: (entityId: string, slotName: string) => void;
  setDuckingRule: (rule: { triggerBus: string; targetBus: string; duckLevel?: number; attackMs?: number; releaseMs?: number }) => void;

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
  setAnimationBlendWeight: (entityId: string, clipName: string, weight: number) => void;
  setClipSpeed: (entityId: string, clipName: string, speed: number) => void;
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

  // CSG Boolean operations
  csgUnion: (entityIdA: string, entityIdB: string, deleteSources?: boolean) => void;
  csgSubtract: (entityIdA: string, entityIdB: string, deleteSources?: boolean) => void;
  csgIntersect: (entityIdA: string, entityIdB: string, deleteSources?: boolean) => void;

  // HUD actions
  setHudElements: (elements: HudElement[]) => void;

  // Multi-scene actions
  setScenes: (scenes: Array<{ id: string; name: string; isStartScene: boolean }>, activeId: string | null) => void;
  setSceneSwitching: (switching: boolean) => void;

  // Scene transition actions
  startSceneTransition: (targetScene: string, configOverride?: Partial<SceneTransitionConfig>) => Promise<void>;
  setDefaultTransition: (config: Partial<SceneTransitionConfig>) => void;

  // Procedural mesh operations
  extrudeShape: (shape: string, params: {
    radius?: number;
    length?: number;
    segments?: number;
    innerRadius?: number;
    starPoints?: number;
    size?: number;
    name?: string;
    position?: [number, number, number];
  }) => void;
  latheShape: (profile: [number, number][], params: {
    segments?: number;
    name?: string;
    position?: [number, number, number];
  }) => void;
  arrayEntity: (entityId: string, params: {
    pattern: 'grid' | 'circle';
    countX?: number;
    countY?: number;
    countZ?: number;
    spacingX?: number;
    spacingY?: number;
    spacingZ?: number;
    circleCount?: number;
    circleRadius?: number;
  }) => void;
  combineMeshes: (entityIds: string[], deleteSources?: boolean, name?: string) => void;

  // Terrain actions
  spawnTerrain: (terrainData?: Partial<TerrainDataState>) => void;
  updateTerrain: (entityId: string, terrainData: TerrainDataState) => void;
  sculptTerrain: (entityId: string, position: [number, number], radius: number, strength: number) => void;
  setTerrainData: (entityId: string, data: TerrainDataState) => void;

  // Quality preset actions
  setQualityPreset: (preset: QualityPreset) => void;
  setQualityFromEngine: (data: { preset: string; msaaSamples: number; shadowsEnabled: boolean; shadowsDirectionalOnly: boolean; bloomEnabled: boolean; chromaticAberrationEnabled: boolean; sharpeningEnabled: boolean; particleDensityScale: number }) => void;

  // Post-processing actions
  updatePostProcessing: (partial: Partial<PostProcessingData>) => void;
  updateBloom: (partial: Partial<BloomData>) => void;
  updateChromaticAberration: (partial: Partial<ChromaticAberrationData>) => void;
  updateColorGrading: (partial: Partial<ColorGradingData>) => void;
  updateSharpening: (partial: Partial<SharpeningData>) => void;
  updateSsao: (data: SsaoData | null) => void;
  updateDepthOfField: (data: DepthOfFieldData | null) => void;
  updateMotionBlur: (data: MotionBlurData | null) => void;
  setPostProcessing: (data: PostProcessingData) => void;

  // Game component actions
  addGameComponent: (entityId: string, component: GameComponentData) => void;
  updateGameComponent: (entityId: string, component: GameComponentData) => void;
  removeGameComponent: (entityId: string, componentName: string) => void;

  // Game camera actions
  setGameCamera: (entityId: string, data: GameCameraData) => void;
  removeGameCamera: (entityId: string) => void;
  setActiveGameCamera: (entityId: string | null) => void;
  cameraShake: (entityId: string, intensity: number, duration: number) => void;
  setEntityGameCamera: (entityId: string, data: GameCameraData | null) => void;
  setActiveGameCameraId: (entityId: string | null) => void;

  // Keyframe property animation actions (D-2)
  createAnimationClip: (entityId: string, duration?: number, playMode?: string) => void;
  addClipKeyframe: (entityId: string, target: string, time: number, value: number, interpolation?: string) => void;
  removeClipKeyframe: (entityId: string, target: string, time: number) => void;
  updateClipKeyframe: (entityId: string, target: string, time: number, value?: number, interpolation?: string, newTime?: number) => void;
  setClipProperty: (entityId: string, duration?: number, playMode?: string, speed?: number, autoplay?: boolean) => void;
  previewClip: (entityId: string, action: 'play' | 'stop' | 'seek', seekTime?: number) => void;
  removeAnimationClip: (entityId: string) => void;

  // Mobile touch controls actions
  setMobileTouchConfig: (config: MobileTouchConfig) => void;
  updateMobileTouchConfig: (partial: Partial<MobileTouchConfig>) => void;

  // 2D project actions
  setProjectType: (type: ProjectType) => void;
  setSpriteData: (entityId: string, data: SpriteData) => void;
  removeSpriteData: (entityId: string) => void;
  setCamera2dData: (data: Camera2dData) => void;
  setSortingLayers: (layers: SortingLayerData[]) => void;
  addSortingLayer: (name: string) => void;
  removeSortingLayer: (name: string) => void;
  toggleLayerVisibility: (name: string) => void;
  setGrid2d: (settings: Partial<Grid2dSettings>) => void;

  // Sprite animation actions (Phase 2D-2)
  setSpriteSheet: (entityId: string, data: SpriteSheetData) => void;
  removeSpriteSheet: (entityId: string) => void;
  setSpriteAnimator: (entityId: string, data: SpriteAnimatorData) => void;
  removeSpriteAnimator: (entityId: string) => void;
  setAnimationStateMachine: (entityId: string, data: AnimationStateMachineData) => void;
  removeAnimationStateMachine: (entityId: string) => void;

  // Skeletal 2D animation actions (Phase 2D-5)
  setSkeleton2d: (entityId: string, data: SkeletonData2d) => void;
  removeSkeleton2d: (entityId: string) => void;
  setSkeletalAnimations2d: (entityId: string, animations: SkeletalAnimation2d[]) => void;
  setSelectedBone: (boneName: string | null) => void;

  // 2D Physics actions (Phase 2D-4)
  setPhysics2d: (entityId: string, data: Physics2dData, enabled: boolean) => void;
  updatePhysics2d: (entityId: string, data: Physics2dData) => void;
  removePhysics2d: (entityId: string) => void;
  togglePhysics2d: (entityId: string, enabled: boolean) => void;
  setJoint2d: (entityId: string, data: Joint2dData) => void;
  removeJoint2d: (entityId: string) => void;

  // Tilemap actions (Phase 2D-3)
  setTileset: (assetId: string, data: TilesetData) => void;
  removeTileset: (assetId: string) => void;
  setTilemapData: (entityId: string, data: TilemapData) => void;
  removeTilemapData: (entityId: string) => void;
  setActiveTileset: (assetId: string | null) => void;
  setTilemapActiveTool: (tool: 'paint' | 'erase' | 'fill' | 'rectangle' | 'picker' | null) => void;
  setTilemapActiveLayerIndex: (index: number | null) => void;

  // Template loading
  loadTemplate: (templateId: string) => Promise<void>;
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
  primaryShaderEffect: null,
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
    skyboxPreset: null,
    skyboxAssetId: null,
  },
  currentCameraPreset: 'perspective',
  coordinateMode: 'world',
  engineMode: 'edit',
  primaryPhysics: null,
  physicsEnabled: false,
  debugPhysics: false,
  primaryJoint: null,
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
  reverbZones: {},
  reverbZonesEnabled: {},
  primaryParticle: null,
  particleEnabled: false,
  primaryAnimation: null,
  primaryAnimationClip: null,
  sceneName: 'Untitled',
  sceneModified: false,
  autoSaveEnabled: true,
  hierarchyFilter: '',
  isExporting: false,
  projectId: null,
  cloudSaveStatus: 'idle',
  lastCloudSave: null,
  postProcessing: DEFAULT_POST_PROCESSING,
  qualityPreset: 'high' as QualityPreset,
  terrainData: {},
  projectType: '3d',
  sprites: {},
  camera2dData: null,
  sortingLayers: [
    { name: 'Background', order: 0, visible: true },
    { name: 'Default', order: 1, visible: true },
    { name: 'Foreground', order: 2, visible: true },
    { name: 'UI', order: 3, visible: true },
  ],
  grid2d: { enabled: false, size: 32, color: '#ffffff', opacity: 0.2, snapToGrid: false },
  spriteSheets: {},
  spriteAnimators: {},
  animationStateMachines: {},
  skeletons2d: {},
  skeletalAnimations2d: {},
  selectedBone: null,
  physics2d: {},
  physics2dEnabled: {},
  joints2d: {},
  tilesets: {},
  tilemaps: {},
  activeTilesetId: null,
  tilemapActiveTool: null,
  tilemapActiveLayerIndex: null,
  hudElements: [],
  scenes: [],
  activeSceneId: null,
  sceneSwitching: false,
  sceneTransition: { active: false, config: null, targetScene: null },
  defaultTransition: DEFAULT_TRANSITION,
  allGameComponents: {},
  primaryGameComponents: null,
  allGameCameras: {},
  activeGameCameraId: null,
  primaryGameCamera: null,
  mobileTouchConfig: {
    enabled: true,
    autoDetect: true,
    preset: 'platformer',
    joystick: {
      position: 'bottom-left',
      size: 120,
      deadZone: 0.15,
      opacity: 0.6,
      mode: 'floating',
      actions: { horizontal: 'move_right', vertical: 'move_forward' },
    },
    buttons: [
      { id: 'jump', action: 'jump', position: { x: 85, y: 75 }, size: 80, icon: '↑', opacity: 0.6 },
    ],
    preferredOrientation: 'any',
    autoReduceQuality: true,
  },

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
      primaryAnimationClip: null,
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
    if (type === 'terrain') {
      get().spawnTerrain();
      return;
    }
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
      // Spread all material fields; Rust ignores unknown fields
      const { baseColorTexture: _bct, normalMapTexture: _nmt, metallicRoughnessTexture: _mrt,
              emissiveTexture: _et, occlusionTexture: _ot,
              depthMapTexture: _dmt, clearcoatTexture: _ct, clearcoatRoughnessTexture: _crt,
              clearcoatNormalTexture: _cnt, ...materialFields } = material;
      dispatchCommand('update_material', {
        entityId,
        ...materialFields,
      });
    }
  },

  // Shader effect actions
  setPrimaryShaderEffect: (data) => set({ primaryShaderEffect: data }),
  updateShaderEffect: (entityId, data) => {
    if (dispatchCommand) {
      dispatchCommand('set_custom_shader', { entityId, ...data });
    }
  },
  removeShaderEffect: (entityId) => {
    if (dispatchCommand) {
      dispatchCommand('remove_custom_shader', { entityId });
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

  setSkybox: (preset) => {
    if (dispatchCommand) {
      dispatchCommand('set_skybox', { preset });
    }
  },

  removeSkybox: () => {
    if (dispatchCommand) {
      dispatchCommand('remove_skybox', {});
    }
  },

  updateSkybox: (changes) => {
    if (dispatchCommand) {
      dispatchCommand('update_skybox', changes);
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

  // Joint actions
  setPrimaryJoint: (data) => {
    set({ primaryJoint: data });
  },
  createJoint: (entityId, data) => {
    set({ primaryJoint: data });
    if (dispatchCommand) {
      dispatchCommand('create_joint', { entityId, ...data });
    }
  },
  updateJoint: (entityId, updates) => {
    const current = get().primaryJoint;
    if (current) {
      const updated = { ...current, ...updates };
      set({ primaryJoint: updated });
    }
    if (dispatchCommand) {
      dispatchCommand('update_joint', { entityId, ...updates });
    }
  },
  removeJoint: (entityId) => {
    set({ primaryJoint: null });
    if (dispatchCommand) {
      dispatchCommand('remove_joint', { entityId });
    }
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

  // Quality preset actions
  setQualityPreset: (preset) => {
    set({ qualityPreset: preset });
    if (dispatchCommand) {
      dispatchCommand('set_quality_preset', { preset });
    }
  },

  setQualityFromEngine: (data) => {
    set({ qualityPreset: data.preset as QualityPreset });
  },

  // Post-processing actions
  updatePostProcessing: (partial) => {
    const current = get().postProcessing;
    const merged: PostProcessingData = {
      bloom: partial.bloom ?? current.bloom,
      chromaticAberration: partial.chromaticAberration ?? current.chromaticAberration,
      colorGrading: partial.colorGrading ?? current.colorGrading,
      sharpening: partial.sharpening ?? current.sharpening,
      ssao: partial.ssao !== undefined ? partial.ssao : current.ssao,
      depthOfField: partial.depthOfField !== undefined ? partial.depthOfField : current.depthOfField,
      motionBlur: partial.motionBlur !== undefined ? partial.motionBlur : current.motionBlur,
    };
    set({ postProcessing: merged });

    // Dispatch command to Rust
    if (dispatchCommand) {
      dispatchCommand('update_post_processing', {
        bloom: partial.bloom,
        chromaticAberration: partial.chromaticAberration,
        colorGrading: partial.colorGrading,
        sharpening: partial.sharpening,
        ssao: partial.ssao,
        depthOfField: partial.depthOfField,
        motionBlur: partial.motionBlur,
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

  updateSsao: (data) => {
    get().updatePostProcessing({ ssao: data });
  },

  updateDepthOfField: (data) => {
    get().updatePostProcessing({ depthOfField: data });
  },

  updateMotionBlur: (data) => {
    get().updatePostProcessing({ motionBlur: data });
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

  // Audio layering/transition actions (JS-only)
  crossfadeAudio: (fromEntityId, toEntityId, durationMs) => {
    import('@/lib/audio/audioManager').then(({ audioManager }) => {
      audioManager.crossfade(fromEntityId, toEntityId, durationMs);
    });
  },

  fadeInAudio: (entityId, durationMs) => {
    import('@/lib/audio/audioManager').then(({ audioManager }) => {
      audioManager.fadeIn(entityId, durationMs);
    });
  },

  fadeOutAudio: (entityId, durationMs) => {
    import('@/lib/audio/audioManager').then(({ audioManager }) => {
      audioManager.fadeOut(entityId, durationMs);
    });
  },

  playOneShotAudio: (assetId, options) => {
    import('@/lib/audio/audioManager').then(({ audioManager }) => {
      audioManager.playOneShot(assetId, options);
    });
  },

  addAudioLayer: (entityId, slotName, assetId, options) => {
    import('@/lib/audio/audioManager').then(({ audioManager }) => {
      audioManager.addLayer(entityId, slotName, assetId, options);
    });
  },

  removeAudioLayer: (entityId, slotName) => {
    import('@/lib/audio/audioManager').then(({ audioManager }) => {
      audioManager.removeLayer(entityId, slotName);
    });
  },

  setDuckingRule: (rule) => {
    import('@/lib/audio/audioManager').then(({ audioManager }) => {
      audioManager.addDuckingRule({
        triggerBus: rule.triggerBus,
        targetBus: rule.targetBus,
        duckLevel: rule.duckLevel ?? 0.3,
        attackMs: rule.attackMs ?? 200,
        releaseMs: rule.releaseMs ?? 500,
      });
    });
  },

  // Reverb zone actions
  setReverbZone: (entityId, data, enabled) => {
    set((state) => ({
      reverbZones: { ...state.reverbZones, [entityId]: data },
      reverbZonesEnabled: { ...state.reverbZonesEnabled, [entityId]: enabled },
    }));
  },

  removeReverbZone: (entityId) => {
    set((state) => {
      const { [entityId]: _, ...restZones } = state.reverbZones;
      const { [entityId]: _enabled, ...restEnabled } = state.reverbZonesEnabled;
      return { reverbZones: restZones, reverbZonesEnabled: restEnabled };
    });
  },

  updateReverbZone: (entityId, data) => {
    if (dispatchCommand) {
      dispatchCommand('set_reverb_zone', { entityId, reverbZoneData: data });
    }
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

  setAnimationBlendWeight: (entityId, clipName, weight) => {
    if (dispatchCommand) {
      dispatchCommand('set_animation_blend_weight', { entityId, clipName, weight });
    }
  },

  setClipSpeed: (entityId, clipName, speed) => {
    if (dispatchCommand) {
      dispatchCommand('set_clip_speed', { entityId, clipName, speed });
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

  // Terrain actions
  spawnTerrain: (terrainData) => {
    if (dispatchCommand) {
      dispatchCommand('spawn_terrain', {
        noiseType: terrainData?.noiseType ?? 'perlin',
        octaves: terrainData?.octaves ?? 4,
        frequency: terrainData?.frequency ?? 0.03,
        amplitude: terrainData?.amplitude ?? 0.5,
        heightScale: terrainData?.heightScale ?? 10.0,
        seed: terrainData?.seed ?? Math.floor(Math.random() * 100000),
        resolution: terrainData?.resolution ?? 64,
        size: terrainData?.size ?? 50.0,
      });
    }
  },

  updateTerrain: (entityId, terrainData) => {
    if (dispatchCommand) {
      dispatchCommand('update_terrain', {
        entityId,
        ...terrainData,
      });
    }
  },

  sculptTerrain: (entityId, position, radius, strength) => {
    if (dispatchCommand) {
      dispatchCommand('sculpt_terrain', {
        entityId,
        position,
        radius,
        strength,
      });
    }
  },

  setTerrainData: (entityId, data) => {
    set((state) => ({
      terrainData: { ...state.terrainData, [entityId]: data },
    }));
  },

  // CSG Boolean operations
  csgUnion: (entityIdA, entityIdB, deleteSources) => {
    if (dispatchCommand) {
      dispatchCommand('csg_union', { entityIdA, entityIdB, deleteSources: deleteSources ?? true });
    }
  },

  csgSubtract: (entityIdA, entityIdB, deleteSources) => {
    if (dispatchCommand) {
      dispatchCommand('csg_subtract', { entityIdA, entityIdB, deleteSources: deleteSources ?? true });
    }
  },

  csgIntersect: (entityIdA, entityIdB, deleteSources) => {
    if (dispatchCommand) {
      dispatchCommand('csg_intersect', { entityIdA, entityIdB, deleteSources: deleteSources ?? true });
    }
  },

  // Procedural mesh operations
  extrudeShape: (shape, params) => {
    if (dispatchCommand) {
      dispatchCommand('extrude_shape', { shape, ...params });
    }
  },

  latheShape: (profile, params) => {
    if (dispatchCommand) {
      dispatchCommand('lathe_shape', { profile, ...params });
    }
  },

  arrayEntity: (entityId, params) => {
    if (dispatchCommand) {
      dispatchCommand('array_entity', { entityId, ...params });
    }
  },

  combineMeshes: (entityIds, deleteSources, name) => {
    if (dispatchCommand) {
      dispatchCommand('combine_meshes', { entityIds, deleteSources: deleteSources ?? true, name });
    }
  },

  // Set HUD elements from script worker
  setHudElements: (elements) => {
    set({ hudElements: elements });
  },

  // Multi-scene actions
  setScenes: (scenes: Array<{ id: string; name: string; isStartScene: boolean }>, activeId: string | null) => {
    set({ scenes, activeSceneId: activeId });
  },
  setSceneSwitching: (switching: boolean) => {
    set({ sceneSwitching: switching });
  },

  // Scene transition actions
  startSceneTransition: async (targetScene, configOverride) => {
    const { scenes, engineMode, defaultTransition } = get();

    // Validate target scene exists
    const targetExists = scenes.find(s => s.name === targetScene || s.id === targetScene);
    if (!targetExists) {
      console.error(`Scene "${targetScene}" not found`);
      return;
    }

    const config = { ...defaultTransition, ...configOverride };

    // Activate overlay
    set({ sceneTransition: { active: true, config, targetScene } });

    // Wait for fade-in (half duration)
    const halfDuration = config.type === 'instant' ? 0 : config.duration / 2;
    await new Promise(resolve => setTimeout(resolve, halfDuration));

    // Stop current game if playing
    if (engineMode === 'play' || engineMode === 'paused') {
      if (dispatchCommand) {
        dispatchCommand('stop', {});
      }
      // Small delay for engine to process stop
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    // Switch scene using sceneManager
    try {
      const { switchScene, loadProjectScenes, saveProjectScenes, getSceneByName } = await import('@/lib/scenes/sceneManager');
      const project = loadProjectScenes();

      // Save current scene data before switching
      if (dispatchCommand) {
        dispatchCommand('export_scene', {});
        // Small delay for export event
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Resolve target scene ID
      let targetId = targetScene;
      const byName = getSceneByName(project, targetScene);
      if (byName) targetId = byName.id;

      const result = switchScene(project, targetId);
      if ('error' in result) {
        console.error('Scene switch failed:', result.error);
        set({ sceneTransition: { active: false, config: null, targetScene: null } });
        return;
      }

      saveProjectScenes(result.project);
      set({
        scenes: result.project.scenes.map(s => ({ id: s.id, name: s.name, isStartScene: s.isStartScene })),
        activeSceneId: result.project.activeSceneId,
      });

      // Load the new scene data
      if (result.sceneToLoad) {
        get().loadScene(JSON.stringify(result.sceneToLoad));
      } else {
        get().newScene();
      }
    } catch (err) {
      console.error('Scene transition error:', err);
      set({ sceneTransition: { active: false, config: null, targetScene: null } });
      return;
    }

    // Restart game in new scene
    if (dispatchCommand) {
      dispatchCommand('play', {});
    }

    // Wait for fade-out (second half)
    await new Promise(resolve => setTimeout(resolve, halfDuration));

    // Deactivate overlay
    set({ sceneTransition: { active: false, config: null, targetScene: null } });
  },

  setDefaultTransition: (config) => {
    set((state) => ({
      defaultTransition: { ...state.defaultTransition, ...config },
    }));
  },

  // Game component actions
  addGameComponent: (entityId, component) => {
    if (dispatchCommand) {
      dispatchCommand('add_game_component', { entityId, component });
    }
  },
  updateGameComponent: (entityId, component) => {
    if (dispatchCommand) {
      dispatchCommand('update_game_component', { entityId, component });
    }
  },
  removeGameComponent: (entityId, componentName) => {
    if (dispatchCommand) {
      dispatchCommand('remove_game_component', { entityId, componentName });
    }
  },

  // Game camera actions
  setGameCamera: (entityId, data) => {
    if (dispatchCommand) {
      dispatchCommand('set_game_camera', { entityId, ...data });
    }
  },
  removeGameCamera: (entityId) => {
    if (dispatchCommand) {
      dispatchCommand('set_game_camera', { entityId, mode: null });
    }
  },
  setActiveGameCamera: (entityId) => {
    if (dispatchCommand) {
      dispatchCommand('set_active_game_camera', { entityId });
    }
  },
  cameraShake: (entityId, intensity, duration) => {
    if (dispatchCommand) {
      dispatchCommand('camera_shake', { entityId, intensity, duration });
    }
  },
  setEntityGameCamera: (entityId, data) => {
    set((state) => {
      const allGameCameras = { ...state.allGameCameras };
      if (data) {
        allGameCameras[entityId] = data;
      } else {
        delete allGameCameras[entityId];
      }
      return {
        allGameCameras,
        primaryGameCamera: entityId === state.primaryId ? data : state.primaryGameCamera,
      };
    });
  },
  setActiveGameCameraId: (entityId) => {
    set({ activeGameCameraId: entityId });
  },

  // Keyframe property animation actions (D-2)
  createAnimationClip: (entityId, duration, playMode) => {
    if (dispatchCommand) {
      dispatchCommand('create_animation_clip', { entityId, duration, playMode });
    }
  },
  addClipKeyframe: (entityId, target, time, value, interpolation) => {
    if (dispatchCommand) {
      dispatchCommand('add_clip_keyframe', { entityId, target, time, value, interpolation });
    }
  },
  removeClipKeyframe: (entityId, target, time) => {
    if (dispatchCommand) {
      dispatchCommand('remove_clip_keyframe', { entityId, target, time });
    }
  },
  updateClipKeyframe: (entityId, target, time, value, interpolation, newTime) => {
    if (dispatchCommand) {
      dispatchCommand('update_clip_keyframe', { entityId, target, time, value, interpolation, newTime });
    }
  },
  setClipProperty: (entityId, duration, playMode, speed, autoplay) => {
    if (dispatchCommand) {
      dispatchCommand('set_clip_property', { entityId, duration, playMode, speed, autoplay });
    }
  },
  previewClip: (entityId, action, seekTime) => {
    if (dispatchCommand) {
      dispatchCommand('preview_clip', { entityId, action, seekTime });
    }
  },
  removeAnimationClip: (entityId) => {
    if (dispatchCommand) {
      dispatchCommand('remove_animation_clip', { entityId });
    }
  },

  // Mobile touch controls actions
  setMobileTouchConfig: (config) => set({ mobileTouchConfig: config }),
  updateMobileTouchConfig: (partial) => set((state) => ({
    mobileTouchConfig: { ...state.mobileTouchConfig, ...partial },
  })),

  // 2D project actions
  setProjectType: (type) => set({ projectType: type }),
  setSpriteData: (entityId, data) => set((s) => ({ sprites: { ...s.sprites, [entityId]: data } })),
  removeSpriteData: (entityId) => set((s) => {
    const next = { ...s.sprites };
    delete next[entityId];
    return { sprites: next };
  }),
  setCamera2dData: (data) => set({ camera2dData: data }),
  setSortingLayers: (layers) => set({ sortingLayers: layers }),
  addSortingLayer: (name) => set((s) => ({
    sortingLayers: [...s.sortingLayers, { name, order: s.sortingLayers.length, visible: true }],
  })),
  removeSortingLayer: (name) => set((s) => ({
    sortingLayers: s.sortingLayers.filter((l) => l.name !== name),
  })),
  toggleLayerVisibility: (name) => set((s) => ({
    sortingLayers: s.sortingLayers.map((l) => l.name === name ? { ...l, visible: !l.visible } : l),
  })),
  setGrid2d: (settings) => set((s) => ({ grid2d: { ...s.grid2d, ...settings } })),

  // Sprite animation actions (Phase 2D-2)
  setSpriteSheet: (entityId, data) => set((s) => ({
    spriteSheets: { ...s.spriteSheets, [entityId]: data }
  })),

  removeSpriteSheet: (entityId) => set((s) => {
    const sheets = { ...s.spriteSheets };
    delete sheets[entityId];
    return { spriteSheets: sheets };
  }),

  setSpriteAnimator: (entityId, data) => set((s) => ({
    spriteAnimators: { ...s.spriteAnimators, [entityId]: data }
  })),

  removeSpriteAnimator: (entityId) => set((s) => {
    const animators = { ...s.spriteAnimators };
    delete animators[entityId];
    return { spriteAnimators: animators };
  }),

  setAnimationStateMachine: (entityId, data) => set((s) => ({
    animationStateMachines: { ...s.animationStateMachines, [entityId]: data }
  })),

  removeAnimationStateMachine: (entityId) => set((s) => {
    const machines = { ...s.animationStateMachines };
    delete machines[entityId];
    return { animationStateMachines: machines };
  }),

  // Skeletal 2D animation actions
  setSkeleton2d: (entityId, data) => set((s) => ({
    skeletons2d: { ...s.skeletons2d, [entityId]: data }
  })),

  removeSkeleton2d: (entityId) => set((s) => {
    const skeletons = { ...s.skeletons2d };
    delete skeletons[entityId];
    return { skeletons2d: skeletons };
  }),

  setSkeletalAnimations2d: (entityId, animations) => set((s) => ({
    skeletalAnimations2d: { ...s.skeletalAnimations2d, [entityId]: animations }
  })),

  setSelectedBone: (boneName) => set({ selectedBone: boneName }),

  // 2D Physics actions
  setPhysics2d: (entityId, data, enabled) => set((s) => ({
    physics2d: { ...s.physics2d, [entityId]: data },
    physics2dEnabled: { ...s.physics2dEnabled, [entityId]: enabled },
  })),

  updatePhysics2d: (entityId, data) => {
    set((s) => ({
      physics2d: { ...s.physics2d, [entityId]: data },
    }));

    if (dispatchCommand) {
      dispatchCommand('update_physics2d', {
        entityId,
        bodyType: data.bodyType,
        colliderShape: data.colliderShape,
        size: data.size,
        radius: data.radius,
        vertices: data.vertices,
        mass: data.mass,
        friction: data.friction,
        restitution: data.restitution,
        gravityScale: data.gravityScale,
        isSensor: data.isSensor,
        lockRotation: data.lockRotation,
        continuousDetection: data.continuousDetection,
        oneWayPlatform: data.oneWayPlatform,
        surfaceVelocity: data.surfaceVelocity,
      });
    }
  },

  removePhysics2d: (entityId) => {
    set((s) => {
      const physics2d = { ...s.physics2d };
      const physics2dEnabled = { ...s.physics2dEnabled };
      delete physics2d[entityId];
      delete physics2dEnabled[entityId];
      return { physics2d, physics2dEnabled };
    });

    if (dispatchCommand) {
      dispatchCommand('remove_physics2d', { entityId });
    }
  },

  togglePhysics2d: (entityId, enabled) => {
    set((s) => ({
      physics2dEnabled: { ...s.physics2dEnabled, [entityId]: enabled },
    }));

    if (dispatchCommand) {
      dispatchCommand('toggle_physics2d', { entityId, enabled });
    }
  },

  setJoint2d: (entityId, data) => {
    set((s) => ({
      joints2d: { ...s.joints2d, [entityId]: data },
    }));

    if (dispatchCommand) {
      dispatchCommand('create_joint2d', {
        entityId,
        targetEntityId: data.targetEntityId,
        jointType: data.jointType,
        localAnchor1: data.localAnchor1,
        localAnchor2: data.localAnchor2,
        limits: data.limits,
        motorVelocity: data.motorVelocity,
        motorMaxForce: data.motorMaxForce,
        axis: data.axis,
        maxDistance: data.maxDistance,
        restLength: data.restLength,
        stiffness: data.stiffness,
        damping: data.damping,
      });
    }
  },

  removeJoint2d: (entityId) => {
    set((s) => {
      const joints2d = { ...s.joints2d };
      delete joints2d[entityId];
      return { joints2d };
    });

    if (dispatchCommand) {
      dispatchCommand('remove_joint2d', { entityId });
    }
  },

  // Tilemap actions (Phase 2D-3)
  setTileset: (assetId, data) => {
    set((s) => ({
      tilesets: { ...s.tilesets, [assetId]: data },
    }));
  },

  removeTileset: (assetId) => {
    set((s) => {
      const tilesets = { ...s.tilesets };
      delete tilesets[assetId];
      return { tilesets };
    });
  },

  setTilemapData: (entityId, data) => {
    set((s) => ({
      tilemaps: { ...s.tilemaps, [entityId]: data },
    }));
  },

  removeTilemapData: (entityId) => {
    set((s) => {
      const tilemaps = { ...s.tilemaps };
      delete tilemaps[entityId];
      return { tilemaps };
    });
  },

  setActiveTileset: (assetId) => {
    set({ activeTilesetId: assetId });
  },

  setTilemapActiveTool: (tool) => {
    set({ tilemapActiveTool: tool });
  },

  setTilemapActiveLayerIndex: (index) => {
    set({ tilemapActiveLayerIndex: index });
  },

  // Template loading
  loadTemplate: async (templateId: string) => {
    const { loadTemplate: loadTpl } = await import('@/data/templates');
    const template = await loadTpl(templateId);
    if (!template) {
      console.error(`Template not found: ${templateId}`);
      return;
    }

    const state = get();

    // 1. Clear current scene
    if (dispatchCommand) {
      dispatchCommand('new_scene', {});
    }

    // 2. Set scene name
    set({ sceneName: template.name, sceneModified: false });

    // 3. Load scene data (entities, environment, lights, physics, game components)
    if (dispatchCommand) {
      dispatchCommand('load_scene', { json: JSON.stringify(template.sceneData) });
    }

    // 4. Wait briefly for entities to register, then load scripts
    setTimeout(() => {
      for (const [entityId, script] of Object.entries(template.scripts)) {
        state.setScript(entityId, script.source, script.enabled);
      }
    }, 200);

    // 5. Apply input preset
    if (template.inputPreset) {
      state.setInputPreset(template.inputPreset as 'fps' | 'platformer' | 'topdown' | 'racing');
    }
  },
}));

// Expose store for E2E tests (dev/test only)
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
  (window as unknown as Record<string, unknown>).__EDITOR_STORE = useEditorStore;
}

// Play tick callback for script runner
type PlayTickCallback = (data: unknown) => void;
let _playTickCallback: PlayTickCallback | null = null;
export function setPlayTickCallback(cb: PlayTickCallback | null) {
  _playTickCallback = cb;
}
export function firePlayTick(data: unknown) {
  _playTickCallback?.(data);
}
