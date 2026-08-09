/**
 * Regression tests for the tool surface the chat route actually advertises.
 *
 * Deliberately a separate file from `spawnforgeAgent.test.ts`: that suite mocks
 * `@/lib/ai/toolAdapter` to return `{}`, so `AGENT_TOOLS` is empty there and any
 * assertion about a real tool schema would pass vacuously. Here nothing is mocked,
 * so the schemas are the ones `createSpawnforgeAgent` hands to the SDK.
 */

import { describe, it, expect } from 'vitest';
import { AGENT_TOOLS } from '../spawnforgeAgent';
import { getCommandDef } from '@/lib/chat/tools';

/**
 * `convertManifestToolsToSdkTools` wraps each schema with the AI SDK's
 * `jsonSchema()`, which parks the original object on `.jsonSchema`. Reaching
 * through it is what makes these assertions test the real advertised surface
 * rather than the input we handed the adapter.
 */
function advertisedSchema(name: string) {
  const tool = AGENT_TOOLS[name as keyof typeof AGENT_TOOLS] as
    | { inputSchema?: { jsonSchema?: { properties?: Record<string, unknown>; required?: string[] } } }
    | undefined;
  return tool?.inputSchema?.jsonSchema;
}

describe('AGENT_TOOLS', () => {
  it('advertises spawn_entity', () => {
    expect(advertisedSchema('spawn_entity')?.properties).toBeDefined();
  });

  // The manifest documents `id` for direct-to-engine MCP clients, but the chat
  // path must not offer it: `transformHandlers.spawn_entity` forwards only
  // `entityType` and `name`, so a model-supplied id is silently discarded.
  it('does not advertise spawn_entity.id to the model', () => {
    const schema = advertisedSchema('spawn_entity');

    expect(Object.keys(schema!.properties!)).not.toContain('id');
    expect(schema!.required ?? []).not.toContain('id');
  });

  it('still advertises every other documented spawn_entity property', () => {
    const documented = Object.keys(getCommandDef('spawn_entity')!.parameters.properties!);

    expect(Object.keys(advertisedSchema('spawn_entity')!.properties!).sort()).toEqual(
      documented.filter((key) => key !== 'id').sort(),
    );
  });

  // Guards the shared filter against over-reach — it is keyed per command, so a
  // sibling entity command must come through with every documented property.
  it('leaves commands with no exclusions fully advertised', () => {
    const documented = Object.keys(getCommandDef('rename_entity')!.parameters.properties!);

    expect(documented.length).toBeGreaterThan(0);
    expect(Object.keys(advertisedSchema('rename_entity')!.properties!).sort()).toEqual(
      documented.sort(),
    );
  });
});
