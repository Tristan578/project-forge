/**
 * #9117: the agent's tool set (the surface the chat route really sends to the
 * model) must withhold a command whose capability is declared unavailable.
 * Pinned against the REAL manifest, with the SDK adapter stubbed to identity
 * so the advertised names are observable.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai');
  return {
    ...actual,
    ToolLoopAgent: class {},
    stepCountIs: vi.fn(),
  };
});
vi.mock('@ai-sdk/anthropic', () => ({ anthropic: vi.fn() }));
vi.mock('@ai-sdk/gateway', () => ({ gateway: vi.fn() }));
vi.mock('@/lib/ai/toolAdapter', () => ({
  convertManifestToolsToSdkTools: vi.fn((tools: Array<{ name: string }>) => tools),
}));

import { AGENT_TOOLS } from '@/lib/ai/spawnforgeAgent';
import { getCapabilityUnavailability } from '@/lib/config/providers';

describe('agent tool availability (#9117)', () => {
  const names = (AGENT_TOOLS as unknown as Array<{ name: string }>).map((t) => t.name);

  it('withholds generate_music from the agent while music is declared unavailable', () => {
    expect(getCapabilityUnavailability('music')).not.toBeNull();
    expect(names).not.toContain('generate_music');
  });

  it('still advertises the offered generation tools', () => {
    expect(names).toEqual(expect.arrayContaining(['generate_3d_model', 'generate_sfx', 'generate_voice', 'generate_texture']));
  });
});
