/**
 * Hook for receiving and dispatching engine events from/to Rust.
 *
 * This hook connects the WASM module's event callback to the Zustand store,
 * translating Rust events into React state updates.
 */

import { useEffect, useRef, useCallback } from 'react';
import { useEditorStore, type SceneGraph, type TransformData, type SnapSettings, type CameraPreset, type CoordinateMode, type MaterialData, type LightData, type AmbientLightData, type EnvironmentData, type EngineMode, type PhysicsData, type InputBinding, type InputPreset, type AssetMetadata, type ScriptData, type PostProcessingData, type AudioBusDef, type ParticleData, type AnimationPlaybackState, type JointData, setCommandDispatcher, firePlayTick } from '@/stores/editorStore';

// Event types matching Rust's event emission
interface SelectionChangedEvent {
  type: 'SELECTION_CHANGED';
  payload: {
    selectedIds: string[];
    primaryId: string | null;
    primaryName: string | null;
  };
}

interface SceneGraphUpdateEvent {
  type: 'SCENE_GRAPH_UPDATE';
  payload: SceneGraph;
}

interface TransformChangedEvent {
  type: 'TRANSFORM_CHANGED';
  payload: TransformData;
}

interface HistoryChangedEvent {
  type: 'HISTORY_CHANGED';
  payload: {
    canUndo: boolean;
    canRedo: boolean;
    undoDescription: string | null;
    redoDescription: string | null;
  };
}

interface SnapSettingsChangedEvent {
  type: 'SNAP_SETTINGS_CHANGED';
  payload: SnapSettings;
}

interface ViewPresetChangedEvent {
  type: 'VIEW_PRESET_CHANGED';
  payload: {
    preset: CameraPreset;
    displayName: string | null;
  };
}

interface CoordinateModeChangedEvent {
  type: 'COORDINATE_MODE_CHANGED';
  payload: {
    mode: CoordinateMode;
    displayName: string;
  };
}

interface MaterialChangedEvent {
  type: 'MATERIAL_CHANGED';
  payload: MaterialData & { entityId: string };
}

interface LightChangedEvent {
  type: 'LIGHT_CHANGED';
  payload: LightData & { entityId: string };
}

interface AmbientLightChangedEvent {
  type: 'AMBIENT_LIGHT_CHANGED';
  payload: AmbientLightData;
}

interface EnvironmentChangedEvent {
  type: 'ENVIRONMENT_CHANGED';
  payload: EnvironmentData;
}

interface ReparentResultEvent {
  type: 'REPARENT_RESULT';
  payload: {
    success: boolean;
    entityId: string;
    error?: string;
  };
}

interface EngineModeChangedEvent {
  type: 'ENGINE_MODE_CHANGED';
  payload: {
    mode: EngineMode;
  };
}

interface PhysicsChangedEvent {
  type: 'PHYSICS_CHANGED';
  payload: PhysicsData & { entityId: string; enabled: boolean };
}

interface DebugPhysicsChangedEvent {
  type: 'DEBUG_PHYSICS_CHANGED';
  payload: { enabled: boolean };
}

interface JointChangedEvent {
  type: 'JOINT_CHANGED';
  payload: {
    jointType: string;
    connectedEntityId: string;
    anchorSelf: [number, number, number];
    anchorOther: [number, number, number];
    axis: [number, number, number];
    limits: { min: number; max: number } | null;
    motor: { targetVelocity: number; maxForce: number } | null;
  } | null;
}

interface InputBindingsChangedEvent {
  type: 'INPUT_BINDINGS_CHANGED';
  payload: {
    actions: Record<string, {
      name: string;
      actionType: { type: string; positive?: { type: string; value: string }[]; negative?: { type: string; value: string }[] };
      sources: { type: string; value: string }[];
      deadZone: number;
    }>;
    preset: string | null;
  };
}

interface AssetImportedEvent {
  type: 'ASSET_IMPORTED';
  payload: {
    assetId: string;
    name: string;
    kind: string;
    fileSize: number;
  };
}

interface AssetDeletedEvent {
  type: 'ASSET_DELETED';
  payload: {
    assetId: string;
  };
}

interface AssetListEvent {
  type: 'ASSET_LIST';
  payload: {
    assets: Record<string, AssetMetadata>;
  };
}

interface ScriptChangedEvent {
  type: 'SCRIPT_CHANGED';
  payload: {
    entityId: string;
    source: string;
    enabled: boolean;
    template: string | null;
  };
}

interface SceneExportedEvent {
  type: 'SCENE_EXPORTED';
  payload: {
    json: string;
    name: string;
  };
}

interface SceneLoadedEvent {
  type: 'SCENE_LOADED';
  payload: {
    name: string;
  };
}

interface AudioChangedEvent {
  type: 'AUDIO_CHANGED';
  payload: {
    entityId: string;
    assetId?: string | null;
    volume?: number;
    pitch?: number;
    loopAudio?: boolean;
    spatial?: boolean;
    maxDistance?: number;
    refDistance?: number;
    rolloffFactor?: number;
    autoplay?: boolean;
    bus?: string;
  };
}

interface AudioBusesChangedEvent {
  type: 'AUDIO_BUSES_CHANGED';
  payload: {
    buses: AudioBusDef[];
  };
}

interface AudioPlaybackEvent {
  type: 'AUDIO_PLAYBACK';
  payload: {
    entityId: string;
    action: 'play' | 'stop' | 'pause' | 'resume';
  };
}

interface PostProcessingChangedEvent {
  type: 'POST_PROCESSING_CHANGED';
  payload: PostProcessingData;
}

interface ParticleChangedEvent {
  type: 'PARTICLE_CHANGED';
  payload: {
    entityId: string;
    enabled: boolean;
    particle: ParticleData | null;
  };
}

interface AnimationStateChangedEvent {
  type: 'ANIMATION_STATE_CHANGED';
  payload: AnimationPlaybackState;
}

interface AnimationListChangedEvent {
  type: 'ANIMATION_LIST_CHANGED';
  payload: AnimationPlaybackState;
}

interface ShaderChangedEvent {
  type: 'SHADER_CHANGED';
  payload: {
    entityId: string;
    data: import('@/stores/editorStore').ShaderEffectData | null;
  };
}

interface CsgCompletedEvent {
  type: 'CSG_COMPLETED';
  payload: {
    entityId: string;
    name: string;
    operation: string;
  };
}

interface CsgErrorEvent {
  type: 'CSG_ERROR';
  payload: {
    message: string;
  };
}

interface TerrainChangedEvent {
  type: 'TERRAIN_CHANGED';
  payload: {
    entityId: string;
    terrainData: import('@/stores/editorStore').TerrainDataState;
  };
}

interface ProceduralMeshCreatedEvent {
  type: 'PROCEDURAL_MESH_CREATED';
  payload: {
    entityId: string;
    name: string;
    operation: string;
  };
}

interface ProceduralMeshErrorEvent {
  type: 'PROCEDURAL_MESH_ERROR';
  payload: {
    message: string;
  };
}

interface ArrayCompletedEvent {
  type: 'ARRAY_COMPLETED';
  payload: {
    count: number;
  };
}

interface QualityChangedEvent {
  type: 'QUALITY_CHANGED';
  payload: {
    preset: string;
    msaaSamples: number;
    shadowsEnabled: boolean;
    shadowsDirectionalOnly: boolean;
    bloomEnabled: boolean;
    chromaticAberrationEnabled: boolean;
    sharpeningEnabled: boolean;
    particleDensityScale: number;
  };
}

interface PlayTickEvent {
  type: 'PLAY_TICK';
  payload: {
    entities: Record<string, { position: [number, number, number]; rotation: [number, number, number]; scale: [number, number, number] }>;
    entityInfos: Record<string, { name: string; type: string; colliderRadius: number }>;
    inputState: { pressed: Record<string, boolean>; justPressed: Record<string, boolean>; justReleased: Record<string, boolean>; axes: Record<string, number> };
  };
}

interface CollisionEventEvent {
  type: 'COLLISION_EVENT';
  payload: { entityA: string; entityB: string; started: boolean };
}

interface RaycastResultEvent {
  type: 'RAYCAST_RESULT';
  payload: { requestId: string; hitEntity: string | null; point: [number, number, number]; distance: number };
}

type EngineEvent = SelectionChangedEvent | SceneGraphUpdateEvent | TransformChangedEvent | HistoryChangedEvent | SnapSettingsChangedEvent | ViewPresetChangedEvent | CoordinateModeChangedEvent | MaterialChangedEvent | LightChangedEvent | AmbientLightChangedEvent | EnvironmentChangedEvent | ReparentResultEvent | EngineModeChangedEvent | PhysicsChangedEvent | DebugPhysicsChangedEvent | InputBindingsChangedEvent | AssetImportedEvent | AssetDeletedEvent | AssetListEvent | ScriptChangedEvent | SceneExportedEvent | SceneLoadedEvent | AudioChangedEvent | AudioPlaybackEvent | AudioBusesChangedEvent | PostProcessingChangedEvent | ParticleChangedEvent | AnimationStateChangedEvent | AnimationListChangedEvent | ShaderChangedEvent | CsgCompletedEvent | CsgErrorEvent | TerrainChangedEvent | ProceduralMeshCreatedEvent | ProceduralMeshErrorEvent | ArrayCompletedEvent | QualityChangedEvent | PlayTickEvent | CollisionEventEvent | RaycastResultEvent | JointChangedEvent;

// Debounced auto-save: triggers export_scene command after 2s of inactivity
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleAutoSave() {
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    const state = useEditorStore.getState();
    if (state.autoSaveEnabled && state.engineMode === 'edit') {
      state.saveScene();
    }
  }, 2000);
}

interface UseEngineEventsOptions {
  wasmModule: {
    set_event_callback?: (callback: (event: unknown) => void) => void;
    handle_command?: (command: string, payload: unknown) => unknown;
  } | null;
}

/**
 * Hook that connects WASM events to the Zustand store.
 * Should be called once at the app level after WASM is loaded.
 */
export function useEngineEvents({ wasmModule }: UseEngineEventsOptions): void {
  const setSelection = useEditorStore((s) => s.setSelection);
  const updateSceneGraph = useEditorStore((s) => s.updateSceneGraph);
  const setPrimaryTransform = useEditorStore((s) => s.setPrimaryTransform);
  const setHistoryState = useEditorStore((s) => s.setHistoryState);
  const setSnapSettings = useEditorStore((s) => s.setSnapSettings);
  const setCurrentCameraPreset = useEditorStore((s) => s.setCurrentCameraPreset);
  const setPrimaryMaterial = useEditorStore((s) => s.setPrimaryMaterial);
  const setPrimaryLight = useEditorStore((s) => s.setPrimaryLight);
  const setAmbientLight = useEditorStore((s) => s.setAmbientLight);
  const setEnvironment = useEditorStore((s) => s.setEnvironment);

  // Keep refs to avoid stale closures
  const setSelectionRef = useRef(setSelection);
  const updateSceneGraphRef = useRef(updateSceneGraph);
  const setPrimaryTransformRef = useRef(setPrimaryTransform);
  const setHistoryStateRef = useRef(setHistoryState);
  const setSnapSettingsRef = useRef(setSnapSettings);
  const setCurrentCameraPresetRef = useRef(setCurrentCameraPreset);
  const setPrimaryMaterialRef = useRef(setPrimaryMaterial);
  const setPrimaryLightRef = useRef(setPrimaryLight);
  const setAmbientLightRef = useRef(setAmbientLight);
  const setEnvironmentRef = useRef(setEnvironment);

  useEffect(() => {
    setSelectionRef.current = setSelection;
    updateSceneGraphRef.current = updateSceneGraph;
    setPrimaryTransformRef.current = setPrimaryTransform;
    setHistoryStateRef.current = setHistoryState;
    setSnapSettingsRef.current = setSnapSettings;
    setCurrentCameraPresetRef.current = setCurrentCameraPreset;
    setPrimaryMaterialRef.current = setPrimaryMaterial;
    setPrimaryLightRef.current = setPrimaryLight;
    setAmbientLightRef.current = setAmbientLight;
    setEnvironmentRef.current = setEnvironment;
  }, [setSelection, updateSceneGraph, setPrimaryTransform, setHistoryState, setSnapSettings, setCurrentCameraPreset, setPrimaryMaterial, setPrimaryLight, setAmbientLight, setEnvironment]);

  // Create command dispatcher
  const dispatchCommand = useCallback(
    (command: string, payload: unknown) => {
      if (wasmModule?.handle_command) {
        try {
          wasmModule.handle_command(command, payload);
        } catch (error) {
          console.error(`Error dispatching command '${command}':`, error);
        }
      }
    },
    [wasmModule]
  );

  // Register command dispatcher with the store
  useEffect(() => {
    if (wasmModule) {
      setCommandDispatcher(dispatchCommand);
    }
  }, [wasmModule, dispatchCommand]);

  // Register event callback with WASM
  useEffect(() => {
    if (!wasmModule?.set_event_callback) {
      return;
    }

    const handleEvent = (rawEvent: unknown) => {
      const event = rawEvent as EngineEvent;
      console.log('[Engine Event]', event.type, event.payload);

      switch (event.type) {
        case 'SELECTION_CHANGED':
          setSelectionRef.current(
            event.payload.selectedIds,
            event.payload.primaryId,
            event.payload.primaryName
          );
          break;

        case 'SCENE_GRAPH_UPDATE':
          updateSceneGraphRef.current(event.payload);
          // Mark scene as modified and trigger debounced auto-save
          useEditorStore.setState({ sceneModified: true });
          scheduleAutoSave();
          break;

        case 'TRANSFORM_CHANGED':
          setPrimaryTransformRef.current(event.payload);
          break;

        case 'HISTORY_CHANGED':
          setHistoryStateRef.current(
            event.payload.canUndo,
            event.payload.canRedo,
            event.payload.undoDescription,
            event.payload.redoDescription
          );
          break;

        case 'SNAP_SETTINGS_CHANGED':
          setSnapSettingsRef.current(event.payload);
          break;

        case 'VIEW_PRESET_CHANGED':
          setCurrentCameraPresetRef.current(event.payload.preset);
          break;

        case 'MATERIAL_CHANGED': {
          const { entityId: _matId, ...matData } = event.payload;
          setPrimaryMaterialRef.current(matData as MaterialData);
          break;
        }

        case 'LIGHT_CHANGED': {
          const { entityId: _lightId, ...lightData } = event.payload;
          setPrimaryLightRef.current(lightData as LightData);
          break;
        }

        case 'AMBIENT_LIGHT_CHANGED':
          setAmbientLightRef.current(event.payload);
          break;

        case 'ENVIRONMENT_CHANGED':
          setEnvironmentRef.current(event.payload);
          break;

        case 'COORDINATE_MODE_CHANGED':
          // Update store without sending command back (avoids infinite loop)
          useEditorStore.setState({ coordinateMode: event.payload.mode });
          break;

        case 'REPARENT_RESULT':
          if (!event.payload.success) {
            console.error(
              `Failed to reparent entity ${event.payload.entityId}: ${event.payload.error}`
            );
          }
          break;

        case 'ENGINE_MODE_CHANGED':
          useEditorStore.setState({ engineMode: event.payload.mode });
          break;

        case 'PHYSICS_CHANGED': {
          const { entityId: _physId, enabled, ...physData } = event.payload;
          useEditorStore.getState().setPrimaryPhysics(physData as PhysicsData, enabled);
          break;
        }

        case 'JOINT_CHANGED':
          useEditorStore.getState().setPrimaryJoint(event.payload as JointData | null);
          break;

        case 'DEBUG_PHYSICS_CHANGED':
          useEditorStore.getState().setDebugPhysics(event.payload.enabled);
          break;

        case 'SCENE_EXPORTED': {
          const { json, name } = event.payload;
          const state = useEditorStore.getState();
          if (state.autoSaveEnabled) {
            // Auto-save to localStorage
            try {
              localStorage.setItem('forge:autosave', json);
              localStorage.setItem('forge:autosave:name', name);
              localStorage.setItem('forge:autosave:time', new Date().toISOString());
            } catch {
              console.warn('[AutoSave] localStorage write failed (quota exceeded?)');
            }
          }
          // Dispatch DOM event so SceneToolbar can trigger file download
          window.dispatchEvent(new CustomEvent('forge:scene-exported', { detail: { json, name } }));
          break;
        }

        case 'SCENE_LOADED': {
          const { name } = event.payload;
          useEditorStore.setState({
            sceneName: name,
            sceneModified: false,
            primaryMaterial: null,
            primaryLight: null,
            primaryPhysics: null,
            physicsEnabled: false,
            primaryAnimation: null,
          });
          break;
        }

        case 'INPUT_BINDINGS_CHANGED': {
          // Convert Rust InputMap format to flat InputBinding array
          const bindings: InputBinding[] = Object.values(event.payload.actions).map((action) => {
            const isAxis = action.actionType.type === 'Axis';
            return {
              actionName: action.name,
              actionType: isAxis ? 'axis' as const : 'digital' as const,
              sources: action.sources.map((s) => s.value),
              positiveKeys: isAxis ? (action.actionType.positive ?? []).map((s) => s.value) : undefined,
              negativeKeys: isAxis ? (action.actionType.negative ?? []).map((s) => s.value) : undefined,
              deadZone: action.deadZone,
            };
          });
          const preset = event.payload.preset as InputPreset;
          useEditorStore.getState().setInputBindings(bindings, preset);
          break;
        }

        case 'ASSET_IMPORTED': {
          const { assetId, name: assetName, kind, fileSize } = event.payload;
          useEditorStore.getState().addAssetToRegistry({
            id: assetId,
            name: assetName,
            kind: kind as 'gltf_model' | 'texture',
            fileSize,
            source: { type: 'upload', filename: assetName },
          });
          break;
        }

        case 'ASSET_DELETED': {
          useEditorStore.getState().removeAssetFromRegistry(event.payload.assetId);
          break;
        }

        case 'ASSET_LIST': {
          useEditorStore.getState().setAssetRegistry(event.payload.assets);
          break;
        }

        case 'SCRIPT_CHANGED': {
          const { entityId, source, enabled, template } = event.payload;
          const script: ScriptData = { source, enabled, template };
          useEditorStore.getState().setEntityScript(entityId, script);
          break;
        }

        case 'AUDIO_CHANGED': {
          const { entityId, ...audioData } = event.payload;
          // If assetId is defined (even if null), it means audio exists
          if (audioData.assetId !== undefined) {
            const audio = {
              assetId: audioData.assetId ?? null,
              volume: audioData.volume ?? 1.0,
              pitch: audioData.pitch ?? 1.0,
              loopAudio: audioData.loopAudio ?? false,
              spatial: audioData.spatial ?? false,
              maxDistance: audioData.maxDistance ?? 50,
              refDistance: audioData.refDistance ?? 1,
              rolloffFactor: audioData.rolloffFactor ?? 1,
              autoplay: audioData.autoplay ?? false,
              bus: audioData.bus ?? 'sfx',
            };
            useEditorStore.getState().setEntityAudio(entityId, audio);
          } else {
            useEditorStore.getState().setEntityAudio(entityId, null);
          }
          break;
        }

        case 'AUDIO_BUSES_CHANGED': {
          const { buses } = event.payload;
          useEditorStore.getState().setAudioBuses(buses);
          // Sync to Web Audio API
          import('@/lib/audio/audioManager').then(({ audioManager }) => {
            audioManager.applyBusConfig({ buses });
          });
          break;
        }

        case 'AUDIO_PLAYBACK': {
          const { entityId, action } = event.payload;
          // Import audioManager and route playback
          import('@/lib/audio/audioManager').then(({ audioManager }) => {
            if (action === 'play') audioManager.play(entityId);
            else if (action === 'stop') audioManager.stop(entityId);
            else if (action === 'pause') audioManager.pause(entityId);
            else if (action === 'resume') audioManager.resume(entityId);
          });
          break;
        }

        case 'POST_PROCESSING_CHANGED': {
          const payload = event.payload as PostProcessingData;
          useEditorStore.getState().setPostProcessing(payload);
          break;
        }

        case 'PARTICLE_CHANGED': {
          const { entityId, enabled, particle } = event.payload;
          useEditorStore.getState().setEntityParticle(entityId, particle, enabled);
          break;
        }

        case 'ANIMATION_STATE_CHANGED': {
          const animState = event.payload as AnimationPlaybackState;
          useEditorStore.getState().setEntityAnimation(animState.entityId, animState);
          break;
        }

        case 'ANIMATION_LIST_CHANGED': {
          const animState = event.payload as AnimationPlaybackState;
          useEditorStore.getState().setEntityAnimation(animState.entityId, animState);
          break;
        }

        case 'SHADER_CHANGED': {
          const { data: _data } = event.payload;
          useEditorStore.getState().setPrimaryShaderEffect(_data || null);
          break;
        }

        case 'CSG_COMPLETED': {
          const { entityId, name, operation } = event.payload;
          console.log(`CSG ${operation} completed: ${name} (${entityId})`);
          break;
        }

        case 'CSG_ERROR': {
          const { message } = event.payload;
          console.error(`CSG error: ${message}`);
          break;
        }

        case 'PROCEDURAL_MESH_CREATED': {
          const { entityId, name, operation } = event.payload;
          console.log(`Procedural mesh ${operation} completed: ${name} (${entityId})`);
          break;
        }

        case 'PROCEDURAL_MESH_ERROR': {
          const { message } = event.payload;
          console.error(`Procedural mesh error: ${message}`);
          break;
        }

        case 'ARRAY_COMPLETED': {
          const { count } = event.payload;
          console.log(`Array completed: ${count} entities created`);
          break;
        }

        case 'TERRAIN_CHANGED': {
          const { entityId, terrainData } = event.payload;
          useEditorStore.getState().setTerrainData(entityId, terrainData);
          break;
        }

        case 'QUALITY_CHANGED': {
          useEditorStore.getState().setQualityFromEngine(event.payload);
          break;
        }

        case 'PLAY_TICK':
          firePlayTick(event.payload);
          break;

        case 'COLLISION_EVENT': {
          const collisionCb = (window as unknown as { __scriptCollisionCallback?: (event: { entityA: string; entityB: string; started: boolean }) => void }).__scriptCollisionCallback;
          if (collisionCb && event.type === 'COLLISION_EVENT') {
            collisionCb(event.payload);
          }
          break;
        }

        case 'RAYCAST_RESULT': {
          const raycastCb = (window as unknown as { __scriptRaycastCallback?: (event: { requestId: string; hitEntity: string | null; point: [number, number, number]; distance: number }) => void }).__scriptRaycastCallback;
          if (raycastCb && event.type === 'RAYCAST_RESULT') {
            raycastCb(event.payload);
          }
          break;
        }

        default:
          console.warn('Unknown engine event:', event);
      }
    };

    wasmModule.set_event_callback(handleEvent);
    console.log('[useEngineEvents] Event callback registered');
  }, [wasmModule]);
}
