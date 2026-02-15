import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockSetGet, createMockActions } from './eventTestUtils';

// Mock the editor store module
vi.mock('@/stores/editorStore', () => ({
  useEditorStore: {
    getState: vi.fn(),
    setState: vi.fn(),
    subscribe: vi.fn(),
  },
}));

import { useEditorStore } from '@/stores/editorStore';
import { handleMaterialEvent } from '../materialEvents';

describe('handleMaterialEvent', () => {
  let actions: ReturnType<typeof createMockActions>;
  let mockSetGet: ReturnType<typeof createMockSetGet>;

  beforeEach(() => {
    actions = createMockActions();
    mockSetGet = createMockSetGet();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useEditorStore.getState).mockReturnValue(actions as any);
  });

  it('returns false for unknown event types', () => {
    const result = handleMaterialEvent(
      'UNKNOWN_EVENT',
      {},
      mockSetGet.set,
      mockSetGet.get
    );
    expect(result).toBe(false);
  });

  it('MATERIAL_CHANGED: strips entityId and calls setPrimaryMaterial', () => {
    const payload = {
      entityId: 'entity-123',
      baseColor: { r: 1, g: 0, b: 0, a: 1 },
      metallic: 0.5,
      roughness: 0.8,
    };

    const result = handleMaterialEvent(
      'MATERIAL_CHANGED',
      payload,
      mockSetGet.set,
      mockSetGet.get
    );

    expect(result).toBe(true);
    expect(actions.setPrimaryMaterial).toHaveBeenCalledWith({
      baseColor: { r: 1, g: 0, b: 0, a: 1 },
      metallic: 0.5,
      roughness: 0.8,
    });
  });

  it('LIGHT_CHANGED: strips entityId and calls setPrimaryLight', () => {
    const payload = {
      entityId: 'entity-456',
      lightType: 'point',
      color: { r: 1, g: 1, b: 1 },
      intensity: 800,
    };

    const result = handleMaterialEvent(
      'LIGHT_CHANGED',
      payload,
      mockSetGet.set,
      mockSetGet.get
    );

    expect(result).toBe(true);
    expect(actions.setPrimaryLight).toHaveBeenCalledWith({
      lightType: 'point',
      color: { r: 1, g: 1, b: 1 },
      intensity: 800,
    });
  });

  it('AMBIENT_LIGHT_CHANGED: passes full payload to setAmbientLight', () => {
    const payload = {
      color: { r: 0.5, g: 0.5, b: 0.5 },
      brightness: 0.3,
    };

    const result = handleMaterialEvent(
      'AMBIENT_LIGHT_CHANGED',
      payload,
      mockSetGet.set,
      mockSetGet.get
    );

    expect(result).toBe(true);
    expect(actions.setAmbientLight).toHaveBeenCalledWith(payload);
  });

  it('ENVIRONMENT_CHANGED: passes full payload to setEnvironment', () => {
    const payload = {
      clearColor: { r: 0.2, g: 0.3, b: 0.4 },
      fogEnabled: true,
      fogColor: { r: 0.5, g: 0.6, b: 0.7 },
    };

    const result = handleMaterialEvent(
      'ENVIRONMENT_CHANGED',
      payload,
      mockSetGet.set,
      mockSetGet.get
    );

    expect(result).toBe(true);
    expect(actions.setEnvironment).toHaveBeenCalledWith(payload);
  });

  it('POST_PROCESSING_CHANGED: passes full payload to setPostProcessing', () => {
    const payload = {
      bloomEnabled: true,
      bloomIntensity: 0.5,
      chromaticAberrationEnabled: false,
    };

    const result = handleMaterialEvent(
      'POST_PROCESSING_CHANGED',
      payload,
      mockSetGet.set,
      mockSetGet.get
    );

    expect(result).toBe(true);
    expect(actions.setPostProcessing).toHaveBeenCalledWith(payload);
  });

  it('SHADER_CHANGED with non-null data: calls setPrimaryShaderEffect', () => {
    const shaderData = {
      shaderType: 'custom',
      uniforms: { time: 0 },
    };
    const payload = { data: shaderData };

    const result = handleMaterialEvent(
      'SHADER_CHANGED',
      payload,
      mockSetGet.set,
      mockSetGet.get
    );

    expect(result).toBe(true);
    expect(actions.setPrimaryShaderEffect).toHaveBeenCalledWith(shaderData);
  });

  it('SHADER_CHANGED with null data: calls setPrimaryShaderEffect(null)', () => {
    const payload = { data: null };

    const result = handleMaterialEvent(
      'SHADER_CHANGED',
      payload,
      mockSetGet.set,
      mockSetGet.get
    );

    expect(result).toBe(true);
    expect(actions.setPrimaryShaderEffect).toHaveBeenCalledWith(null);
  });

  it('TERRAIN_CHANGED: calls setTerrainData with entityId and terrainData', () => {
    const payload = {
      entityId: 'terrain-789',
      terrainData: {
        resolution: 64,
        scale: 100,
        heightScale: 20,
      },
    };

    const result = handleMaterialEvent(
      'TERRAIN_CHANGED',
      payload,
      mockSetGet.set,
      mockSetGet.get
    );

    expect(result).toBe(true);
    expect(actions.setTerrainData).toHaveBeenCalledWith(
      'terrain-789',
      {
        resolution: 64,
        scale: 100,
        heightScale: 20,
      }
    );
  });

  it('QUALITY_CHANGED: calls setQualityFromEngine with full payload', () => {
    const payload = {
      msaa: 4,
      shadowsEnabled: true,
      bloomEnabled: true,
    };

    const result = handleMaterialEvent(
      'QUALITY_CHANGED',
      payload,
      mockSetGet.set,
      mockSetGet.get
    );

    expect(result).toBe(true);
    expect(actions.setQualityFromEngine).toHaveBeenCalledWith(payload);
  });

  it('CSG_COMPLETED: returns true', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const payload = {
      entityId: 'csg-123',
      name: 'CsgResult',
      operation: 'union',
    };

    const result = handleMaterialEvent(
      'CSG_COMPLETED',
      payload,
      mockSetGet.set,
      mockSetGet.get
    );

    expect(result).toBe(true);
    expect(consoleSpy).toHaveBeenCalledWith(
      'CSG union completed: CsgResult (csg-123)'
    );

    consoleSpy.mockRestore();
  });

  it('CSG_ERROR: logs error and returns true', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const payload = {
      message: 'Invalid mesh topology',
    };

    const result = handleMaterialEvent(
      'CSG_ERROR',
      payload,
      mockSetGet.set,
      mockSetGet.get
    );

    expect(result).toBe(true);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'CSG error: Invalid mesh topology'
    );

    consoleErrorSpy.mockRestore();
  });

  it('PROCEDURAL_MESH_CREATED: returns true', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const payload = {
      entityId: 'proc-456',
      name: 'ExtrudedMesh',
      operation: 'extrude',
    };

    const result = handleMaterialEvent(
      'PROCEDURAL_MESH_CREATED',
      payload,
      mockSetGet.set,
      mockSetGet.get
    );

    expect(result).toBe(true);
    expect(consoleSpy).toHaveBeenCalledWith(
      'Procedural mesh extrude completed: ExtrudedMesh (proc-456)'
    );

    consoleSpy.mockRestore();
  });

  it('PROCEDURAL_MESH_ERROR: logs error and returns true', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const payload = {
      message: 'Invalid path points',
    };

    const result = handleMaterialEvent(
      'PROCEDURAL_MESH_ERROR',
      payload,
      mockSetGet.set,
      mockSetGet.get
    );

    expect(result).toBe(true);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Procedural mesh error: Invalid path points'
    );

    consoleErrorSpy.mockRestore();
  });

  it('ARRAY_COMPLETED: returns true', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const payload = {
      count: 10,
    };

    const result = handleMaterialEvent(
      'ARRAY_COMPLETED',
      payload,
      mockSetGet.set,
      mockSetGet.get
    );

    expect(result).toBe(true);
    expect(consoleSpy).toHaveBeenCalledWith(
      'Array completed: 10 entities created'
    );

    consoleSpy.mockRestore();
  });

  it('SKYBOX_UPDATED: returns true (no-op)', () => {
    const result = handleMaterialEvent(
      'SKYBOX_UPDATED',
      {},
      mockSetGet.set,
      mockSetGet.get
    );

    expect(result).toBe(true);
  });
});
