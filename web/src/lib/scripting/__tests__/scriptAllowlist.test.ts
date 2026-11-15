/**
 * @vitest-environment node
 *
 * Focused coverage for the OP-04 addition to the script command allowlist. The
 * broader engine-reachability guarantee (that this name is routed AND has a
 * non-stub arm) is enforced by `scriptAllowlistParity.test.ts`; this asserts the
 * entry is present and that its forge-facing spelling is the one the worker
 * dispatches.
 */
import { describe, it, expect } from 'vitest';
import { SCRIPT_ALLOWED_COMMANDS } from '../scriptAllowlist';

describe('script allowlist — tile collision shape', () => {
  it('permits set_tile_collision_shape', () => {
    expect(SCRIPT_ALLOWED_COMMANDS).toContain('set_tile_collision_shape');
  });

  it('keeps the existing tilemap write commands alongside it', () => {
    for (const name of ['paint_tile', 'erase_tile', 'fill_tiles']) {
      expect(SCRIPT_ALLOWED_COMMANDS, name).toContain(name);
    }
  });
});
