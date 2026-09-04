import { describe, it, expect } from 'vitest';
import manifestJson from '@/data/commands.json';
import { DESTRUCTIVE_COMMANDS, isDestructiveCommand } from '@/lib/chat/destructiveCommands';
import { AGENT_TOOL_APPROVAL } from '@/lib/ai/spawnforgeAgent';

const manifest = manifestJson as {
  commands: Array<{ name: string; destructive: boolean; requiredScope: string; category: string }>;
};

describe('DESTRUCTIVE_COMMANDS', () => {
  const flagged = manifest.commands.filter((c) => c.destructive === true).map((c) => c.name);

  it('matches the manifest exactly, in both directions', () => {
    // Either direction failing is a live security hole:
    //  - a manifest name missing here is a server-gated command the client
    //    would happily execute out of a truncated stream;
    //  - a name here that is not in the manifest is a command the client
    //    refuses to run that the user can never approve, because the server
    //    never issues an approvalId for it.
    expect([...DESTRUCTIVE_COMMANDS].sort()).toEqual([...flagged].sort());
  });

  it('is non-empty (a set of zero would gate nothing and pass vacuously)', () => {
    expect(DESTRUCTIVE_COMMANDS.size).toBeGreaterThan(10);
  });

  it('covers every command the agent asks the SDK to gate', () => {
    // AGENT_TOOL_APPROVAL is what actually issues approvalIds. A tool marked
    // 'user-approval' there but absent here would stall: the client would let
    // it through the drain, and the SDK would still be waiting.
    const gated = Object.entries(AGENT_TOOL_APPROVAL)
      .filter(([, status]) => status === 'user-approval')
      .map(([name]) => name);

    expect(gated.length).toBeGreaterThan(0);
    for (const name of gated) {
      expect(isDestructiveCommand(name), `${name} is SDK-gated but not in DESTRUCTIVE_COMMANDS`).toBe(true);
    }
  });

  it('does not flag ordinary edits', () => {
    for (const name of ['spawn_entity', 'update_transform', 'set_visibility', 'remove_physics2d']) {
      expect(isDestructiveCommand(name)).toBe(false);
    }
  });

  it('flags the commands that destroy authored content', () => {
    for (const name of ['despawn_entity', 'delete_entities', 'new_scene', 'remove_script', 'set_script']) {
      expect(isDestructiveCommand(name)).toBe(true);
    }
  });
});
