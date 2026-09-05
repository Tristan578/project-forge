import manifest from '../data/commands.json';

/**
 * The manifest is a STATIC IMPORT, deliberately.
 *
 * Two loaders preceded this one and both were wrong in the same direction:
 * they built a path at runtime and read it with `fs.readFileSync`. The first
 * pointed above the deploy root (`../../../mcp-server/manifest/commands.json`)
 * and threw on Vercel, where `rootDirectory: apps/docs` leaves nothing above
 * `apps/docs/` in the build. The second (#9065) pointed at the in-root copy —
 * `apps/docs/data/commands.json` — which exists at build time and STILL threw
 * in production: Next.js output file tracing bundles only the files it can see
 * as module edges, and a path assembled from `__dirname` or an env var is not
 * one. The JSON never reached `/var/task`, every request to `/mcp` 500'd, and
 * the unit test could not tell because it had mocked `fs` (#9718).
 *
 * An import is a module edge. The bundler owns the dependency, includes it in
 * the server function, and a missing file is a build failure instead of a
 * runtime 500. `lib/__tests__/commandsManifestArtifact.test.ts` pins this shape
 * and exercises the real file; `scripts/post-deploy-docs-check.sh` verifies
 * the deployed page in `cd.yml`.
 *
 * The build-time generator (`scripts/generate-mcp-docs.ts`, run from
 * `vercel.json` with `MANIFEST_PATH=./data/commands.json`) still reads the
 * file by path — it is a script, not traced code, and that is fine. The in-root
 * copy is kept identical to the canonical `mcp-server/manifest/commands.json`
 * by `scripts/check-manifest-sync.ts`.
 */

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

export interface CommandsManifest {
  commands?: CommandEntry[];
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

export interface ManifestSummary {
  categories: string[];
  scopes: string[];
  publicCount: number;
}

/**
 * The manifest the site ships. Typed through the interface rather than the
 * inferred literal type of a 350-command JSON file: the inferred type is a
 * union over every command's exact `properties` key set (each key `undefined`
 * on the commands that lack it), which is not comparable to the index
 * signature above, is slow to check, and is brittle to a single new optional
 * field in one command. The `unknown` hop is the documented way to say so.
 */
const SHIPPED_MANIFEST = manifest as unknown as CommandsManifest;

/** Keep only the publicly documented commands of a manifest. */
export function publicCommandsOf(source: CommandsManifest): CommandEntry[] {
  return (source.commands ?? []).filter((cmd) => cmd.visibility === 'public');
}

/**
 * Summarise a manifest for the `/mcp` index: the public categories, the scope
 * prefixes, and the public command count. Pure — takes the manifest as an
 * argument so the logic can be tested against fixtures without touching the
 * shipped file, which `commandsManifestArtifact.test.ts` covers separately.
 */
export function summarizeManifest(source: CommandsManifest): ManifestSummary {
  const publicCommands = publicCommandsOf(source);

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
 * Every public command of a manifest in one category, sorted by name. Pure,
 * for the same reason as `summarizeManifest`.
 */
export function commandsInCategory(source: CommandsManifest, category: string): CommandEntry[] {
  return publicCommandsOf(source)
    .filter((cmd) => cmd.category === category)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Read the MCP commands manifest and extract metadata for the docs site.
 * Only public commands are counted/categorised — internal commands are excluded.
 */
export async function readCommandsManifest(): Promise<ManifestSummary> {
  return summarizeManifest(SHIPPED_MANIFEST);
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
  return commandsInCategory(SHIPPED_MANIFEST, category);
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
