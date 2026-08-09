/**
 * Anthropic tool definitions for the AI chat API.
 *
 * Sourced from mcp-server/manifest/commands.json via web/src/data/commands.json.
 * Only public-visibility commands are exposed. Run `npm run check:manifest-sync`
 * to verify both copies are identical.
 */

// Sourced from mcp-server/manifest/commands.json — keep in sync when adding MCP commands
import manifestJson from '@/data/commands.json';

interface ManifestCommand {
  name: string;
  description: string;
  category: string;
  parameters: {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
  tokenCost: number;
  requiredScope: string;
}

interface ClaudeTool {
  name: string;
  description: string;
  input_schema: {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

const manifest = manifestJson as { version: string; commands: ManifestCommand[] };

/**
 * Manifest parameters that are real for a direct-to-engine MCP client but must not
 * be offered to the model.
 *
 * `spawn_entity.id` is the only entry today, and it is the reason this seam exists:
 * an MCP client driving the engine directly has a legitimate use for supplying its
 * own entity id, but the chat path does not — `sceneGraphSlice.spawnEntity` mints
 * the id itself and returns it synchronously, so a model-supplied id buys nothing.
 * Worse, the engine's `is_valid_override_id` validates only length and control
 * characters; an id that collides with an existing entity is accepted, and every
 * id-matching loop in the engine then addresses the wrong entity.
 */
const EXCLUDED_TOOL_PROPERTIES: Record<string, readonly string[]> = {
  spawn_entity: ['id'],
};

/** Strip the excluded properties from a command's schema without mutating the manifest. */
function toolSchemaFor(cmd: ManifestCommand): ClaudeTool['input_schema'] {
  const excluded = EXCLUDED_TOOL_PROPERTIES[cmd.name];
  const properties = cmd.parameters.properties || {};
  const required = cmd.parameters.required || [];
  return {
    type: cmd.parameters.type || 'object',
    properties: excluded
      ? Object.fromEntries(Object.entries(properties).filter(([key]) => !excluded.includes(key)))
      : properties,
    required: excluded ? required.filter((key) => !excluded.includes(key)) : required,
  };
}

/**
 * Generate Claude tool definitions from the command manifest.
 * Filters to only scene-editing tools (not query tools — those are handled via context).
 */
export function getChatTools(): ClaudeTool[] {
  return manifest.commands
    .filter((cmd) => cmd.requiredScope.endsWith(':write') || cmd.category === 'query')
    .map((cmd) => ({
      name: cmd.name,
      description: cmd.description,
      input_schema: toolSchemaFor(cmd),
    }));
}

/**
 * Get all command names from the manifest.
 */
export function getCommandNames(): string[] {
  return manifest.commands.map((cmd) => cmd.name);
}

/**
 * Look up a command definition by name.
 */
export function getCommandDef(name: string): ManifestCommand | undefined {
  return manifest.commands.find((cmd) => cmd.name === name);
}
