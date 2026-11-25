import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import manifestJson from '@/data/commands.json';

interface ManifestCommand {
  name: string;
  parameters?: { properties?: Record<string, unknown> };
}

const commands = (manifestJson as { commands: ManifestCommand[] }).commands;

/**
 * The MCP relay forwards a tool's arguments to the engine verbatim, so a manifest
 * parameter the engine handler never reads is a parameter that cannot work. This
 * pins the manifest's spelling to the keys each sprites/2D handler reads, so a
 * typo like `project_type` (engine: `projectType`) fails here, not in a user's client.
 */
const spritesSource = readFileSync(
  resolve(__dirname, '../../../../../engine/src/core/commands/sprites.rs'),
  'utf-8',
);

/**
 * Commands whose manifest spelling ALREADY disagrees with the engine handler (found
 * when this test was written, tracked separately). Do not add to this list: fix the
 * spelling instead, and delete the entry when you do.
 */
const KNOWN_MISMATCHES = new Set([
  'set_grid_2d',
  'set_tile_collision_shape',
  'fill_tiles',
  'add_bone2d',
  'update_bone2d',
  'create_skeletal_animation2d',
  'add_keyframe2d',
  'play_skeletal_animation2d',
  'create_ik_chain2d',
]);

/** Keys a handler reads from its payload, by handler name (`handle_<command>`). */
function payloadKeys(command: string): Set<string> | null {
  const start = spritesSource.indexOf(`fn handle_${command}(`);
  if (start === -1) return null;
  const rest = spritesSource.slice(start + 1);
  const next = rest.search(/\nfn /);
  const body = next === -1 ? rest : rest.slice(0, next);
  return new Set([...body.matchAll(/payload(?:\.get\(|\[)"([A-Za-z0-9_]+)"/g)].map((m) => m[1]));
}

describe('manifest parameter names match the engine handler (sprites domain)', () => {
  it('finds the set_project_type handler', () => {
    expect(payloadKeys('set_project_type')).not.toBeNull();
  });

  it('spells set_project_type\'s parameter projectType', () => {
    const command = commands.find((c) => c.name === 'set_project_type');
    expect(Object.keys(command?.parameters?.properties ?? {})).toEqual(['projectType']);
  });

  for (const command of commands) {
    const keys = payloadKeys(command.name);
    if (!keys || KNOWN_MISMATCHES.has(command.name)) continue;
    it(`${command.name}: every manifest parameter is read by the engine`, () => {
      const unread = Object.keys(command.parameters?.properties ?? {}).filter((p) => !keys.has(p));
      expect(unread).toEqual([]);
    });
  }
});
