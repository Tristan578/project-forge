/**
 * PF-8860 — the server-side tool-approval gate.
 *
 * Deliberately a SEPARATE file from `spawnforgeAgent.test.ts`: that suite mocks
 * `@/data/commands.json` with an empty command list, which would make every
 * assertion here vacuously true (a gate derived from zero commands gates
 * nothing and passes any "no unexpected tool is gated" check). These tests run
 * against the REAL manifest.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockToolLoopAgent = vi.fn();

vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai');
  return {
    ...actual,
    ToolLoopAgent: class {
      constructor(args: unknown) {
        mockToolLoopAgent(args);
      }
    },
  };
});

vi.mock('@ai-sdk/anthropic', () => ({
  anthropic: vi.fn((id: string) => ({ _provider: 'anthropic', id })),
}));

vi.mock('@ai-sdk/gateway', () => ({
  gateway: vi.fn((id: string) => ({ _provider: 'gateway', id })),
}));

import {
  AGENT_TOOLS,
  AGENT_TOOL_APPROVAL,
  createSpawnforgeAgent,
} from '@/lib/ai/spawnforgeAgent';
import manifestJson from '@/data/commands.json';

const manifest = manifestJson as {
  commands: Array<{
    name: string;
    category: string;
    requiredScope: string;
    destructive?: boolean;
  }>;
};

const advertised = manifest.commands.filter(
  (c) => c.requiredScope.endsWith(':write') || c.category === 'query',
);

describe('AGENT_TOOL_APPROVAL', () => {
  it('covers exactly the advertised tool set — no drift in either direction', () => {
    // A key the tool set does not contain is dead config; a tool the map does
    // not cover falls through the gate silently.
    expect(Object.keys(AGENT_TOOL_APPROVAL).sort()).toEqual(Object.keys(AGENT_TOOLS).sort());
  });

  it('inspects a non-empty tool set (guards against a vacuous pass)', () => {
    expect(Object.keys(AGENT_TOOL_APPROVAL).length).toBeGreaterThan(200);
  });

  it("maps every advertised destructive command to 'user-approval'", () => {
    const destructive = advertised.filter((c) => c.destructive === true).map((c) => c.name);
    expect(destructive.length).toBeGreaterThan(0);
    for (const name of destructive) {
      expect(AGENT_TOOL_APPROVAL[name], `${name} must be gated`).toBe('user-approval');
    }
  });

  it("maps every other advertised command to 'not-applicable'", () => {
    const nonDestructive = advertised.filter((c) => c.destructive !== true).map((c) => c.name);
    for (const name of nonDestructive) {
      expect(AGENT_TOOL_APPROVAL[name], `${name} must not be gated`).toBe('not-applicable');
    }
  });

  it('gates the destructive commands the ticket names', () => {
    expect(AGENT_TOOL_APPROVAL.delete_entities).toBe('user-approval');
    expect(AGENT_TOOL_APPROVAL.new_scene).toBe('user-approval');
    expect(AGENT_TOOL_APPROVAL.despawn_entity).toBe('user-approval');
    expect(AGENT_TOOL_APPROVAL.clear_world).toBe('user-approval');
  });

  it('leaves ordinary scene editing ungated', () => {
    // The reason the gate is derived from `destructive` and not from
    // `requiredScope`: these are all `:write`, and gating them would put an
    // approval prompt in front of every step of building a game.
    for (const name of ['spawn_entity', 'update_transform', 'update_material', 'set_visibility']) {
      expect(AGENT_TOOL_APPROVAL[name], `${name} must not be gated`).toBe('not-applicable');
    }
  });

  it('never gates a query-category command', () => {
    for (const cmd of manifest.commands.filter((c) => c.category === 'query')) {
      expect(AGENT_TOOL_APPROVAL[cmd.name], `${cmd.name}`).toBe('not-applicable');
    }
  });

  it('holds no key outside the manifest', () => {
    const known = new Set(manifest.commands.map((c) => c.name));
    for (const key of Object.keys(AGENT_TOOL_APPROVAL)) {
      expect(known.has(key), `${key} is not a manifest command`).toBe(true);
    }
  });
});

describe('createSpawnforgeAgent — toolApproval wiring', () => {
  beforeEach(() => {
    mockToolLoopAgent.mockClear();
  });

  const baseOptions = {
    isDirectBackend: true,
    model: 'claude-sonnet-4.5',
    instructions: 'test',
  };

  it('passes the approval map to ToolLoopAgent', () => {
    createSpawnforgeAgent(baseOptions);
    const args = mockToolLoopAgent.mock.calls[0][0] as { toolApproval?: unknown };
    expect(args.toolApproval).toBe(AGENT_TOOL_APPROVAL);
  });

  it('does NOT set experimental_toolApprovalSecret', () => {
    // Documented decision, pinned so a later addition is deliberate: with the
    // secret set, a resumed approval-request missing its `signature` is a hard
    // throw, and our resume history is rebuilt by the browser.
    createSpawnforgeAgent(baseOptions);
    const args = mockToolLoopAgent.mock.calls[0][0] as Record<string, unknown>;
    expect(args.experimental_toolApprovalSecret).toBeUndefined();
  });

  it('passes the same map on the gateway backend', () => {
    createSpawnforgeAgent({ ...baseOptions, isDirectBackend: false, model: 'anthropic/x' });
    const args = mockToolLoopAgent.mock.calls[0][0] as { toolApproval?: unknown };
    expect(args.toolApproval).toBe(AGENT_TOOL_APPROVAL);
  });
});
