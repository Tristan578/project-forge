// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('@/lib/chat/executor', () => ({
  executeToolCall: vi.fn(),
}));
vi.mock('@/stores/editorStore', () => ({
  useEditorStore: { getState: () => ({ scene: 'state' }) },
}));

import { executeToolCall } from '@/lib/chat/executor';
import manifestJson from '@/data/commands.json';
import {
  bridgeVerdict,
  bridgeAllowedCommands,
  bridgeCategoryVerdict,
  bridgeCategoryPartition,
  BRIDGE_ALLOWED_CATEGORIES,
  BRIDGE_DENIED_CATEGORIES,
} from '../bridgeAllowlist';
import { handleBridgeFrame } from '../bridgeFrame';
import { mcpBridgeEnabled, mcpBridgeToken, mcpBridgeUrl, mcpBridgeRequested } from '../bridgeOptIn';

const manifest = manifestJson as {
  commands: { name: string; category: string; requiredScope: string }[];
};

describe('bridge allowlist (#9293)', () => {
  it('refuses every scripting command: its source reaches Function() (SEC-2)', () => {
    const scripting = manifest.commands.filter((c) => c.category === 'scripting');
    // A sweep that matched nothing would report zero problems found.
    expect(scripting.length).toBeGreaterThan(10);
    for (const cmd of scripting) {
      expect(bridgeVerdict(cmd.name).allowed, cmd.name).toBe(false);
    }
    expect(bridgeVerdict('create_script').reason).toContain('SEC-2');
  });

  it('refuses commands that spend tokens, export, publish, or touch security/economy — and unknown names', () => {
    for (const name of ['generate_texture', 'export_project_zip', 'export_game', 'publish_game', 'build_world', 'translate_scene']) {
      const v = bridgeVerdict(name);
      expect(v.allowed, name).toBe(false);
      expect(v.reason, name).toBeTruthy();
    }
    expect(bridgeVerdict('not_a_command').allowed).toBe(false);
  });

  it('allows scene and query commands', () => {
    expect(bridgeVerdict('spawn_entity').allowed).toBe(true);
    expect(bridgeVerdict('describe_scene').allowed).toBe(true);
    // The line is the CATEGORY, not the name: export_dialogue_tree is a
    // dialogue-authoring command, not a project export, and stays allowed.
    expect(bridgeVerdict('export_dialogue_tree').allowed).toBe(true);
  });

  // This is the assertion the deny-list version could not make. A command in a
  // category nobody has classified must be refused, so a category added to the
  // manifest tomorrow is not reachable over the bridge the day it merges.
  it('denies a category nobody has classified, rather than allowing it by default', () => {
    const verdict = bridgeCategoryVerdict('a_category_added_in_2027');
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain('not on the MCP bridge allowlist');
  });

  it('classifies every category the live manifest carries, in exactly one direction', () => {
    const categories = new Set(manifest.commands.map((c) => c.category));
    expect(categories.size).toBeGreaterThan(30);
    const { unclassified, missingFromManifest } = bridgeCategoryPartition();
    // Left un-triaged: refused at runtime, and named here so it gets a decision.
    expect(unclassified).toEqual([]);
    // Classified but gone from the manifest: a stale entry that hides a rename.
    expect(missingFromManifest).toEqual([]);
    for (const category of BRIDGE_ALLOWED_CATEGORIES) {
      expect(BRIDGE_DENIED_CATEGORIES.has(category), category).toBe(false);
    }
  });

  it('allows only the enumerated categories, and 293 of the 351 manifest commands', () => {
    const allowed = new Set(bridgeAllowedCommands());
    const deniedScopes = new Set(['ai:generate', 'project:manage']);
    for (const cmd of manifest.commands) {
      const shouldAllow = BRIDGE_ALLOWED_CATEGORIES.has(cmd.category) && !deniedScopes.has(cmd.requiredScope);
      expect(allowed.has(cmd.name), `${cmd.name} (${cmd.category}, ${cmd.requiredScope})`).toBe(shouldAllow);
    }
    // Pinned, not "greater than": the previous deny-list allowed 308, and a
    // ">250" assertion could not tell the two apart.
    expect(manifest.commands.length).toBe(351);
    expect(allowed.size).toBe(293);
  });
});

describe('opt-in gate', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // Driven through the REAL expression the browser bundle runs. The previous
  // version passed a synthetic env object, so it pinned a contract the
  // production call path never executed (lessons-learned #14).
  it('is on outside production and off in production without the build flag', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(mcpBridgeEnabled()).toBe(true);
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_MCP_BRIDGE', '');
    expect(mcpBridgeEnabled()).toBe(false);
    vi.stubEnv('NEXT_PUBLIC_MCP_BRIDGE', 'yes');
    expect(mcpBridgeEnabled()).toBe(false);
    vi.stubEnv('NEXT_PUBLIC_MCP_BRIDGE', 'true');
    expect(mcpBridgeEnabled()).toBe(true);
  });

  /**
   * Next.js substitutes `process.env.NEXT_PUBLIC_*` and `process.env.NODE_ENV`
   * at build time ONLY as fully-qualified member expressions. A bare `process`
   * in a client bundle resolves to the browser shim, whose `env` is `{}` — so
   * an aliased or injected env reads empty and this gate fails OPEN. No runtime
   * test can see that (vitest has a real process.env), so the source shape is
   * what gets pinned.
   */
  it('reads each flag as a literal process.env member expression, never an alias', () => {
    const source = readFileSync(join(process.cwd(), 'src/lib/mcp/bridgeOptIn.ts'), 'utf8');
    const body = source.slice(source.indexOf('export const MCP_BRIDGE_DEFAULT_URL'));
    for (const literal of [
      'process.env.NODE_ENV',
      'process.env.NEXT_PUBLIC_MCP_BRIDGE',
      'process.env.NEXT_PUBLIC_MCP_RELAY_URL',
    ]) {
      expect(body, literal).toContain(literal);
    }
    expect(body).not.toMatch(/NodeJS\.ProcessEnv/);
    expect(body).not.toMatch(/=\s*process\.env[^.]/);
  });

  it('needs ?mcp=<token> on the tab', () => {
    expect(mcpBridgeToken('')).toBeNull();
    expect(mcpBridgeToken('?foo=1')).toBeNull();
    expect(mcpBridgeToken('?mcp=')).toBeNull();
    expect(mcpBridgeToken('?mcp=abc123')).toBe('abc123');
  });

  it('reports the tab as a bridge candidate only with both the build flag and the token', () => {
    vi.stubEnv('NODE_ENV', 'development');
    window.history.replaceState({}, '', '/editor');
    expect(mcpBridgeRequested()).toBe(false);
    window.history.replaceState({}, '', '/editor?mcp=abc123');
    expect(mcpBridgeRequested()).toBe(true);
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_MCP_BRIDGE', '');
    expect(mcpBridgeRequested()).toBe(false);
  });

  it('builds the editor-role relay URL with the token', () => {
    expect(mcpBridgeUrl('t0k')).toBe('ws://127.0.0.1:3001/api/mcp/ws?role=editor&token=t0k');
    vi.stubEnv('NEXT_PUBLIC_MCP_RELAY_URL', 'ws://127.0.0.1:4444/x');
    expect(mcpBridgeUrl('t0k')).toBe('ws://127.0.0.1:4444/x?role=editor&token=t0k');
  });
});

describe('handleBridgeFrame', () => {
  const sent: Record<string, unknown>[] = [];
  const send = (f: Record<string, unknown>) => {
    sent.push(f);
  };
  beforeEach(() => {
    sent.length = 0;
    vi.mocked(executeToolCall).mockReset();
  });

  it('executes an allowed command through executeToolCall and replies with the same requestId', async () => {
    vi.mocked(executeToolCall).mockResolvedValue({ success: true, message: 'spawned' } as never);
    await handleBridgeFrame(JSON.stringify({ type: 'command', requestId: 'r1', name: 'spawn_entity', payload: { kind: 'cube' } }), send);
    expect(executeToolCall).toHaveBeenCalledWith('spawn_entity', { kind: 'cube' }, { scene: 'state' });
    expect(sent).toEqual([{ type: 'command_result', requestId: 'r1', result: { success: true, message: 'spawned' } }]);
  });

  it('answers a denied command with an error envelope and never executes it', async () => {
    await handleBridgeFrame(JSON.stringify({ type: 'command', requestId: 'r2', name: 'generate_texture', payload: {} }), send);
    expect(executeToolCall).not.toHaveBeenCalled();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: 'command_result', requestId: 'r2' });
    expect(String(sent[0].error)).toContain('not available over the MCP bridge');
  });

  it('never executes a script-authoring command, however it is dressed up', async () => {
    for (const name of ['create_script', 'set_script', 'apply_script_template']) {
      await handleBridgeFrame(JSON.stringify({ type: 'command', requestId: name, name, payload: { source: 'fetch("//x")' } }), send);
    }
    expect(executeToolCall).not.toHaveBeenCalled();
    expect(sent).toHaveLength(3);
    for (const frame of sent) expect(String(frame.error)).toContain('SEC-2');
  });

  it('turns a failed execution into an error envelope instead of throwing', async () => {
    vi.mocked(executeToolCall).mockResolvedValue({ success: false, error: 'Unknown tool: spawn_entity' } as never);
    await handleBridgeFrame(JSON.stringify({ type: 'command', requestId: 'r3', name: 'spawn_entity' }), send);
    expect(sent).toEqual([{ type: 'command_result', requestId: 'r3', error: 'Unknown tool: spawn_entity' }]);
  });

  it('ignores malformed and non-command frames', async () => {
    await handleBridgeFrame('not json', send);
    await handleBridgeFrame(JSON.stringify({ type: 'command_result', requestId: 'x' }), send);
    await handleBridgeFrame(JSON.stringify({ type: 'command', name: 'spawn_entity' }), send);
    expect(sent).toEqual([]);
    expect(executeToolCall).not.toHaveBeenCalled();
  });
});
