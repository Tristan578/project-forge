/**
 * Context-aware suggestion generation for the AI chat panel.
 * Generates follow-up suggestions based on editor state and recent tool calls.
 */

import type { SceneGraph } from '@/stores/slices/types';
import type { ToolCallStatus } from '@/stores/chatStore';

interface EditorState {
  sceneGraph: SceneGraph;
  selectedIds: Set<string>;
  primaryId: string | null;
}

interface Suggestion {
  label: string;
  prompt: string;
}

// Empty scene suggestions
const EMPTY_SCENE_SUGGESTIONS: Suggestion[] = [
  { label: 'Create a game scene', prompt: 'Create a simple platformer scene with a player, platforms, and collectibles' },
  { label: 'Add basic lighting', prompt: 'Add a directional light and some point lights to my scene' },
  { label: 'Build a level', prompt: 'Build a complete game level with obstacles, goals, and decorations' },
  { label: 'Import a model', prompt: 'How do I import a 3D model into my scene?' },
];

// Suggestions when entities exist but none selected
const GENERAL_SUGGESTIONS: Suggestion[] = [
  { label: 'Add more entities', prompt: 'Add more variety to my scene with different shapes and materials' },
  { label: 'Set up physics', prompt: 'Add physics to all the objects in my scene' },
  { label: 'Write game logic', prompt: 'Write a script to make this scene interactive' },
  { label: 'Improve visuals', prompt: 'Improve the visual quality with better materials and lighting' },
  { label: 'Add audio', prompt: 'Add background music and sound effects to my scene' },
  { label: 'Export game', prompt: 'Help me export this as a standalone playable game' },
];

// Suggestions when an entity is selected
const SELECTED_ENTITY_SUGGESTIONS: Suggestion[] = [
  { label: 'Change material', prompt: 'Give the selected entity a more interesting material' },
  { label: 'Add physics', prompt: 'Add physics to the selected entity so it can interact with other objects' },
  { label: 'Add a script', prompt: 'Write a movement script for the selected entity' },
  { label: 'Duplicate & arrange', prompt: 'Duplicate the selected entity and arrange copies in a pattern' },
  { label: 'Add particles', prompt: 'Add a particle effect to the selected entity' },
];

// Follow-up suggestions based on last tool call categories
const TOOL_FOLLOWUPS: Record<string, Suggestion[]> = {
  spawn_entity: [
    { label: 'Add material', prompt: 'Give the new entity a colorful material' },
    { label: 'Add physics', prompt: 'Make the new entity physics-enabled' },
    { label: 'Spawn more', prompt: 'Spawn a few more entities to build out the scene' },
  ],
  update_material: [
    { label: 'Add emissive glow', prompt: 'Make the material glow with emissive light' },
    { label: 'Apply to others', prompt: 'Apply a similar material to other entities in the scene' },
    { label: 'Add texture', prompt: 'Load and apply a texture to this material' },
  ],
  set_physics: [
    { label: 'Add forces', prompt: 'Add a constant force or velocity to the physics object' },
    { label: 'Test physics', prompt: 'Set up a physics test with objects that collide' },
    { label: 'Add constraints', prompt: 'Add a physics joint to connect two objects' },
  ],
  set_script: [
    { label: 'Add input handling', prompt: 'Make the script respond to keyboard input' },
    { label: 'Add collision logic', prompt: 'Add collision detection to the script' },
    { label: 'Add UI display', prompt: 'Show a score or health display with the HUD API' },
  ],
  update_light: [
    { label: 'Add shadows', prompt: 'Enable shadows on the lights' },
    { label: 'Change mood', prompt: 'Change the lighting to create a different mood' },
    { label: 'Add fog', prompt: 'Add atmospheric fog to the scene' },
  ],
  set_particle: [
    { label: 'Try another preset', prompt: 'Try a different particle effect preset' },
    { label: 'Add to more entities', prompt: 'Add particle effects to other entities too' },
  ],
  export_game: [
    { label: 'Polish first', prompt: 'What else should I polish before exporting?' },
    { label: 'Add a start screen', prompt: 'Add a start screen UI before exporting' },
  ],
};

/**
 * Generate context-aware chat suggestions based on editor state and recent actions.
 */
export function generateSuggestions(
  editorState: EditorState,
  lastToolCalls?: ToolCallStatus[]
): Suggestion[] {
  const nodeCount = Object.keys(editorState.sceneGraph.nodes).length;

  // If we have recent tool calls, show follow-ups
  if (lastToolCalls && lastToolCalls.length > 0) {
    const lastToolName = lastToolCalls[lastToolCalls.length - 1].name;
    const followups = TOOL_FOLLOWUPS[lastToolName];
    if (followups) {
      return followups.slice(0, 3);
    }
  }

  // Empty scene
  if (nodeCount === 0) {
    return EMPTY_SCENE_SUGGESTIONS.slice(0, 4);
  }

  // Entity selected
  if (editorState.primaryId && editorState.sceneGraph.nodes[editorState.primaryId]) {
    return SELECTED_ENTITY_SUGGESTIONS.slice(0, 3);
  }

  // General scene with entities
  return GENERAL_SUGGESTIONS.slice(0, 4);
}

export type { Suggestion };
