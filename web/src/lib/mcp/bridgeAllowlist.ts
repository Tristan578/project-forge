/**
 * Which manifest commands the editor-side MCP bridge will execute (#9293).
 *
 * This is an ALLOWLIST, and the direction matters. The first version named the
 * categories to refuse and allowed the rest, so it permitted 308 of the 351
 * manifest commands — including all of `scripting`, whose `source` argument
 * reaches `Function(...)` in web/src/lib/scripting/scriptWorker.ts. Read SEC-2
 * in the root CLAUDE.md: that sandbox is defence in depth, explicitly NOT a
 * security boundary, and it has a documented live escape (#8700). Handing a
 * remote agent the ability to author scripts is handing it the escape.
 *
 * A deny-list also fails OPEN. Every command added to the manifest from now on
 * would have been reachable over the bridge the moment it merged, with nobody
 * deciding that. Naming what is permitted inverts that: an unlisted category is
 * refused, and `bridgeCategoryPartition()` makes the omission visible in the
 * suite instead of shipping silently.
 */
import manifestJson from '@/data/commands.json';

interface ManifestCommand {
  name: string;
  category: string;
  requiredScope: string;
}

/**
 * Categories a remote agent may drive: scene authoring and inspection, all of
 * which stays inside the open project in this tab.
 */
export const BRIDGE_ALLOWED_CATEGORIES: ReadonlySet<string> = new Set([
  'animation',
  'asset',
  'audio',
  'camera',
  'compound',
  'cutscene',
  'dialogue',
  'docs',
  'editor',
  'environment',
  'game_cameras',
  'game_components',
  'history',
  'lighting',
  'localization',
  'materials',
  'mesh',
  'modeling',
  'particles',
  'performance',
  'physics2d',
  'prefab',
  'query',
  'rendering',
  'runtime',
  'scene',
  'shaders',
  'skeleton2d',
  'sprite',
  'sprite_animation',
  'templates',
  'terrain',
  'tilemap',
  'ui',
  'world_building',
]);

/**
 * Categories deliberately withheld, and why. Listed rather than merely omitted
 * so that a category disappearing from the manifest, or a new one arriving, is
 * a test failure and a decision — not a silent change of what a remote agent
 * can do.
 */
export const BRIDGE_DENIED_CATEGORIES: ReadonlyMap<string, string> = new Map([
  ['scripting', 'authors code that the script worker compiles with Function() — see SEC-2'],
  ['generation', 'spends generation tokens'],
  ['export', 'moves the project out of the tab'],
  ['publishing', 'makes the project visible to other people'],
  ['security', 'changes the project security posture'],
  ['economy', 'touches the token economy'],
]);

/** Scopes withheld regardless of category, for the same reasons. */
const DENIED_SCOPES = new Set(['ai:generate', 'project:manage']);

const commands = new Map<string, ManifestCommand>(
  (manifestJson as { commands: ManifestCommand[] }).commands.map((c) => [c.name, c]),
);

export interface BridgeVerdict {
  allowed: boolean;
  reason?: string;
}

/**
 * Category decision on its own, so a category the manifest does not yet carry
 * can be driven straight through the fail-closed path.
 */
export function bridgeCategoryVerdict(category: string): BridgeVerdict {
  const denied = BRIDGE_DENIED_CATEGORIES.get(category);
  if (denied) return { allowed: false, reason: `${category} ${denied}` };
  if (!BRIDGE_ALLOWED_CATEGORIES.has(category)) {
    return { allowed: false, reason: `${category} is not on the MCP bridge allowlist` };
  }
  return { allowed: true };
}

export function bridgeVerdict(name: string): BridgeVerdict {
  const cmd = commands.get(name);
  if (!cmd) return { allowed: false, reason: `Unknown command '${name}'` };
  const category = bridgeCategoryVerdict(cmd.category);
  if (!category.allowed) {
    return {
      allowed: false,
      reason: `'${name}' is not available over the MCP bridge (${category.reason}) — run it from the editor`,
    };
  }
  if (DENIED_SCOPES.has(cmd.requiredScope)) {
    return {
      allowed: false,
      reason: `'${name}' (${cmd.requiredScope}) is not available over the MCP bridge — run it from the editor`,
    };
  }
  return { allowed: true };
}

/** Names the bridge will execute — for tests and the docs. */
export function bridgeAllowedCommands(): string[] {
  return [...commands.keys()].filter((n) => bridgeVerdict(n).allowed).sort();
}

/**
 * How the live manifest's categories fall across the two sets. `unclassified`
 * is what a deny-list would have silently admitted.
 */
export function bridgeCategoryPartition(): {
  unclassified: string[];
  missingFromManifest: string[];
} {
  const inManifest = new Set([...commands.values()].map((c) => c.category));
  const unclassified = [...inManifest]
    .filter((c) => !BRIDGE_ALLOWED_CATEGORIES.has(c) && !BRIDGE_DENIED_CATEGORIES.has(c))
    .sort();
  const missingFromManifest = [...BRIDGE_ALLOWED_CATEGORIES, ...BRIDGE_DENIED_CATEGORIES.keys()]
    .filter((c) => !inManifest.has(c))
    .sort();
  return { unclassified, missingFromManifest };
}
