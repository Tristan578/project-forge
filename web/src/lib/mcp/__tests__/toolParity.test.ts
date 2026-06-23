import { describe, expect, it, vi } from 'vitest';
import {
  checkToolParity,
  compareToolSets,
  fetchServerToolNames,
  formatToolParity,
  getManifestToolNames,
  type ToolListingClient,
} from '@/lib/mcp/toolParity';
import { isMcpClientConfigured, withMcpClient } from '@/lib/mcp/client';
import manifestJson from '@/data/commands.json';

const manifest = manifestJson as { commands: Array<{ name: string }> };

describe('getManifestToolNames', () => {
  it('returns every command name, sorted, deduped to the manifest length', () => {
    const names = getManifestToolNames();
    expect(names.length).toBe(manifest.commands.length);
    expect([...names]).toEqual([...names].sort());
    // sanity: a known command is present
    expect(names).toContain(manifest.commands[0].name);
  });
});

describe('compareToolSets', () => {
  it('reports in-sync when sets are identical regardless of order', () => {
    const r = compareToolSets(['b', 'a', 'c'], ['c', 'a', 'b']);
    expect(r).toEqual({ inSync: true, onlyInManifest: [], onlyInServer: [] });
  });

  it('reports a command missing from the live server (onlyInManifest)', () => {
    const r = compareToolSets(['a', 'b', 'c'], ['a', 'c']);
    expect(r.inSync).toBe(false);
    expect(r.onlyInManifest).toEqual(['b']);
    expect(r.onlyInServer).toEqual([]);
  });

  it('reports a tool served but not bundled (onlyInServer)', () => {
    const r = compareToolSets(['a', 'b'], ['a', 'b', 'z']);
    expect(r.inSync).toBe(false);
    expect(r.onlyInManifest).toEqual([]);
    expect(r.onlyInServer).toEqual(['z']);
  });

  it('reports drift in both directions, sorted', () => {
    const r = compareToolSets(['a', 'm', 'b'], ['a', 'z', 'y']);
    expect(r.onlyInManifest).toEqual(['b', 'm']);
    expect(r.onlyInServer).toEqual(['y', 'z']);
  });
});

describe('fetchServerToolNames', () => {
  it('returns sorted keys of the client tool set', async () => {
    const client: ToolListingClient = {
      tools: vi.fn().mockResolvedValue({ spawn_entity: {}, delete_entity: {}, query_scene: {} }),
    };
    expect(await fetchServerToolNames(client)).toEqual([
      'delete_entity',
      'query_scene',
      'spawn_entity',
    ]);
  });
});

describe('checkToolParity', () => {
  it('is in sync when the server serves exactly the bundled command set', async () => {
    const serverTools = Object.fromEntries(getManifestToolNames().map((n) => [n, {}]));
    const client: ToolListingClient = { tools: vi.fn().mockResolvedValue(serverTools) };
    const result = await checkToolParity(client);
    expect(result.inSync).toBe(true);
    expect(result.onlyInManifest).toEqual([]);
    expect(result.onlyInServer).toEqual([]);
  });

  it('detects a server missing one bundled command', async () => {
    const names = getManifestToolNames();
    const dropped = names[0];
    const serverTools = Object.fromEntries(names.slice(1).map((n) => [n, {}]));
    const client: ToolListingClient = { tools: vi.fn().mockResolvedValue(serverTools) };
    const result = await checkToolParity(client);
    expect(result.inSync).toBe(false);
    expect(result.onlyInManifest).toEqual([dropped]);
  });
});

describe('formatToolParity', () => {
  it('summarizes an in-sync result with the tool count', () => {
    expect(formatToolParity({ inSync: true, onlyInManifest: [], onlyInServer: [] })).toContain(
      `${getManifestToolNames().length} tools`,
    );
  });

  it('names the drift in both directions', () => {
    const msg = formatToolParity({ inSync: false, onlyInManifest: ['a'], onlyInServer: ['z'] });
    expect(msg).toContain('NOT served by the server: a');
    expect(msg).toContain('NOT in web bundle: z');
  });
});

// Live parity check — only runs when a real MCP server is configured via env.
// Skipped in CI/dev (no MCP_HTTP_URL/MCP_HTTP_TOKEN); proves the bundled manifest
// matches what a running server actually serves when those vars ARE present.
describe.skipIf(!isMcpClientConfigured())('live MCP server tool parity', () => {
  it('the running server serves exactly the bundled command set', async () => {
    const result = await withMcpClient((client) => checkToolParity(client));
    expect(result).not.toBeNull();
    expect(result, formatToolParity(result!)).toMatchObject({ inSync: true });
  });
});
