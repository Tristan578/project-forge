/**
 * Shared type definitions for editorStore slices.
 * All interfaces and types originally defined in editorStore.ts.
 */

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
