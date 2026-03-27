import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = path.resolve(__dirname, '../../../mcp-server/manifest/commands.json');

interface CommandEntry {
  name: string;
  category: string;
  visibility?: string;
  description?: string;
  parameters?: Array<{
    name: string;
    type: string;
    required?: boolean;
    description?: string;
  }>;
}

interface CommandsManifest {
  commands: CommandEntry[];
}

/**
 * Read the MCP commands manifest and extract metadata for the docs site.
 * Only public commands are counted/categorised — internal commands are excluded.
 */
export async function readCommandsManifest(): Promise<{
  categories: string[];
  scopes: string[];
  publicCount: number;
}> {
  let manifest: CommandsManifest;
  try {
    const raw = fs.readFileSync(MANIFEST_PATH, 'utf-8');
    manifest = JSON.parse(raw) as CommandsManifest;
  } catch {
    return { categories: [], scopes: [], publicCount: 0 };
  }

  const publicCommands = (manifest.commands ?? []).filter(
    (cmd) => cmd.visibility === 'public',
  );

  const categorySet = new Set<string>();
  for (const cmd of publicCommands) {
    if (cmd.category) {
      categorySet.add(cmd.category);
    }
  }

  // Scopes are derived from command names that follow "namespace:action" patterns.
  // We extract unique namespace prefixes as scope groups.
  const scopeSet = new Set<string>();
  for (const cmd of publicCommands) {
    const match = cmd.name.match(/^([a-z_]+)_/);
    if (match) {
      // Normalise to the verb/domain prefix (e.g. "create", "query", "set")
      scopeSet.add(match[1]);
    }
  }

  return {
    categories: [...categorySet],
    scopes: [...scopeSet],
    publicCount: publicCommands.length,
  };
}
