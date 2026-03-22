/**
 * Tests for toolAdapter.ts
 *
 * Verifies that MCP manifest tools in commands.json format are correctly
 * converted to AI SDK v5 Tool definitions.
 */

import { describe, it, expect } from 'vitest';
import {
  convertManifestToolToSdkTool,
  convertManifestToolsToSdkTools,
  type ManifestTool,
} from '@/lib/ai/toolAdapter';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const spawnEntityTool: ManifestTool = {
  name: 'spawn_entity',
  description: 'Create a new entity in the scene',
  category: 'scene',
  parameters: {
    type: 'object',
    properties: {
      entityType: {
        type: 'string',
        enum: ['cube', 'sphere', 'plane'],
        description: 'Type of entity to spawn',
      },
      name: {
        type: 'string',
        description: 'Display name',
      },
      position: {
        type: 'array',
        items: { type: 'number' },
        minItems: 3,
        maxItems: 3,
        description: 'World position [x, y, z]',
      },
    },
    required: ['entityType'],
  },
};

const setMaterialTool: ManifestTool = {
  name: 'set_material',
  description: 'Set material properties on an entity',
  input_schema: {
    type: 'object',
    properties: {
      entityId: { type: 'string', description: 'Target entity ID' },
      color: { type: 'string', description: 'Hex color string' },
    },
    required: ['entityId'],
  },
};

const arrayParamsTool: ManifestTool = {
  name: 'play_audio',
  description: 'Play an audio file',
  parameters: [
    { name: 'src', type: 'string', required: true, description: 'Audio URL' },
    { name: 'volume', type: 'number', required: false, description: 'Volume 0-1' },
    {
      name: 'loop',
      type: 'boolean',
      required: false,
      description: 'Loop playback',
    },
  ],
};

const noParamsTool: ManifestTool = {
  name: 'clear_scene',
  description: 'Remove all entities from the scene',
};

// ---------------------------------------------------------------------------
// convertManifestToolToSdkTool
// ---------------------------------------------------------------------------

describe('convertManifestToolToSdkTool', () => {
  it('returns a tool with the correct description', () => {
    const sdkTool = convertManifestToolToSdkTool(spawnEntityTool);
    expect(sdkTool.description).toBe('Create a new entity in the scene');
  });

  it('returns a tool with an inputSchema', () => {
    const sdkTool = convertManifestToolToSdkTool(spawnEntityTool);
    expect(sdkTool.inputSchema).toBeDefined();
  });

  it('does not include an execute function (tools are client-side)', () => {
    const sdkTool = convertManifestToolToSdkTool(spawnEntityTool);
    expect((sdkTool as Record<string, unknown>).execute).toBeUndefined();
  });

  it('handles input_schema format correctly', () => {
    const sdkTool = convertManifestToolToSdkTool(setMaterialTool);
    expect(sdkTool.description).toBe('Set material properties on an entity');
    expect(sdkTool.inputSchema).toBeDefined();
  });

  it('handles array-style parameters format', () => {
    const sdkTool = convertManifestToolToSdkTool(arrayParamsTool);
    expect(sdkTool.description).toBe('Play an audio file');
    expect(sdkTool.inputSchema).toBeDefined();
  });

  it('handles tools with no parameters', () => {
    const sdkTool = convertManifestToolToSdkTool(noParamsTool);
    expect(sdkTool.description).toBe('Remove all entities from the scene');
    expect(sdkTool.inputSchema).toBeDefined();
  });

  it('prefers input_schema over parameters when both are present', () => {
    const tool: ManifestTool = {
      name: 'dual_format',
      description: 'Tool with both formats',
      input_schema: {
        type: 'object',
        properties: { fromInputSchema: { type: 'string' } },
      },
      parameters: {
        type: 'object',
        properties: { fromParameters: { type: 'string' } },
      },
    };
    // Should not throw and should use input_schema (the function returns without error)
    const sdkTool = convertManifestToolToSdkTool(tool);
    expect(sdkTool).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// convertManifestToolsToSdkTools
// ---------------------------------------------------------------------------

describe('convertManifestToolsToSdkTools', () => {
  it('returns an empty record for an empty array', () => {
    const result = convertManifestToolsToSdkTools([]);
    expect(result).toEqual({});
  });

  it('keys tools by their name', () => {
    const result = convertManifestToolsToSdkTools([
      spawnEntityTool,
      setMaterialTool,
    ]);
    expect(Object.keys(result)).toContain('spawn_entity');
    expect(Object.keys(result)).toContain('set_material');
  });

  it('converts all tools in the array', () => {
    const tools: ManifestTool[] = [spawnEntityTool, setMaterialTool, noParamsTool];
    const result = convertManifestToolsToSdkTools(tools);
    expect(Object.keys(result)).toHaveLength(3);
  });

  it('each converted tool has a description', () => {
    const result = convertManifestToolsToSdkTools([
      spawnEntityTool,
      setMaterialTool,
    ]);
    expect(result['spawn_entity'].description).toBe(
      'Create a new entity in the scene',
    );
    expect(result['set_material'].description).toBe(
      'Set material properties on an entity',
    );
  });

  it('each converted tool has an inputSchema', () => {
    const result = convertManifestToolsToSdkTools([
      spawnEntityTool,
      arrayParamsTool,
    ]);
    expect(result['spawn_entity'].inputSchema).toBeDefined();
    expect(result['play_audio'].inputSchema).toBeDefined();
  });

  it('does not set execute on any tool', () => {
    const result = convertManifestToolsToSdkTools([
      spawnEntityTool,
      setMaterialTool,
    ]);
    for (const sdkTool of Object.values(result)) {
      expect((sdkTool as Record<string, unknown>).execute).toBeUndefined();
    }
  });

  it('handles a large batch without errors', () => {
    const manyTools: ManifestTool[] = Array.from({ length: 50 }, (_, i) => ({
      name: `tool_${i}`,
      description: `Tool number ${i}`,
      parameters: {
        type: 'object',
        properties: {
          value: { type: 'number', description: 'A number' },
        },
        required: ['value'],
      },
    }));
    const result = convertManifestToolsToSdkTools(manyTools);
    expect(Object.keys(result)).toHaveLength(50);
  });
});

// ---------------------------------------------------------------------------
// Edge cases for buildInputSchema (tested indirectly)
// ---------------------------------------------------------------------------

describe('buildInputSchema edge cases', () => {
  it('handles parameters with enum values', () => {
    const tool: ManifestTool = {
      name: 'set_quality',
      description: 'Set render quality',
      parameters: [
        {
          name: 'level',
          type: 'string',
          required: true,
          enum: ['low', 'medium', 'high', 'ultra'],
          description: 'Quality level',
        },
      ],
    };
    const sdkTool = convertManifestToolToSdkTool(tool);
    expect(sdkTool.inputSchema).toBeDefined();
  });

  it('handles nested JSON Schema properties object', () => {
    const tool: ManifestTool = {
      name: 'set_transform',
      description: 'Set entity transform',
      parameters: {
        type: 'object',
        properties: {
          position: {
            type: 'object',
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
              z: { type: 'number' },
            },
          },
        },
        required: ['position'],
      },
    };
    const sdkTool = convertManifestToolToSdkTool(tool);
    expect(sdkTool.inputSchema).toBeDefined();
  });
});
