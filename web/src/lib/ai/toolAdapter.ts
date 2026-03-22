/**
 * toolAdapter — converts MCP command manifest tools to AI SDK v5 tool definitions.
 *
 * Commands in commands.json use Anthropic-style `{ input_schema }` JSON Schema objects.
 * The AI SDK v5 `tool()` function expects `{ description, inputSchema }` where
 * `inputSchema` is a `FlexibleSchema` (JSON Schema via `jsonSchema()` or Zod).
 *
 * This module bridges the two formats without modifying the manifest.
 *
 * Tools returned here have no `execute` function — execution happens client-side
 * in the browser (WASM engine commands). The model receives tool definitions and
 * returns tool calls that the client dispatches.
 */

import { tool, jsonSchema } from 'ai';
import type { Tool } from '@ai-sdk/provider-utils';
import type { JSONSchema7 } from '@ai-sdk/provider';

// ---------------------------------------------------------------------------
// Manifest types (matching commands.json structure)
// ---------------------------------------------------------------------------

export interface ManifestParameter {
  name: string;
  type: string;
  required?: boolean;
  description?: string;
  default?: unknown;
  enum?: string[];
}

export interface ManifestTool {
  name: string;
  description: string;
  category?: string;
  parameters?: {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
    [key: string]: unknown;
  } | ManifestParameter[];
  input_schema?: {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
    [key: string]: unknown;
  };
}

// ---------------------------------------------------------------------------
// Convert a single manifest tool to an AI SDK v5 Tool
// ---------------------------------------------------------------------------

/**
 * Build a JSON Schema object from a manifest tool's parameter definitions.
 *
 * Manifest tools can specify parameters in two ways:
 * 1. `input_schema` — a raw JSON Schema object (preferred, used by newer commands)
 * 2. `parameters` — either a JSON Schema object or an array of parameter objects
 */
function buildInputSchema(manifestTool: ManifestTool): JSONSchema7 {
  // Prefer explicit input_schema if present
  if (manifestTool.input_schema) {
    return manifestTool.input_schema as JSONSchema7;
  }

  const params = manifestTool.parameters;

  if (!params) {
    return { type: 'object', properties: {}, required: [] };
  }

  // If it's already a JSON Schema object (has 'type' property)
  if (!Array.isArray(params) && typeof params === 'object' && 'type' in params) {
    return params as JSONSchema7;
  }

  // Convert array-style parameter list to JSON Schema
  if (Array.isArray(params)) {
    const properties: Record<string, JSONSchema7> = {};
    const required: string[] = [];

    for (const param of params) {
      const prop: JSONSchema7 = {
        type: param.type as JSONSchema7['type'],
      };
      if (param.description) prop.description = param.description;
      // Note: param.default is typed as unknown; omit from JSONSchema7 to avoid type widening.
      // The AI model uses the description to understand expected values.
      if (param.enum) prop.enum = param.enum;

      properties[param.name] = prop;
      if (param.required) required.push(param.name);
    }

    return { type: 'object', properties, required };
  }

  return { type: 'object', properties: {}, required: [] };
}

/**
 * Convert a single manifest tool definition to an AI SDK v5 `Tool`.
 * The returned tool has no `execute` function — tools are forwarded to the
 * client for execution against the WASM engine.
 */
export function convertManifestToolToSdkTool(manifestTool: ManifestTool): Tool {
  const schema = buildInputSchema(manifestTool);
  return tool({
    description: manifestTool.description,
    inputSchema: jsonSchema(schema),
  });
}

// ---------------------------------------------------------------------------
// Batch conversion
// ---------------------------------------------------------------------------

/**
 * Convert an array of manifest tool definitions to a `Record<string, Tool>`
 * compatible with AI SDK v5's `tools` parameter in `streamText()`.
 *
 * @param manifestTools - Array of tool objects from commands.json
 * @returns A tool record keyed by command name
 */
export function convertManifestToolsToSdkTools(
  manifestTools: ManifestTool[],
): Record<string, Tool> {
  const result: Record<string, Tool> = {};
  for (const manifestTool of manifestTools) {
    result[manifestTool.name] = convertManifestToolToSdkTool(manifestTool);
  }
  return result;
}
