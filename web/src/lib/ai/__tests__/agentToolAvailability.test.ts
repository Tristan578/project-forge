/**
 * #9117: the agent's tool set (the surface the chat route really sends to the
 * model) must withhold a command whose capability is declared unavailable, and
 * advertise one whose capability is offered. Pinned against the REAL manifest,
 * with the SDK adapter stubbed to identity so the advertised names are
 * observable.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai');
  return {
    ...actual,
    ToolLoopAgent: class {},
    stepCountIs: vi.fn(),
  };
});
vi.mock('@ai-sdk/anthropic', () => ({ createAnthropic: vi.fn(() => ({ languageModel: vi.fn() })) }));
vi.mock('@ai-sdk/gateway', () => ({ gateway: vi.fn() }));
vi.mock('@/lib/ai/toolAdapter', () => ({
  convertManifestToolsToSdkTools: vi.fn((tools: Array<{ name: string }>) => tools),
}));

import { AGENT_TOOLS } from '@/lib/ai/spawnforgeAgent';
import { getCapabilityUnavailability } from '@/lib/config/providers';

async function agentToolNames(): Promise<string[]> {
  const { AGENT_TOOLS: tools } = await import('@/lib/ai/spawnforgeAgent');
  return (tools as unknown as Array<{ name: string }>).map((t) => t.name);
}

describe('agent tool availability (#9117)', () => {
  const names = (AGENT_TOOLS as unknown as Array<{ name: string }>).map((t) => t.name);

  afterEach(() => {
    vi.doUnmock('@/lib/config/providers');
    vi.resetModules();
  });

  it('advertises generate_music now that music routes to ElevenLabs (#9522)', () => {
    // Music was withheld while it routed to Suno (no public API); #9522 offers
    // it again, so the agent must expose the tool.
    expect(getCapabilityUnavailability('music')).toBeNull();
    expect(names).toContain('generate_music');
  });

  it('still advertises the offered generation tools', () => {
    expect(names).toEqual(
      expect.arrayContaining(['generate_3d_model', 'generate_sfx', 'generate_voice', 'generate_texture']),
    );
  });

  it('withholds a command whose capability is declared unavailable', async () => {
    // UNAVAILABLE_CAPABILITIES is empty after #9522, so exercise the withholding
    // filter by declaring generate_music unavailable — the module-load tool
    // table must drop it while leaving the sibling generation tools intact.
    vi.resetModules();
    vi.doMock('@/lib/config/providers', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/lib/config/providers')>();
      return {
        ...actual,
        isCommandAvailable: (name: string) => name !== 'generate_music',
      };
    });
    const withheld = await agentToolNames();
    expect(withheld).not.toContain('generate_music');
    expect(withheld).toEqual(
      expect.arrayContaining(['generate_3d_model', 'generate_sfx', 'generate_voice', 'generate_texture']),
    );
  });
});
