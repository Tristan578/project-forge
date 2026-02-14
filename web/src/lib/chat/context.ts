import type { SceneGraph, SceneNode, TransformData, MaterialData, LightData, PhysicsData, AmbientLightData, EnvironmentData, EngineMode, InputBinding, InputPreset, AssetMetadata, ScriptData, AudioData, ParticleData, PostProcessingData, AudioBusDef, AnimationPlaybackState, ShaderEffectData } from '@/stores/editorStore';


interface EditorSnapshot {
  sceneGraph: SceneGraph;
  selectedIds: Set<string>;
  primaryId: string | null;
  primaryTransform: TransformData | null;
  primaryMaterial: MaterialData | null;
  primaryShaderEffect?: ShaderEffectData | null;
  primaryLight: LightData | null;
  primaryPhysics?: PhysicsData | null;
  physicsEnabled?: boolean;
  ambientLight: AmbientLightData;
  environment: EnvironmentData;
  engineMode?: EngineMode;
  canUndo: boolean;
  canRedo: boolean;
  undoDescription: string | null;
  redoDescription: string | null;
  inputBindings?: InputBinding[];
  inputPreset?: InputPreset;
  sceneName?: string;
  assetRegistry?: Record<string, AssetMetadata>;
  allScripts?: Record<string, ScriptData>;
  primaryAudio?: AudioData | null;
  primaryParticle?: ParticleData | null;
  particleEnabled?: boolean;
  primaryAnimation?: AnimationPlaybackState | null;
  postProcessing?: PostProcessingData;
  audioBuses?: AudioBusDef[];
  terrainData?: Record<string, import('@/stores/editorStore').TerrainDataState>;
}

function formatVec3(v: [number, number, number]): string {
  return `[${v.map((n) => Math.round(n * 100) / 100).join(', ')}]`;
}

function formatColor(c: [number, number, number] | [number, number, number, number]): string {
  return `[${c.slice(0, 3).map((n) => Math.round(n * 100) / 100).join(', ')}]`;
}

function describeEntity(node: SceneNode, graph: SceneGraph, indent: string = ''): string {
  const entityType = node.components.includes('TerrainEnabled')
    ? 'terrain'
    : node.components.includes('Mesh3d')
      ? 'mesh'
      : node.components.includes('PointLight')
        ? 'point_light'
        : node.components.includes('DirectionalLight')
          ? 'directional_light'
          : node.components.includes('SpotLight')
            ? 'spot_light'
            : 'entity';

  let line = `${indent}- "${node.name}" (${entityType}, id: ${node.entityId})`;
  if (!node.visible) line += ' [hidden]';
  return line;
}

function describeEntityDetailed(
  node: SceneNode,
  graph: SceneGraph,
  transform: TransformData | null,
  material: MaterialData | null,
  shader: ShaderEffectData | null | undefined,
  light: LightData | null,
  physics?: PhysicsData | null,
  physicsEnabled?: boolean,
  terrain?: import('@/stores/editorStore').TerrainDataState | null
): string {
  const lines: string[] = [];
  lines.push(`  Entity: "${node.name}" (id: ${node.entityId})`);
  lines.push(`  Components: ${node.components.join(', ')}`);
  if (!node.visible) lines.push(`  Visibility: hidden`);

  if (transform) {
    lines.push(`  Position: ${formatVec3(transform.position)}`);
    const rotDeg = transform.rotation.map((r) => Math.round((r * 180) / Math.PI)) as [number, number, number];
    lines.push(`  Rotation: ${formatVec3(rotDeg)}deg`);
    lines.push(`  Scale: ${formatVec3(transform.scale)}`);
  }

  if (material) {
    lines.push(`  Material: color=${formatColor(material.baseColor)}, metallic=${material.metallic}, roughness=${material.perceptualRoughness}`);
    if (material.unlit) lines.push(`  Material mode: unlit`);
    if (material.clearcoat && material.clearcoat > 0) lines.push(`  Clearcoat: ${material.clearcoat}`);
    if (material.specularTransmission && material.specularTransmission > 0) lines.push(`  Transmission: specular=${material.specularTransmission}, ior=${material.ior ?? 1.5}`);
    if (material.diffuseTransmission && material.diffuseTransmission > 0) lines.push(`  Diffuse transmission: ${material.diffuseTransmission}`);
  }

  if (shader && shader.shaderType !== 'none') {
    lines.push(`  Custom shader: ${shader.shaderType}, emission=${shader.emissionStrength.toFixed(1)}`);
  }

  if (light) {
    lines.push(`  Light: ${light.lightType}, color=${formatColor(light.color)}, intensity=${light.intensity}`);
    if (light.shadowsEnabled) lines.push(`  Shadows: enabled`);
  }

  if (physicsEnabled && physics) {
    lines.push(`  Physics: ${physics.bodyType}, collider=${physics.colliderShape}, restitution=${physics.restitution}, friction=${physics.friction}, density=${physics.density}`);
    if (physics.gravityScale !== 1.0) lines.push(`  Gravity scale: ${physics.gravityScale}`);
    if (physics.isSensor) lines.push(`  Sensor: true`);
  } else if (physicsEnabled) {
    lines.push(`  Physics: enabled (default settings)`);
  }

  if (terrain) {
    lines.push(`  Terrain: ${terrain.noiseType} noise, resolution=${terrain.resolution}x${terrain.resolution}, size=${terrain.size}`);
    lines.push(`  Noise params: octaves=${terrain.octaves}, frequency=${terrain.frequency}, amplitude=${terrain.amplitude}, height=${terrain.heightScale}, seed=${terrain.seed}`);
  }

  if (node.children.length > 0) {
    const childNames = node.children
      .map((cid) => graph.nodes[cid]?.name)
      .filter(Boolean);
    lines.push(`  Children: ${childNames.join(', ')}`);
  }

  return lines.join('\n');
}

export function buildSceneContext(state: EditorSnapshot): string {
  const { sceneGraph, selectedIds, primaryId, primaryTransform, primaryMaterial, primaryLight, ambientLight, environment } = state;
  const nodeCount = Object.keys(sceneGraph.nodes).length;
  const sections: string[] = [];

  // Engine mode
  if (state.engineMode && state.engineMode !== 'edit') {
    sections.push(`## Engine Mode: ${state.engineMode.toUpperCase()}\n(Scene editing commands are disabled during play mode)`);
  }

  // Scene overview
  const sceneLabel = state.sceneName && state.sceneName !== 'Untitled' ? ` "${state.sceneName}"` : '';
  sections.push(`## Current Scene State${sceneLabel}\nEntities: ${nodeCount}`);

  if (nodeCount === 0) {
    sections.push('(Empty scene — no entities yet)');
  } else if (nodeCount <= 20) {
    // Full detail for small scenes
    const lines: string[] = [];
    function walk(ids: string[], indent: string) {
      for (const id of ids) {
        const node = sceneGraph.nodes[id];
        if (!node) continue;
        lines.push(describeEntity(node, sceneGraph, indent));
        if (node.children.length > 0) walk(node.children, indent + '  ');
      }
    }
    walk(sceneGraph.rootIds, '');
    sections.push(lines.join('\n'));
  } else if (nodeCount <= 100) {
    // Names for all, detail for selected
    const lines: string[] = [];
    for (const id of sceneGraph.rootIds) {
      const node = sceneGraph.nodes[id];
      if (!node) continue;
      lines.push(describeEntity(node, sceneGraph));
      // Show only direct children count
      if (node.children.length > 0) lines.push(`    (${node.children.length} children)`);
    }
    sections.push(lines.join('\n'));
  } else {
    // Large scene — just summary
    const types: Record<string, number> = {};
    for (const node of Object.values(sceneGraph.nodes)) {
      const type = node.components.includes('Mesh3d') ? 'mesh' : node.components.includes('PointLight') || node.components.includes('DirectionalLight') || node.components.includes('SpotLight') ? 'light' : 'other';
      types[type] = (types[type] || 0) + 1;
    }
    sections.push(`Scene summary: ${types.mesh || 0} meshes, ${types.light || 0} lights, ${types.other || 0} other`);
  }

  // Selected entity detail
  if (primaryId && sceneGraph.nodes[primaryId]) {
    const terrainData = state.terrainData && primaryId ? state.terrainData[primaryId] : null;
    sections.push('\n## Selected Entity');
    sections.push(describeEntityDetailed(sceneGraph.nodes[primaryId], sceneGraph, primaryTransform, primaryMaterial, state.primaryShaderEffect, primaryLight, state.primaryPhysics, state.physicsEnabled, terrainData));
  } else if (selectedIds.size > 0) {
    const names = [...selectedIds]
      .map((id) => sceneGraph.nodes[id]?.name)
      .filter(Boolean);
    sections.push(`\n## Selection\n${selectedIds.size} entities selected: ${names.join(', ')}`);
  } else {
    sections.push('\nNo entity selected.');
  }

  // Environment
  sections.push(`\n## Environment\nAmbient light: color=${formatColor(ambientLight.color)}, brightness=${ambientLight.brightness}`);
  if (environment.fogEnabled) {
    sections.push(`Fog: enabled, color=${formatColor(environment.fogColor)}, range=${environment.fogStart}-${environment.fogEnd}`);
  }

  // Post-processing
  if (state.postProcessing) {
    const pp = state.postProcessing;
    const enabledEffects: string[] = [];
    if (pp.bloom.enabled) enabledEffects.push(`bloom (intensity=${pp.bloom.intensity.toFixed(2)})`);
    if (pp.chromaticAberration.enabled) enabledEffects.push(`chromatic aberration (intensity=${pp.chromaticAberration.intensity.toFixed(3)})`);
    if (pp.colorGrading.enabled) enabledEffects.push(`color grading (exposure=${pp.colorGrading.global.exposure.toFixed(2)})`);
    if (pp.sharpening.enabled) enabledEffects.push(`sharpening (strength=${pp.sharpening.sharpeningStrength.toFixed(2)})`);
    if (enabledEffects.length > 0) {
      sections.push(`\n## Post-Processing\n${enabledEffects.join(', ')}`);
    }
  }

  // Assets
  if (state.assetRegistry) {
    const assets = Object.values(state.assetRegistry);
    if (assets.length > 0) {
      const models = assets.filter((a) => a.kind === 'gltf_model').length;
      const textures = assets.filter((a) => a.kind === 'texture').length;
      const parts: string[] = [];
      if (models > 0) parts.push(`${models} model${models > 1 ? 's' : ''}`);
      if (textures > 0) parts.push(`${textures} texture${textures > 1 ? 's' : ''}`);
      sections.push(`\n## Assets\n${assets.length} assets: ${parts.join(', ')}`);
    }
  }

  // Scripts
  if (state.allScripts) {
    const scripts = Object.entries(state.allScripts);
    if (scripts.length > 0) {
      const enabled = scripts.filter(([, s]) => s.enabled).length;
      const withTemplates = scripts.filter(([, s]) => s.template).length;
      const parts: string[] = [`${scripts.length} scripted entit${scripts.length === 1 ? 'y' : 'ies'}`];
      if (enabled < scripts.length) parts.push(`${enabled} enabled`);
      if (withTemplates > 0) parts.push(`${withTemplates} from templates`);
      sections.push(`\n## Scripts\n${parts.join(', ')}`);
    }
  }

  // Audio
  if (state.assetRegistry) {
    const audioAssets = Object.values(state.assetRegistry).filter((a) => a.kind === 'audio');
    if (audioAssets.length > 0) {
      const assetNames = audioAssets.map((a) => a.name).join(', ');
      sections.push(`\n## Audio Assets\n${audioAssets.length} audio file${audioAssets.length === 1 ? '' : 's'}: ${assetNames}`);
    }
  }

  // Audio Buses
  if (state.audioBuses && state.audioBuses.length > 0) {
    const busesInfo = state.audioBuses.map((bus) => {
      const status = [];
      if (bus.muted) status.push('muted');
      if (bus.soloed) status.push('solo');
      if (bus.effects.length > 0) status.push(`${bus.effects.length} FX`);
      const statusStr = status.length > 0 ? ` (${status.join(', ')})` : '';
      return `${bus.name}: vol=${(bus.volume * 100).toFixed(0)}%${statusStr}`;
    }).join(', ');
    sections.push(`\n## Audio Buses\n${busesInfo}`);
  }

  // Animation (selected entity)
  if (state.primaryAnimation && state.primaryAnimation.availableClips.length > 0) {
    const anim = state.primaryAnimation;
    const clipNames = anim.availableClips.map((c) => `${c.name} (${c.durationSecs.toFixed(1)}s)`).join(', ');
    const statusParts: string[] = [`${anim.availableClips.length} clips: ${clipNames}`];
    if (anim.activeClipName) {
      statusParts.push(`active: "${anim.activeClipName}", ${anim.isPlaying ? (anim.isPaused ? 'paused' : 'playing') : 'stopped'}, speed=${anim.speed}x, loop=${anim.isLooping}`);
    }
    sections.push(`\n## Animation\n${statusParts.join('\n')}`);
  }

  // Input bindings
  if (state.inputBindings && state.inputBindings.length > 0) {
    const presetLabel = state.inputPreset ? ` (preset: ${state.inputPreset})` : ' (custom)';
    const actionNames = state.inputBindings.map((b) => b.actionName).join(', ');
    sections.push(`\n## Input Bindings${presetLabel}\n${state.inputBindings.length} actions: ${actionNames}`);
  }

  // History
  if (state.canUndo || state.canRedo) {
    const historyParts: string[] = [];
    if (state.canUndo) historyParts.push(`can undo: "${state.undoDescription}"`);
    if (state.canRedo) historyParts.push(`can redo: "${state.redoDescription}"`);
    sections.push(`\n## History\n${historyParts.join(', ')}`);
  }

  // Entity reference hint
  sections.push('\n## Entity References\nUsers may reference entities with @EntityName format. When mentioned, entity IDs are provided in brackets at the end of the message. Use the provided entity IDs for commands.');

  return sections.join('\n');
}
