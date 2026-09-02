/**
 * Which manifest commands the editor-side MCP bridge will execute (#9293).
 *
 * The bridge hands a remote agent the same handlers the chat panel uses, so
 * the line is drawn where money or data leaves the tab: anything that spends
 * generation tokens, exports or publishes a project, or touches security /
 * economy is refused at the bridge with a named reason. Everything else in the
 * manifest is allowed; an unknown name is refused rather than guessed.
 */
import manifestJson from '@/data/commands.json';

interface ManifestCommand {
  name: string;
  category: string;
  requiredScope: string;
}

const DENIED_CATEGORIES = new Set(['generation', 'export', 'publishing', 'security', 'economy']);
const DENIED_SCOPES = new Set(['ai:generate', 'project:manage']);

const commands = new Map<string, ManifestCommand>(
  (manifestJson as { commands: ManifestCommand[] }).commands.map((c) => [c.name, c]),
);

export interface BridgeVerdict {
  allowed: boolean;
  reason?: string;
}

export function bridgeVerdict(name: string): BridgeVerdict {
  const cmd = commands.get(name);
  if (!cmd) return { allowed: false, reason: `Unknown command '${name}'` };
  if (DENIED_CATEGORIES.has(cmd.category)) {
    return { allowed: false, reason: `'${name}' (${cmd.category}) is not available over the MCP bridge — run it from the editor` };
  }
  if (DENIED_SCOPES.has(cmd.requiredScope)) {
    return { allowed: false, reason: `'${name}' (${cmd.requiredScope}) is not available over the MCP bridge — run it from the editor` };
  }
  return { allowed: true };
}

/** Names the bridge will execute — for tests and the docs. */
export function bridgeAllowedCommands(): string[] {
  return [...commands.keys()].filter((n) => bridgeVerdict(n).allowed).sort();
}
