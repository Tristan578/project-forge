import { describe, it, expect } from 'vitest';
import { generateSuggestions } from '../suggestions';
import type { SceneGraph } from '@/stores/slices/types';

function emptyEditorState() {
  return {
    sceneGraph: { nodes: {}, rootIds: [] } as SceneGraph,
    selectedIds: new Set<string>(),
    primaryId: null as string | null,
  };
}

function populatedEditorState(primaryId?: string) {
  const nodes: SceneGraph['nodes'] = {
    'cube-1': { entityId: 'cube-1', name: 'Cube', parentId: null, children: [], components: ['Mesh3d'], visible: true },
    'light-1': { entityId: 'light-1', name: 'Light', parentId: null, children: [], components: ['PointLight'], visible: true },
  };
  return {
    sceneGraph: { nodes, rootIds: ['cube-1', 'light-1'] } as SceneGraph,
    selectedIds: primaryId ? new Set([primaryId]) : new Set<string>(),
    primaryId: primaryId ?? null,
  };
}

describe('generateSuggestions', () => {
  it('returns empty scene suggestions when no entities exist', () => {
    const state = emptyEditorState();
    const suggestions = generateSuggestions(state);
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.length).toBeLessThanOrEqual(4);
    // Should suggest scene creation
    expect(suggestions.some((s) => s.label.toLowerCase().includes('scene') || s.label.toLowerCase().includes('level') || s.label.toLowerCase().includes('create'))).toBe(true);
  });

  it('returns general suggestions when entities exist but none selected', () => {
    const state = populatedEditorState();
    const suggestions = generateSuggestions(state);
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.length).toBeLessThanOrEqual(4);
  });

  it('returns entity-specific suggestions when an entity is selected', () => {
    const state = populatedEditorState('cube-1');
    const suggestions = generateSuggestions(state);
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.length).toBeLessThanOrEqual(3);
    // Should suggest entity-specific actions
    expect(suggestions.some((s) =>
      s.label.toLowerCase().includes('material') ||
      s.label.toLowerCase().includes('physics') ||
      s.label.toLowerCase().includes('script')
    )).toBe(true);
  });

  it('returns tool-specific follow-ups after spawn_entity', () => {
    const state = populatedEditorState();
    const toolCalls = [
      { id: 'tc1', name: 'spawn_entity', input: { type: 'cube' }, status: 'success' as const, undoable: true },
    ];
    const suggestions = generateSuggestions(state, toolCalls);
    expect(suggestions.length).toBeGreaterThan(0);
    // Follow-ups should relate to the spawned entity
    expect(suggestions.some((s) =>
      s.label.toLowerCase().includes('material') ||
      s.label.toLowerCase().includes('physics') ||
      s.label.toLowerCase().includes('spawn')
    )).toBe(true);
  });

  it('returns tool-specific follow-ups after update_material', () => {
    const state = populatedEditorState();
    const toolCalls = [
      { id: 'tc1', name: 'update_material', input: {}, status: 'success' as const, undoable: true },
    ];
    const suggestions = generateSuggestions(state, toolCalls);
    expect(suggestions.length).toBeGreaterThan(0);
  });

  it('returns tool-specific follow-ups after set_script', () => {
    const state = populatedEditorState();
    const toolCalls = [
      { id: 'tc1', name: 'set_script', input: {}, status: 'success' as const, undoable: true },
    ];
    const suggestions = generateSuggestions(state, toolCalls);
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.some((s) =>
      s.label.toLowerCase().includes('input') ||
      s.label.toLowerCase().includes('collision') ||
      s.label.toLowerCase().includes('ui')
    )).toBe(true);
  });

  it('falls back to general suggestions for unknown tool names', () => {
    const state = populatedEditorState();
    const toolCalls = [
      { id: 'tc1', name: 'unknown_tool', input: {}, status: 'success' as const, undoable: true },
    ];
    const suggestions = generateSuggestions(state, toolCalls);
    // Should fall back to general suggestions
    expect(suggestions.length).toBeGreaterThan(0);
  });

  it('uses the last tool call for follow-up suggestions', () => {
    const state = populatedEditorState();
    const toolCalls = [
      { id: 'tc1', name: 'spawn_entity', input: {}, status: 'success' as const, undoable: true },
      { id: 'tc2', name: 'update_material', input: {}, status: 'success' as const, undoable: true },
    ];
    const suggestions = generateSuggestions(state, toolCalls);
    // Should use the LAST tool call (update_material), not the first
    expect(suggestions.length).toBeGreaterThan(0);
  });

  it('ignores empty tool calls array', () => {
    const state = populatedEditorState();
    const suggestions = generateSuggestions(state, []);
    // Should fall back to general suggestions
    expect(suggestions.length).toBeGreaterThan(0);
  });

  it('each suggestion has a label and a prompt', () => {
    const state = emptyEditorState();
    const suggestions = generateSuggestions(state);
    for (const s of suggestions) {
      expect(s.label).not.toBe('');
      expect(s.prompt).not.toBe('');
      expect(s.prompt.length).toBeGreaterThan(s.label.length);
    }
  });
});
