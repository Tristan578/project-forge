/**
 * #9117: a command whose capability is declared unavailable must never be
 * offered to the model. Offering it guarantees a failed tool call (the route
 * refuses 503 before doing anything) and wasted tokens on every orchestrated
 * build. `getChatTools()` and the agent tool set share `isCommandAvailable`.
 */
import { describe, it, expect } from 'vitest';
import { getChatTools, getCommandNames, getCommandDef } from '../tools';
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

  // Reverse direction (lesson 11): every manifest command in the `generation`
  // category that spends a capability must be in the map, or the next
  // UNAVAILABLE_CAPABILITIES entry leaves a tool advertised that the route
  // refuses. The exceptions are the status/style commands that call no
  // generate route; they are named here so a new command fails this test
  // until it is classified one way or the other.
  it('covers every generation-category command that spends a capability', () => {
    const NON_SPENDING = new Set([
      // status reads and local post-processing — no generate route
      'get_generation_status',
      'get_sprite_generation_status',
      'apply_style_transfer',
      'set_project_style',
      'set_pixel_art_palette',
      'quantize_sprite_colors',
      // LLM-backed idea tools ride the chat capability, which has no direct
      // provider key to lose and is never declared unavailable here
      'generate_game_ideas',
      'get_idea_details',
      'start_from_idea',
      'remix_idea',
    ]);
    const generationCommands = getCommandDef
      ? getCommandNames().filter((n) => getCommandDef(n)?.category === 'generation')
      : [];
    expect(generationCommands.length).toBeGreaterThan(5);
    const unclassified = generationCommands.filter(
      (n) => !NON_SPENDING.has(n) && COMMAND_CAPABILITY[n] === undefined,
    );
    expect(unclassified).toEqual([]);
  });

  it('treats commands that spend no capability as always available', () => {
    expect(isCommandAvailable('spawn_entity')).toBe(true);
    expect(isCommandAvailable('generate_music')).toBe(false);
  });
});
