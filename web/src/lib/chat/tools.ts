import manifestJson from '../../../../mcp-server/manifest/commands.json';

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
 * Generate Claude tool definitions from the command manifest.
 * Filters to only scene-editing tools (not query tools — those are handled via context).
 */
export function getChatTools(): ClaudeTool[] {
  return manifest.commands
    .filter((cmd) => cmd.requiredScope.endsWith(':write') || cmd.category === 'query')
    .map((cmd) => ({
      name: cmd.name,
      description: cmd.description,
      input_schema: {
        type: cmd.parameters.type || 'object',
        properties: cmd.parameters.properties || {},
        required: cmd.parameters.required || [],
      },
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
