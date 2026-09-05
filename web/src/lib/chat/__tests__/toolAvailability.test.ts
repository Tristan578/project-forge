/**
 * #9117: a command whose capability is declared unavailable must never be
 * offered to the model. Offering it guarantees a failed tool call (the route
 * refuses 503 before doing anything) and wasted tokens on every orchestrated
 * build. `getChatTools()` and the agent tool set share `isCommandAvailable`.
 */
import { describe, it, expect } from 'vitest';
import { getChatTools, getCommandNames } from '../tools';
import {
  COMMAND_CAPABILITY,
  PROVIDER_CAPABILITIES,
  getCapabilityUnavailability,
  isCommandAvailable,
} from '@/lib/config/providers';

describe('chat tool availability (#9117)', () => {
  it('withholds generate_music while music is declared unavailable', () => {
    expect(getCapabilityUnavailability('music')).not.toBeNull();
    const names = getChatTools().map((t) => t.name);
    expect(names).not.toContain('generate_music');
    // The command still exists in the manifest — it is withheld, not deleted.
    expect(getCommandNames()).toContain('generate_music');
  });

  it('still offers the generation commands whose capabilities are available', () => {
    const names = getChatTools().map((t) => t.name);
    for (const cmd of ['generate_3d_model', 'generate_texture', 'generate_sfx', 'generate_voice']) {
      expect(getCapabilityUnavailability(COMMAND_CAPABILITY[cmd])).toBeNull();
      expect(names, cmd).toContain(cmd);
    }
  });

  it('maps every COMMAND_CAPABILITY entry to a real manifest command and a real capability', () => {
    const manifestNames = new Set(getCommandNames());
    for (const [cmd, cap] of Object.entries(COMMAND_CAPABILITY)) {
      expect(manifestNames.has(cmd), `${cmd} is not in the manifest`).toBe(true);
      expect(PROVIDER_CAPABILITIES).toContain(cap);
    }
  });

  it('treats commands that spend no capability as always available', () => {
    expect(isCommandAvailable('spawn_entity')).toBe(true);
    expect(isCommandAvailable('generate_music')).toBe(false);
  });
});
