// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/chat/executor', () => ({
  executeToolCall: vi.fn(),
}));
vi.mock('@/stores/editorStore', () => ({
  useEditorStore: { getState: () => ({ scene: 'state' }) },
}));

import { executeToolCall } from '@/lib/chat/executor';
import manifestJson from '@/data/commands.json';
import { bridgeVerdict, bridgeAllowedCommands } from '../bridgeAllowlist';
import { handleBridgeFrame, mcpBridgeEnabled, mcpBridgeToken, mcpBridgeUrl } from '../useEditorBridge';

describe('bridge allowlist (#9293)', () => {
  it('refuses commands that spend tokens, export, publish, or touch security/economy — and unknown names', () => {
    for (const name of ['generate_texture', 'export_project_zip', 'export_game', 'publish_game']) {
      const v = bridgeVerdict(name);
      expect(v.allowed, name).toBe(false);
      expect(v.reason, name).toBeTruthy();
    }
    expect(bridgeVerdict('not_a_command').allowed).toBe(false);
  });

  it('allows scene and query commands', () => {
    expect(bridgeVerdict('spawn_entity').allowed).toBe(true);
    expect(bridgeVerdict('describe_scene').allowed).toBe(true);
  });

  it('allows a large majority of the manifest and nothing from a denied category or scope', () => {
    const allowed = new Set(bridgeAllowedCommands());
    expect(allowed.size).toBeGreaterThan(250);
    const denied = new Set(['generation', 'export', 'publishing', 'security', 'economy']);
    const deniedScopes = new Set(['ai:generate', 'project:manage']);
    let deniedSeen = 0;
    for (const cmd of (manifestJson as { commands: { name: string; category: string; requiredScope: string }[] }).commands) {
      const shouldDeny = denied.has(cmd.category) || deniedScopes.has(cmd.requiredScope);
      if (shouldDeny) deniedSeen += 1;
      expect(allowed.has(cmd.name), `${cmd.name} (${cmd.category}, ${cmd.requiredScope})`).toBe(!shouldDeny);
    }
    expect(deniedSeen).toBeGreaterThan(20);
    // The line is the CATEGORY, not the name: export_dialogue_tree is a
    // dialogue-authoring command, not a project export, and stays allowed.
    expect(allowed.has('export_dialogue_tree')).toBe(true);
    expect(allowed.has('export_project_zip')).toBe(false);
  });
});

describe('opt-in gate', () => {
  it('is on outside production and off in production without the build flag', () => {
    expect(mcpBridgeEnabled({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toBe(true);
    expect(mcpBridgeEnabled({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBe(false);
    expect(mcpBridgeEnabled({ NODE_ENV: 'production', NEXT_PUBLIC_MCP_BRIDGE: 'true' } as NodeJS.ProcessEnv)).toBe(true);
  });

  it('needs ?mcp=<token> on the tab', () => {
    expect(mcpBridgeToken('')).toBeNull();
    expect(mcpBridgeToken('?foo=1')).toBeNull();
    expect(mcpBridgeToken('?mcp=')).toBeNull();
    expect(mcpBridgeToken('?mcp=abc123')).toBe('abc123');
  });

  it('builds the editor-role relay URL with the token', () => {
    expect(mcpBridgeUrl('t0k', { NODE_ENV: 'test' } as NodeJS.ProcessEnv)).toBe('ws://127.0.0.1:3001/api/mcp/ws?role=editor&token=t0k');
    expect(mcpBridgeUrl('t0k', { NODE_ENV: 'test', NEXT_PUBLIC_MCP_RELAY_URL: 'ws://127.0.0.1:4444/x' } as NodeJS.ProcessEnv)).toBe(
      'ws://127.0.0.1:4444/x?role=editor&token=t0k',
    );
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
