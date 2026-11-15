/** Both model tool surfaces must withhold unsupported linked prefab mutations. */
import { describe, expect, it } from 'vitest';
import { getChatTools } from '@/lib/chat/tools';
import { AGENT_TOOLS } from '@/lib/ai/spawnforgeAgent';
import { isCommandAvailable } from '@/lib/config/providers';
import manifest from '@/data/commands.json';

describe('linked prefab tool advertising', () => {
  it.each(['create_prefab_instance', 'nest_prefab', 'apply_prefab_to_instances'])(
    'withholds %s while retaining an internal compatibility definition',
    (name) => {
      expect(isCommandAvailable(name)).toBe(false);
      expect(getChatTools().map((tool) => tool.name)).not.toContain(name);
      expect(Object.keys(AGENT_TOOLS)).not.toContain(name);
      expect(manifest.commands.find((command) => command.name === name)).toMatchObject({
        visibility: 'internal', description: expect.stringContaining('Unavailable compatibility command'),
      });
    },
  );

  it('keeps the independent flat-copy command advertised', () => {
    expect(isCommandAvailable('instantiate_prefab')).toBe(true);
    expect(getChatTools().map((tool) => tool.name)).toContain('instantiate_prefab');
    expect(Object.keys(AGENT_TOOLS)).toContain('instantiate_prefab');
  });
});
