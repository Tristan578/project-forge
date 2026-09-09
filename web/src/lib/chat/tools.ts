/**
 * Anthropic tool definitions for the AI chat API.
 *
 * Sourced from mcp-server/manifest/commands.json via web/src/data/commands.json.
 * Only public-visibility commands are exposed. Run `npm run check:manifest-sync`
 * from the repo root to verify both copies are identical.
 */

// Sourced from mcp-server/manifest/commands.json — keep in sync when adding MCP commands
import manifestJson from '@/data/commands.json';
import { modelToolSchema } from '@/lib/ai/modelToolSchema';
import { isCommandAvailable } from '@/lib/config/providers';

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
 *
 * Schemas go through `modelToolSchema`, which withholds the manifest parameters
 * that are meaningful only to a direct-to-engine MCP client. That filter is shared
 * with `spawnforgeAgent.getAgentTools()` — applying it to one tool surface and not
 * the other leaves the parameter on offer.
 */
export function getChatTools(): ClaudeTool[] {
  return manifest.commands
    .filter((cmd) => cmd.requiredScope.endsWith(':write') || cmd.category === 'query')
    // #9117: never offer a tool whose capability is declared unavailable — the
    // model would call it and the route would refuse it, every time.
    .filter((cmd) => isCommandAvailable(cmd.name))
    .map((cmd) => ({
      name: cmd.name,
      description: cmd.description,
      input_schema: modelToolSchema(cmd.name, cmd.parameters),
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
