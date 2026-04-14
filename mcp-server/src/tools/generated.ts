import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import manifest from '../../manifest/commands.json' with { type: 'json' };
import type { EditorBridge } from '../transport/websocket.js';

/**
 * Convert JSON Schema property to a Zod schema.
 * Handles the subset of JSON Schema used in our manifest.
 */
function jsonSchemaToZod(prop: Record<string, unknown>): z.ZodTypeAny {
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
function buildZodSchema(
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

// Size of each registration batch. Yields the event loop between batches
// so that startup doesn't block for the full manifest.
const BATCH_SIZE = 50;

/**
 * Register a single command as an MCP tool.
 */
function registerCommand(
  server: McpServer,
  bridge: EditorBridge,
  cmd: (typeof manifest.commands)[number],
): void {
  const zodShape = buildZodSchema(cmd.parameters as unknown as {
    properties?: Record<string, Record<string, unknown>>;
    required?: string[];
  });

  server.registerTool(
    cmd.name,
    {
      description: cmd.description,
      inputSchema: zodShape,
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
    }
  );
}

/**
 * Register all commands from the manifest as MCP tools.
 *
 * Registers in batches of {@link BATCH_SIZE}, yielding the event loop between
 * batches so that large manifests (350+ commands) don't block startup.
 *
 * Returns a Promise that resolves when all tools are registered.
 */
export async function registerTools(server: McpServer, bridge: EditorBridge): Promise<void> {
  const commands = manifest.commands;

  // Small manifests: register synchronously (no overhead)
  if (commands.length <= BATCH_SIZE) {
    for (const cmd of commands) {
      registerCommand(server, bridge, cmd);
    }
    return;
  }

  // Large manifests: register in batches, yielding between each
  for (let i = 0; i < commands.length; i += BATCH_SIZE) {
    const batch = commands.slice(i, i + BATCH_SIZE);
    for (const cmd of batch) {
      registerCommand(server, bridge, cmd);
    }

    // Yield to the event loop between batches
    if (i + BATCH_SIZE < commands.length) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }
}
