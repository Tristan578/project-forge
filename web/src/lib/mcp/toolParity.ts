/**
 * MCP tool-parity guard.
 *
 * The chat agent builds its tool schemas from the bundled `@/data/commands.json`
 * (a copy of `mcp-server/manifest/commands.json`, kept identical at the file
 * level by `apps/docs/scripts/check-manifest-sync.ts`). The MCP server registers
 * one tool per `commands[].name`, so the set of tool names the *live* server
 * serves must equal the set of command names the web bundle ships.
 *
 * `check-manifest-sync.ts` compares the two committed JSON files. This guard
 * compares the bundled manifest against what a *running* server actually serves
 * — catching drift the file-to-file check cannot (e.g. a server deployed from a
 * newer/older manifest than the web bundle baked in). It is the foundation for a
 * future cutover that would derive the tool surface from MCP directly; until
 * then it is a safety net, not a hot-path dependency.
 *
 * See `./client` and `docs/decisions/2026-06-23-mcp-client-tool-source.md`.
 */

import manifestJson from '@/data/commands.json';

interface ManifestCommand {
  name: string;
}

const manifest = manifestJson as { commands: ManifestCommand[] };

/** Minimal structural shape of an MCP client we need here — `tools()` only. */
export interface ToolListingClient {
  tools(): Promise<Record<string, unknown>>;
}

/** All command names the web bundle ships, sorted. */
export function getManifestToolNames(): string[] {
  return manifest.commands.map((c) => c.name).sort();
}

/** Tool names a live MCP client reports, sorted. */
export async function fetchServerToolNames(client: ToolListingClient): Promise<string[]> {
  const tools = await client.tools();
  return Object.keys(tools).sort();
}

export interface ToolParityResult {
  inSync: boolean;
  /** Commands in the web bundle that the live server does NOT serve. */
  onlyInManifest: string[];
  /** Tools the live server serves that are NOT in the web bundle. */
  onlyInServer: string[];
}

/**
 * Compare two tool-name sets. Pure — both inputs are plain string arrays so this
 * is trivially unit-testable without a live server.
 */
export function compareToolSets(
  manifestNames: readonly string[],
  serverNames: readonly string[],
): ToolParityResult {
  const manifestSet = new Set(manifestNames);
  const serverSet = new Set(serverNames);
  const onlyInManifest = [...manifestSet].filter((n) => !serverSet.has(n)).sort();
  const onlyInServer = [...serverSet].filter((n) => !manifestSet.has(n)).sort();
  return {
    inSync: onlyInManifest.length === 0 && onlyInServer.length === 0,
    onlyInManifest,
    onlyInServer,
  };
}

/** Fetch the live tool set and compare it against the bundled manifest. */
export async function checkToolParity(client: ToolListingClient): Promise<ToolParityResult> {
  const serverNames = await fetchServerToolNames(client);
  return compareToolSets(getManifestToolNames(), serverNames);
}

/** Human-readable summary of a parity result, for logs / CI output. */
export function formatToolParity(result: ToolParityResult): string {
  if (result.inSync) {
    return `MCP tool parity OK — ${getManifestToolNames().length} tools match the live server.`;
  }
  const lines = ['MCP tool parity DRIFT:'];
  if (result.onlyInManifest.length > 0) {
    lines.push(`  in web bundle but NOT served by the server: ${result.onlyInManifest.join(', ')}`);
  }
  if (result.onlyInServer.length > 0) {
    lines.push(`  served by the server but NOT in web bundle: ${result.onlyInServer.join(', ')}`);
  }
  return lines.join('\n');
}
