import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * The manifest MUST resolve inside the deploy root.
 *
 * This previously pointed at `../../../mcp-server/manifest/commands.json` —
 * the repo-root copy. That path exists locally and does not exist on Vercel:
 * the `spawnforge-docs` project sets `rootDirectory: apps/docs`, so everything
 * above `apps/docs/` is absent from the build. The read threw, the catch below
 * swallowed it, and the page rendered zero commands with no error anywhere.
 *
 * `apps/docs/data/commands.json` is the in-root copy, and is already what the
 * build uses — `vercel.json` runs the page generator with
 * `MANIFEST_PATH=./data/commands.json`. Honouring the same env var here keeps
 * the generator and the runtime reader on one path instead of two that can
 * disagree. Kept in sync with the canonical `mcp-server/manifest/commands.json`
 * by `scripts/check-manifest-sync.ts`.
 */
const MANIFEST_PATH = process.env.MANIFEST_PATH
  ? path.resolve(process.env.MANIFEST_PATH)
  : path.resolve(__dirname, '../data/commands.json');

/**
 * `parameters` is a JSON Schema object in the manifest — `{ type: 'object',
 * properties: {...}, required: [...] }` — NOT the array of `{name, type}` this
 * interface previously declared. Nothing read the field, so the wrong shape was
 * never caught. `readCommandsByCategory` renders parameters, so it is typed to
 * what `data/commands.json` actually contains.
 */
export interface CommandParameterSchema {
  type?: string;
  description?: string;
  enum?: unknown[];
  items?: { type?: string };
}

export interface CommandEntry {
  name: string;
  category: string;
  visibility?: string;
  description?: string;
  tokenCost?: number;
  requiredScope?: string;
  parameters?: {
    type?: string;
    properties?: Record<string, CommandParameterSchema>;
    required?: string[];
  };
}

interface CommandsManifest {
  commands: CommandEntry[];
}

/**
 * A single command's parameter, flattened from the JSON Schema `properties` map
 * into the row shape the category page renders.
 */
export interface CommandParameter {
  name: string;
  type: string;
  required: boolean;
  description?: string;
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
  const publicCommands = readPublicCommands();

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

/**
 * Every public command in one category, sorted by name.
 *
 * Backs `/mcp/[category]`, the destination of the category tiles on `/mcp`.
 * Those tiles are keyed by CATEGORY; the MDX the build generates is keyed by
 * COMMAND NAME (`scripts/generate-mcp-docs.ts` writes `${cmd.name}.mdx`), so
 * there is no generated per-category document for the tiles to point at and no
 * amount of MDX wiring would produce one. The category index is therefore
 * rendered from this manifest, the same source `/mcp` already counts from.
 *
 * Returns an empty array for an unknown category — the page turns that into a
 * 404 via `notFound()` rather than rendering an empty shell.
 */
export async function readCommandsByCategory(category: string): Promise<CommandEntry[]> {
  return readPublicCommands()
    .filter((cmd) => cmd.category === category)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Flatten a command's JSON Schema `parameters` into display rows, required
 * parameters first and each group alphabetised. A command with no parameters
 * (or a malformed `parameters` with no `properties`) yields an empty array.
 */
export function toParameterList(cmd: CommandEntry): CommandParameter[] {
  const properties = cmd.parameters?.properties ?? {};
  const required = new Set(cmd.parameters?.required ?? []);

  return Object.entries(properties)
    .map(([name, schema]) => ({
      name,
      type: schema?.type ?? 'unknown',
      required: required.has(name),
      description: schema?.description,
    }))
    .sort((a, b) => {
      if (a.required !== b.required) return a.required ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

/** Read the manifest and keep only the publicly documented commands. */
function readPublicCommands(): CommandEntry[] {
  const manifest = loadManifest();
  return (manifest.commands ?? []).filter((cmd) => cmd.visibility === 'public');
}

function loadManifest(): CommandsManifest {
  try {
    const raw = fs.readFileSync(MANIFEST_PATH, 'utf-8');
    return JSON.parse(raw) as CommandsManifest;
  } catch (cause) {
    // Deliberately fatal. The previous `catch { return zeros }` is the reason
    // the broken manifest path shipped unnoticed: an unreachable manifest and
    // a genuinely empty one were indistinguishable, so the docs site rendered
    // "0 commands" as though that were a valid answer. There is no such thing
    // as a correct SpawnForge docs page with no commands in it, so a visible
    // failure beats a page that quietly lies.
    //
    // This throw is the LAST line of defence, not the gate. `app/layout.tsx`
    // sets `dynamic = 'force-dynamic'`, so this runs per request and a throw
    // here is a 500 for a reader, not a red build. The actual build-time gate
    // is `scripts/generate-mcp-docs.ts`, which reads this same manifest (same
    // MANIFEST_PATH) in `vercel.json`'s buildCommand and exits 1 when it is
    // unreadable — so in practice a broken manifest fails the deploy and
    // never reaches this line.
    throw new Error(
      `Cannot read the MCP commands manifest at ${MANIFEST_PATH}. ` +
        `It must exist inside the deploy root (rootDirectory: apps/docs) — a ` +
        `path above apps/docs/ resolves locally but not on Vercel. ` +
        `Run scripts/check-manifest-sync.ts to verify the in-root copy.`,
      { cause },
    );
  }
}
