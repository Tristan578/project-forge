import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import manifest from '../../manifest/commands.json' with { type: 'json' };
import type { EditorBridge } from '../transport/websocket.js';

/**
 * Convert JSON Schema property to a Zod schema.
 * Handles the subset of JSON Schema used in our manifest.
 */
export function jsonSchemaToZod(prop: Record<string, unknown>): z.ZodTypeAny {
  const type = prop.type as string;

  switch (type) {
    case 'string': {
      if (prop.enum) {
        return z.enum(prop.enum as [string, ...string[]]);
      }
      return z.string();
    }
    case 'number':
      return z.number();
    case 'integer':
      return z.number().int();
    case 'boolean':
      return z.boolean();
    case 'array': {
      const items = prop.items as Record<string, unknown> | undefined;
      if (items) {
        return z.array(jsonSchemaToZod(items));
      }
      return z.array(z.unknown());
    }
    case 'object':
      return z.record(z.string(), z.unknown());
    default:
      return z.unknown();
  }
}

/**
 * Build a Zod object schema from JSON Schema properties definition.
 */
export function buildZodSchema(
  parameters: { properties?: Record<string, Record<string, unknown>>; required?: string[] }
): Record<string, z.ZodTypeAny> {
  const shape: Record<string, z.ZodTypeAny> = {};
  const props = parameters.properties ?? {};
  const required = new Set(parameters.required ?? []);

  for (const [key, prop] of Object.entries(props)) {
    let fieldSchema = jsonSchemaToZod(prop);
    if (!required.has(key)) {
      fieldSchema = fieldSchema.optional();
    }
    if (prop.description) {
      fieldSchema = fieldSchema.describe(prop.description as string);
    }
    shape[key] = fieldSchema;
  }

  return shape;
}

/**
 * Derive MCP tool annotations from the command's requiredScope.
 * Read-only scopes get readOnlyHint; write/manage scopes get destructiveHint
 * for operations that modify or delete scene state.
 */
export function deriveAnnotations(
  scope: string,
  name: string,
): ToolAnnotations {
  const isRead = scope.endsWith(':read');
  const isDestructive = name.startsWith('despawn_') ||
    name.startsWith('delete_') ||
    name.startsWith('remove_') ||
    name === 'clear_scene' ||
    name === 'undo' ||
    name === 'redo';

  return {
    readOnlyHint: isRead,
    destructiveHint: isDestructive,
    openWorldHint: false,
  };
}

/**
 * Register all commands from the manifest as MCP tools.
 *
 * Uses the registerTool API (non-deprecated) with annotations derived
 * from each command's requiredScope for better tool discovery by LLM clients.
 */
export function registerTools(server: McpServer, bridge: EditorBridge): void {
  for (const cmd of manifest.commands) {
    const inputSchema = buildZodSchema(cmd.parameters as unknown as {
      properties?: Record<string, Record<string, unknown>>;
      required?: string[];
    });

    const annotations = deriveAnnotations(
      cmd.requiredScope,
      cmd.name,
    );

    server.registerTool(
      cmd.name,
      {
        description: cmd.description,
        inputSchema,
        annotations,
      },
      async (args) => {
        try {
          const result = await bridge.executeCommand(cmd.name, args as Record<string, unknown>);
          return {
            content: [
              {
                type: 'text' as const,
                text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
              },
            ],
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: 'text' as const, text: `Error: ${message}` }],
            isError: true,
          };
        }
      },
    );
  }
}
