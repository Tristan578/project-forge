'use client';

import { useState } from 'react';
import { Check, X, Loader2, ChevronDown, ChevronRight, Undo2, RotateCcw, Eye, XCircle } from 'lucide-react';
import type { ToolCallStatus } from '@/stores/chatStore';
import { useEditorStore } from '@/stores/editorStore';

interface ToolCallCardProps {
  toolCall: ToolCallStatus;
  onApprove?: (id: string) => void;
  onReject?: (id: string) => void;
}

const TOOL_LABELS: Record<string, string> = {
  spawn_entity: 'Spawn Entity',
  despawn_entity: 'Remove Entity',
  delete_entities: 'Delete Entities',
  duplicate_entity: 'Duplicate Entity',
  update_transform: 'Transform',
  rename_entity: 'Rename',
  reparent_entity: 'Reparent',
  set_visibility: 'Visibility',
  select_entity: 'Select',
  update_material: 'Material',
  apply_material_preset: 'Material Preset',
  set_custom_shader: 'Set Custom Shader',
  remove_custom_shader: 'Remove Custom Shader',
  list_shaders: 'List Shaders',
  update_light: 'Light',
  update_ambient_light: 'Ambient Light',
  update_environment: 'Environment',
  set_skybox: 'Set Skybox',
  remove_skybox: 'Remove Skybox',
  update_skybox: 'Update Skybox',
  update_post_processing: 'Post Processing',
  get_post_processing: 'Post Processing Query',
  set_gizmo_mode: 'Gizmo Mode',
  set_camera_preset: 'Camera Preset',
  undo: 'Undo',
  redo: 'Redo',
  play: 'Play',
  stop: 'Stop',
  pause: 'Pause',
  resume: 'Resume',
  get_mode: 'Get Mode',
  update_physics: 'Physics',
  toggle_physics: 'Toggle Physics',
  toggle_debug_physics: 'Debug Physics',
  get_physics: 'Get Physics',
  apply_force: 'Apply Force',
  set_input_binding: 'Input Binding',
  remove_input_binding: 'Remove Binding',
  set_input_preset: 'Input Preset',
  get_input_bindings: 'Get Bindings',
  get_input_state: 'Get Input State',
  export_scene: 'Save Scene',
  load_scene: 'Load Scene',
  new_scene: 'New Scene',
  get_scene_name: 'Get Scene Name',
  import_gltf: 'Import glTF',
  load_texture: 'Load Texture',
  remove_texture: 'Remove Texture',
  place_asset: 'Place Asset',
  delete_asset: 'Delete Asset',
  list_assets: 'List Assets',
  set_script: 'Set Script',
  remove_script: 'Remove Script',
  get_script: 'Get Script',
  list_script_templates: 'Script Templates',
  apply_script_template: 'Apply Template',
  set_audio: 'Set Audio',
  remove_audio: 'Remove Audio',
  play_audio: 'Play Audio',
  stop_audio: 'Stop Audio',
  pause_audio: 'Pause Audio',
  get_audio: 'Get Audio',
  import_audio: 'Import Audio',
  update_audio_bus: 'Update Audio Bus',
  create_audio_bus: 'Create Audio Bus',
  delete_audio_bus: 'Delete Audio Bus',
  get_audio_buses: 'Get Audio Buses',
  set_bus_effects: 'Set Bus Effects',
  audio_crossfade: 'Crossfade Audio',
  audio_fade_in: 'Fade In Audio',
  audio_fade_out: 'Fade Out Audio',
  audio_play_one_shot: 'Play One-Shot',
  audio_add_layer: 'Add Audio Layer',
  audio_remove_layer: 'Remove Audio Layer',
  set_ducking_rule: 'Set Ducking Rule',
  set_particle: 'Set Particles',
  remove_particle: 'Remove Particles',
  toggle_particle: 'Toggle Particles',
  set_particle_preset: 'Apply Particle Preset',
  play_particle: 'Play Particles',
  stop_particle: 'Stop Particles',
  burst_particle: 'Burst Particles',
  get_particle: 'Get Particles',
  play_animation: 'Play Animation',
  pause_animation: 'Pause Animation',
  resume_animation: 'Resume Animation',
  stop_animation: 'Stop Animation',
  seek_animation: 'Seek Animation',
  set_animation_speed: 'Animation Speed',
  set_animation_loop: 'Animation Loop',
  set_animation_blend_weight: 'Animation Blend Weight',
  set_clip_speed: 'Clip Speed',
  get_animation_graph: 'Get Animation Graph',
  get_animation_state: 'Get Animation State',
  list_animations: 'List Animations',
  export_game: 'Export Game',
  get_export_status: 'Export Status',
  csg_union: 'CSG Union',
  csg_subtract: 'CSG Subtract',
  csg_intersect: 'CSG Intersect',
  extrude_shape: 'Extrude Shape',
  lathe_shape: 'Lathe Shape',
  array_entity: 'Array Entity',
  combine_meshes: 'Combine Meshes',
  spawn_terrain: 'Spawn Terrain',
  update_terrain: 'Update Terrain',
  sculpt_terrain: 'Sculpt Terrain',
  get_terrain: 'Get Terrain',
  search_docs: 'Search Docs',
  get_doc: 'Get Doc',
  list_doc_topics: 'List Doc Topics',
  list_material_presets: 'List Material Presets',
  save_material_to_library: 'Save Material',
  delete_library_material: 'Delete Custom Material',
  list_custom_materials: 'List Custom Materials',
  set_quality_preset: 'Set Quality Preset',
  get_quality_settings: 'Get Quality Settings',
  save_as_prefab: 'Save as Prefab',
  instantiate_prefab: 'Instantiate Prefab',
  list_prefabs: 'List Prefabs',
  delete_prefab: 'Delete Prefab',
  get_prefab: 'Get Prefab',
  create_scene: 'Create Scene',
  switch_scene: 'Switch Scene',
  duplicate_scene: 'Duplicate Scene',
  delete_scene: 'Delete Scene',
  rename_scene: 'Rename Scene',
  set_start_scene: 'Set Start Scene',
  list_scenes: 'List Scenes',
};

function summarizeInput(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'spawn_entity':
      return `${input.entityType}${input.name ? ` "${input.name}"` : ''}`;
    case 'update_transform': {
      const parts: string[] = [];
      if (input.position) parts.push(`pos=${JSON.stringify(input.position)}`);
      if (input.rotation) parts.push(`rot=${JSON.stringify(input.rotation)}`);
      if (input.scale) parts.push(`scale=${JSON.stringify(input.scale)}`);
      return parts.join(', ');
    }
    case 'update_material':
      if (input.baseColor) return `color=[${(input.baseColor as number[]).map((n) => n.toFixed(1)).join(',')}]`;
      return Object.keys(input).filter((k) => k !== 'entityId').join(', ');
    case 'apply_material_preset':
      return `${input.presetId ?? ''}`;
    case 'rename_entity':
      return `"${input.name}"`;
    case 'set_camera_preset':
      return input.preset as string;
    case 'set_gizmo_mode':
      return input.mode as string;
    default:
      return '';
  }
}

export function ToolCallCard({ toolCall, onApprove, onReject }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);
  const undo = useEditorStore((s) => s.undo);

  const label = TOOL_LABELS[toolCall.name] || toolCall.name;
  const summary = summarizeInput(toolCall.name, toolCall.input);

  const statusIcon = (() => {
    switch (toolCall.status) {
      case 'pending':
        return <Loader2 size={14} className="animate-spin text-blue-400" />;
      case 'success':
        return <Check size={14} className="text-green-400" />;
      case 'error':
        return <X size={14} className="text-red-400" />;
      case 'preview':
        return <Eye size={14} className="text-amber-400" />;
      case 'rejected':
        return <XCircle size={14} className="text-red-400/60" />;
      case 'undone':
        return <RotateCcw size={14} className="text-zinc-500" />;
    }
  })();

  const isPreview = toolCall.status === 'preview';
  const isRejected = toolCall.status === 'rejected';
  const isUndone = toolCall.status === 'undone';

  return (
    <div className={`my-1 rounded border text-xs ${
      isPreview
        ? 'border-amber-700/50 bg-amber-950/20'
        : isRejected
          ? 'border-red-900/30 bg-red-950/10 opacity-60'
          : isUndone
            ? 'border-zinc-700/50 bg-zinc-800/30 opacity-50'
            : 'border-zinc-700 bg-zinc-800/50'
    }`}>
      <button
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left"
        onClick={() => setExpanded(!expanded)}
      >
        {statusIcon}
        <span className={`font-medium ${isRejected || isUndone ? 'text-zinc-500 line-through' : 'text-zinc-300'}`}>
          {label}
        </span>
        {summary && <span className="truncate text-zinc-500">{summary}</span>}
        <span className="ml-auto flex items-center gap-1">
          {isRejected && (
            <span className="text-[9px] text-red-400/60">Rejected</span>
          )}
          {isUndone && (
            <span className="text-[9px] text-zinc-500">Undone</span>
          )}
          {toolCall.status === 'success' && toolCall.undoable && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                undo();
              }}
              className="rounded px-1 py-0.5 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300"
              title="Undo this action"
            >
              <Undo2 size={12} />
            </button>
          )}
          {expanded ? <ChevronDown size={12} className="text-zinc-500" /> : <ChevronRight size={12} className="text-zinc-500" />}
        </span>
      </button>

      {/* Preview approval buttons */}
      {isPreview && (
        <div className="flex gap-2 border-t border-amber-800/30 px-2 py-1.5">
          <button
            onClick={() => onApprove?.(toolCall.id)}
            className="flex items-center gap-1 rounded bg-green-600/20 px-2 py-1 text-green-400 hover:bg-green-600/30"
          >
            <Check size={12} />
            <span>Approve</span>
          </button>
          <button
            onClick={() => onReject?.(toolCall.id)}
            className="flex items-center gap-1 rounded bg-red-600/20 px-2 py-1 text-red-400 hover:bg-red-600/30"
          >
            <X size={12} />
            <span>Reject</span>
          </button>
        </div>
      )}

      {expanded && (
        <div className="border-t border-zinc-700 px-2 py-1.5">
          <pre className="max-h-32 overflow-auto whitespace-pre-wrap text-zinc-500">
            {JSON.stringify(toolCall.input, null, 2)}
          </pre>
          {toolCall.error && (
            <p className="mt-1 text-red-400">{toolCall.error}</p>
          )}
          {toolCall.result != null && (
            <pre className="mt-1 max-h-20 overflow-auto whitespace-pre-wrap text-zinc-500">
              {JSON.stringify(toolCall.result, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
