import { describe, it, expect } from 'vitest';

import manifestJson from '@/data/commands.json';
import { MCP_COMMAND_COUNT, MCP_CATEGORY_COUNT } from '../manifestStats';

interface ManifestCommand {
  category: string;
}

const commands = (manifestJson as { commands: ManifestCommand[] }).commands;

/**
 * The counts in `manifestStats.ts` are quoted on a dozen public pages. They are
 * declared by hand so the marketing routes do not each bundle the manifest, so
 * this is the thing that keeps them honest: add a command without updating the
 * constant and this fails, rather than the site quietly advertising a number
 * that has not been true since the last time somebody counted.
 */
describe('MCP manifest stats match the manifest', () => {
  it('counts every command', () => {
    expect(MCP_COMMAND_COUNT).toBe(commands.length);
  });

  it('counts every distinct category', () => {
    const categories = new Set(commands.map((command) => command.category));
    expect(MCP_CATEGORY_COUNT).toBe(categories.size);
  });

  it('reads a non-empty manifest', () => {
    // Guards the assertions above against passing vacuously if the import ever
    // resolves to an empty or reshaped manifest.
    expect(commands.length).toBeGreaterThan(0);
    expect(commands.every((command) => typeof command.category === 'string')).toBe(true);
  });
});
