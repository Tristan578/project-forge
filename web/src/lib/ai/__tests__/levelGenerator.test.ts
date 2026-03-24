import { describe, it, expect } from 'vitest';
import {
  LEVEL_TEMPLATES,
  validateLayout,
  applyConstraints,
  levelToCommands,
  parseLevelResponse,
  generateLevel,
  type LevelLayout,
  type LevelConstraint,
  type TemplateId,
} from '../levelGenerator';

// ===== Template Validation =====

describe('LEVEL_TEMPLATES', () => {
  const templateIds: TemplateId[] = ['linear', 'branching', 'metroidvania', 'arena', 'dungeon'];

  it.each(templateIds)('template "%s" exists with name and description', (id) => {
    const template = LEVEL_TEMPLATES[id];
    expect(template).toBeDefined();
    expect(template.name).toBeTruthy();
    expect(template.description).toBeTruthy();
    expect(typeof template.generate).toBe('function');
  });

  it.each(templateIds)('template "%s" generates a valid layout', (id) => {
    const layout = LEVEL_TEMPLATES[id].generate();
    const errors = validateLayout(layout);
    expect(errors).toEqual([]);
  });

  it.each(templateIds)('template "%s" has start and exit rooms that exist', (id) => {
    const layout = LEVEL_TEMPLATES[id].generate();
    const roomIds = layout.rooms.map((r) => r.id);
    expect(roomIds).toContain(layout.startRoom);
    expect(roomIds).toContain(layout.exitRoom);
  });

  it.each(templateIds)('template "%s" rooms have valid dimensions', (id) => {
    const layout = LEVEL_TEMPLATES[id].generate();
    for (const room of layout.rooms) {
      expect(room.width).toBeGreaterThan(0);
      expect(room.height).toBeGreaterThan(0);
    }
  });

  it.each(templateIds)('template "%s" has unique room IDs', (id) => {
    const layout = LEVEL_TEMPLATES[id].generate();
    const ids = layout.rooms.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(templateIds)('template "%s" has difficulty between 1 and 10', (id) => {
    const layout = LEVEL_TEMPLATES[id].generate();
    expect(layout.difficulty).toBeGreaterThanOrEqual(1);
    expect(layout.difficulty).toBeLessThanOrEqual(10);
  });
});

// ===== Validation =====

describe('validateLayout', () => {
  function minimalLayout(overrides: Partial<LevelLayout> = {}): LevelLayout {
    return {
      name: 'Test',
      theme: 'test',
      rooms: [
        {
          id: 'r1',
          name: 'Room 1',
          type: 'start',
          width: 10,
          height: 10,
          position: { x: 0, y: 0 },
          entities: [],
          connections: [],
        },
      ],
      startRoom: 'r1',
      exitRoom: 'r1',
      difficulty: 5,
      estimatedPlaytime: '5 min',
      ...overrides,
    };
  }

  it('accepts a valid single-room layout', () => {
    expect(validateLayout(minimalLayout())).toEqual([]);
  });

  it('rejects layout without name', () => {
    const errors = validateLayout(minimalLayout({ name: '' }));
    expect(errors).toContain('Layout must have a name');
  });

  it('rejects layout without rooms', () => {
    const errors = validateLayout(minimalLayout({ rooms: [] }));
    expect(errors).toContain('Layout must have at least one room');
  });

  it('rejects layout with invalid startRoom reference', () => {
    const errors = validateLayout(minimalLayout({ startRoom: 'nonexistent' }));
    expect(errors.some((e) => e.includes('startRoom'))).toBe(true);
  });

  it('rejects layout with invalid exitRoom reference', () => {
    const errors = validateLayout(minimalLayout({ exitRoom: 'nonexistent' }));
    expect(errors.some((e) => e.includes('exitRoom'))).toBe(true);
  });

  it('rejects invalid difficulty', () => {
    const errors = validateLayout(minimalLayout({ difficulty: 15 }));
    expect(errors.some((e) => e.includes('Difficulty'))).toBe(true);
  });

  it('detects orphan rooms in multi-room layout', () => {
    const layout = minimalLayout({
      rooms: [
        { id: 'r1', name: 'R1', type: 'start', width: 10, height: 10, position: { x: 0, y: 0 }, entities: [], connections: ['r2'] },
        { id: 'r2', name: 'R2', type: 'combat', width: 10, height: 10, position: { x: 15, y: 0 }, entities: [], connections: ['r1'] },
        { id: 'r3', name: 'R3', type: 'treasure', width: 10, height: 10, position: { x: 30, y: 0 }, entities: [], connections: [] },
      ],
      exitRoom: 'r2',
    });
    const errors = validateLayout(layout);
    expect(errors.some((e) => e.includes('orphaned'))).toBe(true);
  });

  it('detects connections to unknown rooms', () => {
    const layout = minimalLayout({
      rooms: [
        { id: 'r1', name: 'R1', type: 'start', width: 10, height: 10, position: { x: 0, y: 0 }, entities: [], connections: ['ghost'] },
      ],
    });
    const errors = validateLayout(layout);
    expect(errors.some((e) => e.includes('unknown room'))).toBe(true);
  });

  it('detects entities outside room bounds', () => {
    const layout = minimalLayout({
      rooms: [
        {
          id: 'r1',
          name: 'R1',
          type: 'start',
          width: 10,
          height: 10,
          position: { x: 0, y: 0 },
          entities: [{ entityType: 'cube', position: { x: 20, y: 0, z: 0 } }],
          connections: [],
        },
      ],
    });
    const errors = validateLayout(layout);
    expect(errors.some((e) => e.includes('outside room bounds'))).toBe(true);
  });

  it('accepts entities within room bounds', () => {
    const layout = minimalLayout({
      rooms: [
        {
          id: 'r1',
          name: 'R1',
          type: 'start',
          width: 10,
          height: 10,
          position: { x: 0, y: 0 },
          entities: [{ entityType: 'cube', position: { x: 3, y: 0, z: 3 } }],
          connections: [],
        },
      ],
    });
    const errors = validateLayout(layout);
    expect(errors).toEqual([]);
  });
});

// ===== Constraint Application =====

describe('applyConstraints', () => {
  function getLinearLayout(): LevelLayout {
    return LEVEL_TEMPLATES.linear.generate();
  }

  it('adjusts room count upward', () => {
    const layout = getLinearLayout();
    const original = layout.rooms.length;
    const result = applyConstraints(layout, [{ type: 'room_count', value: original + 3 }]);
    expect(result.rooms.length).toBe(original + 3);
  });

  // Regression: PF-770 — adjustRoomCount must insert rooms on the main path without
  // creating branch detours. The exit room must still only connect back to the room
  // that immediately precedes it, not to the room before the insertion point.
  it('adjustRoomCount inserts rooms linearly without creating branch detours (PF-770)', () => {
    const layout = getLinearLayout();
    const result = applyConstraints(layout, [{ type: 'room_count', value: layout.rooms.length + 2 }]);
    const exitRoom = result.rooms.find((r) => r.id === result.exitRoom);
    // The exit room must have exactly 1 back-connection in a linear layout:
    // it should connect only to the room directly before it, not to any earlier room.
    expect(exitRoom).not.toBeUndefined();
    const exitConnections = exitRoom!.connections;
    // In a linear path the exit room connects back to exactly one preceding room.
    expect(exitConnections).toHaveLength(1);
    // That predecessor must itself connect forward to the exit, forming an unbroken chain.
    const predecessor = result.rooms.find((r) => r.id === exitConnections[0]);
    expect(predecessor).not.toBeUndefined();
    expect(predecessor!.connections).toContain(result.exitRoom);
  });

  it('adjustRoomCount preserves layout validity after expansion (PF-770)', () => {
    const layout = getLinearLayout();
    const result = applyConstraints(layout, [{ type: 'room_count', value: layout.rooms.length + 3 }]);
    const errors = validateLayout(result);
    expect(errors).toEqual([]);
  });

  it('adjustRoomCount does not add extra connections to prevRoom (PF-770)', () => {
    const layout = getLinearLayout();
    const exitRoomId = layout.exitRoom;
    const result = applyConstraints(layout, [{ type: 'room_count', value: layout.rooms.length + 1 }]);
    // The room that was previously the exit's predecessor (now two steps before exit)
    // must NOT still connect to the exit room — the new room is in between.
    const originalPreExit = layout.rooms.find((r) => r.connections.includes(exitRoomId));
    if (originalPreExit) {
      const updatedPreExit = result.rooms.find((r) => r.id === originalPreExit.id);
      expect(updatedPreExit?.connections).not.toContain(exitRoomId);
    }
  });

  it('adjusts room count downward by removing corridors', () => {
    const dungeonLayout = LEVEL_TEMPLATES.dungeon.generate();
    const original = dungeonLayout.rooms.length;
    const corridorCount = dungeonLayout.rooms.filter((r) => r.type === 'corridor').length;
    if (corridorCount > 0) {
      const result = applyConstraints(dungeonLayout, [
        { type: 'room_count', value: original - 1 },
      ]);
      expect(result.rooms.length).toBeLessThanOrEqual(original);
    }
  });

  it('adjusts enemy density', () => {
    const layout = getLinearLayout();
    const result = applyConstraints(layout, [{ type: 'enemy_density', value: 1.0 }]);
    const combatRooms = result.rooms.filter((r) => r.type === 'combat' || r.type === 'boss');
    for (const room of combatRooms) {
      const enemies = room.entities.filter((e) => e.properties?.role === 'enemy_spawn');
      expect(enemies.length).toBeGreaterThan(0);
    }
  });

  it('clamps enemy density to [0, 1]', () => {
    const layout = getLinearLayout();
    const result = applyConstraints(layout, [{ type: 'enemy_density', value: 5.0 }]);
    // Should not crash; density is clamped
    expect(result.rooms.length).toBeGreaterThan(0);
  });

  it('adjusts item placement', () => {
    const layout = getLinearLayout();
    const result = applyConstraints(layout, [{ type: 'item_placement', value: 6 }]);
    const allEntities = result.rooms.flatMap((r) => r.entities);
    const items = allEntities.filter(
      (e) => e.properties?.role === 'health_pickup' || e.properties?.role === 'ammo_pickup',
    );
    expect(items.length).toBeGreaterThan(0);
  });

  it('adjusts path length', () => {
    const layout = getLinearLayout();
    const result = applyConstraints(layout, [{ type: 'path_length', value: 2.0 }]);
    // Positions should be scaled
    const firstRoom = layout.rooms[0];
    const lastRoom = layout.rooms[layout.rooms.length - 1];
    const resultLast = result.rooms[result.rooms.length - 1];
    const resultFirst = result.rooms[0];
    const originalSpan = Math.abs(lastRoom.position.x - firstRoom.position.x);
    const newSpan = Math.abs(resultLast.position.x - resultFirst.position.x);
    expect(newSpan).toBeGreaterThanOrEqual(originalSpan);
  });

  it('adjusts branching factor', () => {
    const layout = LEVEL_TEMPLATES.branching.generate();
    const hubRoom = layout.rooms.find((r) => r.type === 'hub');
    const originalWidth = hubRoom?.width ?? 0;
    const result = applyConstraints(layout, [{ type: 'branching', value: 1.0 }]);
    const resultHub = result.rooms.find((r) => r.type === 'hub');
    expect(resultHub?.width).toBeGreaterThan(originalWidth);
  });

  it('handles invalid constraint values gracefully', () => {
    const layout = getLinearLayout();
    const result = applyConstraints(layout, [
      { type: 'room_count', value: 'invalid' as unknown },
      { type: 'enemy_density', value: null as unknown },
    ]);
    // Should return layout unchanged
    expect(result.rooms.length).toBe(layout.rooms.length);
  });

  it('applies multiple constraints in sequence', () => {
    const layout = getLinearLayout();
    const constraints: LevelConstraint[] = [
      { type: 'enemy_density', value: 0.8 },
      { type: 'item_placement', value: 4 },
    ];
    const result = applyConstraints(layout, constraints);
    const allEntities = result.rooms.flatMap((r) => r.entities);
    const enemies = allEntities.filter((e) => e.properties?.role === 'enemy_spawn');
    const items = allEntities.filter(
      (e) => e.properties?.role === 'health_pickup' || e.properties?.role === 'ammo_pickup',
    );
    expect(enemies.length).toBeGreaterThan(0);
    expect(items.length).toBeGreaterThan(0);
  });
});

// ===== Level to Commands =====

describe('levelToCommands', () => {
  it('generates spawn commands for all rooms', () => {
    const layout = LEVEL_TEMPLATES.linear.generate();
    const commands = levelToCommands(layout);
    expect(commands.length).toBeGreaterThan(0);

    const spawnCommands = commands.filter((c) => c.command === 'spawn_entity');
    // At least one floor + walls per room + root + lights
    expect(spawnCommands.length).toBeGreaterThan(layout.rooms.length * 2);
  });

  it('includes root entity named after the layout', () => {
    const layout = LEVEL_TEMPLATES.arena.generate();
    const commands = levelToCommands(layout);
    const root = commands.find(
      (c) => c.command === 'spawn_entity' && c.payload.name === layout.name,
    );
    expect(root).toBeDefined();
  });

  it('generates corridor connections between rooms', () => {
    const layout = LEVEL_TEMPLATES.linear.generate();
    const commands = levelToCommands(layout);
    const corridors = commands.filter(
      (c) => c.command === 'spawn_entity' && (c.payload.name as string).startsWith('Corridor'),
    );
    expect(corridors.length).toBeGreaterThan(0);
  });

  it('generates wall entities for each room', () => {
    const layout = LEVEL_TEMPLATES.arena.generate();
    const commands = levelToCommands(layout);
    const walls = commands.filter(
      (c) => c.command === 'spawn_entity' && (c.payload.name as string).includes('Wall'),
    );
    // 4 walls per room
    expect(walls.length).toBe(layout.rooms.length * 4);
  });

  it('generates light for each room', () => {
    const layout = LEVEL_TEMPLATES.linear.generate();
    const commands = levelToCommands(layout);
    const lights = commands.filter(
      (c) => c.command === 'spawn_entity' && c.payload.entityType === 'point_light' && (c.payload.name as string).includes('Light'),
    );
    expect(lights.length).toBe(layout.rooms.length);
  });

  it('positions entities relative to room position', () => {
    const layout = LEVEL_TEMPLATES.linear.generate();
    const commands = levelToCommands(layout);
    // Get the combat room and its entities
    const combatRoom = layout.rooms.find((r) => r.type === 'combat');
    if (combatRoom && combatRoom.entities.length > 0) {
      const entity = combatRoom.entities[0];
      const expectedX = combatRoom.position.x + entity.position.x;
      const spawnCmd = commands.find(
        (c) =>
          c.command === 'spawn_entity' &&
          Array.isArray(c.payload.position) &&
          (c.payload.position as number[])[0] === expectedX,
      );
      expect(spawnCmd).toBeDefined();
    }
  });
});

// ===== Parse AI Response =====

describe('parseLevelResponse', () => {
  it('parses valid JSON', () => {
    const json = JSON.stringify({
      name: 'Test Level',
      theme: 'cave',
      rooms: [
        { id: 'r1', name: 'Start', type: 'start', width: 10, height: 10, position: { x: 0, y: 0 }, entities: [], connections: [] },
      ],
      startRoom: 'r1',
      exitRoom: 'r1',
      difficulty: 5,
      estimatedPlaytime: '5 min',
    });
    const layout = parseLevelResponse(json);
    expect(layout.name).toBe('Test Level');
    expect(layout.rooms).toHaveLength(1);
  });

  it('extracts JSON from markdown code blocks', () => {
    const raw = `Here is the level:
\`\`\`json
{
  "name": "Cave Level",
  "rooms": [{ "id": "r1", "name": "Start" }],
  "startRoom": "r1",
  "exitRoom": "r1"
}
\`\`\`
Hope you like it!`;
    const layout = parseLevelResponse(raw);
    expect(layout.name).toBe('Cave Level');
  });

  it('fills in default values for missing fields', () => {
    const json = JSON.stringify({
      name: 'Minimal',
      rooms: [{ id: 'r1' }],
      startRoom: 'r1',
      exitRoom: 'r1',
    });
    const layout = parseLevelResponse(json);
    expect(layout.theme).toBe('default');
    expect(layout.difficulty).toBe(5);
    expect(layout.rooms[0].width).toBe(10);
    expect(layout.rooms[0].height).toBe(10);
    expect(layout.rooms[0].type).toBe('combat');
  });

  it('throws on invalid JSON', () => {
    expect(() => parseLevelResponse('not json at all')).toThrow('Failed to parse');
  });

  it('throws on missing name', () => {
    expect(() => parseLevelResponse(JSON.stringify({ rooms: [], startRoom: 'r1', exitRoom: 'r1' }))).toThrow('name');
  });

  it('throws on missing rooms', () => {
    expect(() => parseLevelResponse(JSON.stringify({ name: 'T', startRoom: 'r1', exitRoom: 'r1' }))).toThrow('rooms');
  });

  it('throws on missing startRoom', () => {
    expect(() => parseLevelResponse(JSON.stringify({ name: 'T', rooms: [], exitRoom: 'r1' }))).toThrow('startRoom');
  });

  it('throws on missing exitRoom', () => {
    expect(() => parseLevelResponse(JSON.stringify({ name: 'T', rooms: [], startRoom: 'r1' }))).toThrow('exitRoom');
  });

  it('parses rooms with entities', () => {
    const json = JSON.stringify({
      name: 'Test',
      rooms: [{
        id: 'r1',
        name: 'Room',
        entities: [{ entityType: 'cube', position: { x: 1, y: 2, z: 3 }, properties: { role: 'enemy' } }],
      }],
      startRoom: 'r1',
      exitRoom: 'r1',
    });
    const layout = parseLevelResponse(json);
    expect(layout.rooms[0].entities).toHaveLength(1);
    expect(layout.rooms[0].entities[0].entityType).toBe('cube');
    expect(layout.rooms[0].entities[0].position).toEqual({ x: 1, y: 2, z: 3 });
    expect(layout.rooms[0].entities[0].properties?.role).toBe('enemy');
  });
});

// ===== Generate Level (integration) =====

describe('generateLevel', () => {
  it('generates a layout from arena description', async () => {
    const layout = await generateLevel('arena with wave-based enemies');
    expect(layout.rooms.length).toBeGreaterThan(0);
    const errors = validateLayout(layout);
    expect(errors).toEqual([]);
  });

  it('generates a layout from branching description', async () => {
    const layout = await generateLevel('hub with multiple wings');
    expect(layout.rooms.length).toBeGreaterThan(1);
  });

  it('generates a layout from metroidvania description', async () => {
    const layout = await generateLevel('locked doors and keys');
    expect(layout.rooms.some((r) => r.entities.some((e) => e.properties?.role === 'key'))).toBe(true);
  });

  it('generates a layout from dungeon description', async () => {
    const layout = await generateLevel('random dungeon crawl');
    expect(layout.rooms.length).toBeGreaterThan(2);
  });

  it('defaults to linear for generic description', async () => {
    const layout = await generateLevel('a simple level');
    expect(layout.rooms.length).toBeGreaterThan(0);
  });

  it('overrides name from short description', async () => {
    const layout = await generateLevel('My Cool Level');
    expect(layout.name).toBe('My Cool Level');
  });

  it('applies constraints to generated layout', async () => {
    const layout = await generateLevel('dungeon', [
      { type: 'enemy_density', value: 1.0 },
    ]);
    const combatRooms = layout.rooms.filter((r) => r.type === 'combat' || r.type === 'boss');
    for (const room of combatRooms) {
      const enemies = room.entities.filter((e) => e.properties?.role === 'enemy_spawn');
      expect(enemies.length).toBeGreaterThan(0);
    }
  });

  it('produces a valid layout regardless of input', async () => {
    const layout = await generateLevel('completely nonsensical input xyz 123');
    const errors = validateLayout(layout);
    expect(errors).toEqual([]);
  });
});
