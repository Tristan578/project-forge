import { describe, expect, it } from 'vitest';
import manifestJson from '@/data/commands.json';
import { handlerRegistry } from '../executor';
import { getChatTools } from '../tools';

interface ManifestCommand {
  name: string;
}

const manifest = manifestJson as { commands: ManifestCommand[] };

export function checkManifestHandlerParity(
  tools: ReadonlyArray<{ name: string }>,
  registry: Record<string, unknown>,
): { missing: string[]; orphaned: string[] } {
  const manifestNames = new Set(manifest.commands.map((command) => command.name));
  const missing = tools
    .map((tool) => tool.name)
    .filter((name) => typeof registry[name] !== 'function')
    .sort();
  const orphaned = Object.keys(registry)
    .filter((name) => !manifestNames.has(name))
    .sort();

  return { missing, orphaned };
}

describe('getChatTools() -> handlerRegistry parity', () => {
  it('every exposed tool name resolves to a function in handlerRegistry', () => {
    expect(checkManifestHandlerParity(getChatTools(), handlerRegistry).missing).toEqual([]);
  });

  it.each(getChatTools())('$name resolves to a callable handler', ({ name }) => {
    expect(typeof handlerRegistry[name]).toBe('function');
  });
});

describe('handlerRegistry -> manifest parity', () => {
  it('every handler key maps to a real manifest command name', () => {
    expect(checkManifestHandlerParity(getChatTools(), handlerRegistry).orphaned).toEqual([]);
  });
});

describe('checkManifestHandlerParity negative cases', () => {
  it('reports an exposed tool whose handler is absent', () => {
    expect(typeof handlerRegistry.spawn_entity).toBe('function');
    const brokenRegistry = { ...handlerRegistry };
    delete brokenRegistry.spawn_entity;

    expect(checkManifestHandlerParity(getChatTools(), brokenRegistry).missing)
      .toContain('spawn_entity');
  });

  it('reports a handler key absent from the manifest', () => {
    const registryWithOrphan = {
      ...handlerRegistry,
      totally_fake_command_xyz: async () => ({ success: true }),
    };

    expect(checkManifestHandlerParity(getChatTools(), registryWithOrphan).orphaned)
      .toContain('totally_fake_command_xyz');
  });

  it('passes cleanly for the real exposed tools and registry', () => {
    expect(checkManifestHandlerParity(getChatTools(), handlerRegistry)).toEqual({
      missing: [],
      orphaned: [],
    });
  });
});
