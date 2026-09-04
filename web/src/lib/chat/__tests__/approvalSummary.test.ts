import { describe, it, expect } from 'vitest';
import { describeToolAction } from '@/lib/chat/approvalSummary';
import { DESTRUCTIVE_COMMANDS } from '@/lib/chat/destructiveCommands';
import manifestJson from '@/data/commands.json';

const manifest = manifestJson as {
  commands: Array<{
    name: string;
    destructive: boolean;
    parameters?: { properties?: Record<string, unknown>; required?: string[] };
  }>;
};

/** A plausible value for a parameter, so descriptions get exercised with data. */
function sampleInput(name: string): Record<string, unknown> {
  const command = manifest.commands.find((c) => c.name === name);
  const properties = command?.parameters?.properties ?? {};
  const input: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(properties)) {
    const schema = raw as { type?: string; enum?: unknown[] };
    if (Array.isArray(schema.enum) && schema.enum.length > 0) input[key] = schema.enum[0];
    else if (schema.type === 'number' || schema.type === 'integer') input[key] = 1;
    else if (schema.type === 'boolean') input[key] = true;
    else if (schema.type === 'array') input[key] = ['id-a'];
    else if (schema.type === 'object') input[key] = {};
    else input[key] = `${key}-value`;
  }
  return input;
}

const noNames = () => undefined;

describe('describeToolAction', () => {
  it('describes EVERY destructive command in the manifest', () => {
    const destructive = manifest.commands.filter((c) => c.destructive === true).map((c) => c.name);

    // A walk over an empty list reports zero problems and reads as coverage —
    // pin the count so a manifest that stops carrying the flag fails here.
    expect(destructive.length).toBe(DESTRUCTIVE_COMMANDS.size);
    expect(destructive.length).toBeGreaterThan(10);

    for (const name of destructive) {
      const described = describeToolAction(name, sampleInput(name), noNames);
      expect(described, `${name} has no plain-language description`).not.toBe('');
      // A description that is just the tool name is the raw JSON problem in a
      // different font — it must read as a sentence.
      expect(described.length, `${name}: description is too short to be a sentence`).toBeGreaterThan(
        name.length,
      );
    }
  });

  it('returns empty for a command with no specific phrasing, so callers can fall back', () => {
    expect(describeToolAction('get_scene_graph', {}, noNames)).toBe('');
    expect(describeToolAction('not_a_real_command', { a: 1 }, noNames)).toBe('');
  });

  it('resolves an entity id to the name the user sees in the editor', () => {
    const lookup = (id: string) => (id === '4294967299' ? 'Player' : undefined);

    expect(describeToolAction('despawn_entity', { entityId: '4294967299' }, lookup)).toBe(
      'Delete "Player" from the scene',
    );
    expect(describeToolAction('set_script', { entityId: '4294967299' }, lookup)).toContain('"Player"');
  });

  it('falls back to a shortened id rather than inventing a name', () => {
    // An id the scene graph does not know is itself information — the entity is
    // already gone, or the model hallucinated it. Saying "an entity" would hide
    // that.
    const described = describeToolAction(
      'despawn_entity',
      { entityId: '0f3a9c21b4d85e17' },
      noNames,
    );
    expect(described).toBe('Delete entity 0f3a9c21… from the scene');
  });

  it('names each entity in a multi-entity delete and caps the list', () => {
    const lookup = (id: string) => ({ '1': 'Player', '2': 'Enemy' })[id];

    expect(describeToolAction('delete_entities', { entityIds: ['1', '2'] }, lookup)).toBe(
      'Delete 2 entities from the scene: "Player", "Enemy"',
    );

    const many = describeToolAction(
      'delete_entities',
      { entityIds: ['1', '2', '3', '4', '5', '6'] },
      lookup,
    );
    expect(many).toContain('Delete 6 entities');
    expect(many).toContain('and 2 more');
  });

  it('reads correctly for a single entity', () => {
    expect(describeToolAction('delete_entities', { entityIds: ['1'] }, () => 'Player')).toBe(
      'Delete 1 entity from the scene: "Player"',
    );
  });

  it('survives a malformed input without throwing or claiming a name', () => {
    // The input on the card comes off the wire; a missing or wrong-typed field
    // must degrade to vaguer prose, never crash the approval card.
    expect(() => describeToolAction('despawn_entity', {}, noNames)).not.toThrow();
    expect(describeToolAction('despawn_entity', {}, noNames)).toBe('Delete an entity from the scene');
    expect(describeToolAction('delete_entities', { entityIds: 'not-an-array' }, noNames)).toContain(
      'no entities',
    );
  });

  it('distinguishes a destructive scene build from a plain one', () => {
    expect(
      describeToolAction('create_scene_from_description', { clearExisting: true }, noNames),
    ).toContain('Delete everything');
    expect(
      describeToolAction('create_scene_from_description', { clearExisting: false }, noNames),
    ).not.toContain('Delete everything');
  });
});
