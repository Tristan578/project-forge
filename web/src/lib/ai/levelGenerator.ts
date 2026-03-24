/**
 * Procedural level generator with constraint-based layout.
 *
 * Generates structured level layouts from descriptions or templates,
 * then converts them to engine spawn commands.
 */

// ===== Types =====

export interface PlacedEntity {
  entityType: string;
  position: { x: number; y: number; z: number };
  properties?: Record<string, unknown>;
}

export type RoomType =
  | 'start'
  | 'combat'
  | 'puzzle'
  | 'treasure'
  | 'boss'
  | 'corridor'
  | 'hub';

export interface LevelRoom {
  id: string;
  name: string;
  type: RoomType;
  width: number;
  height: number;
  position: { x: number; y: number };
  entities: PlacedEntity[];
  connections: string[];
}

export interface LevelLayout {
  name: string;
  theme: string;
  rooms: LevelRoom[];
  startRoom: string;
  exitRoom: string;
  difficulty: number;
  estimatedPlaytime: string;
}

export type LevelConstraintType =
  | 'room_count'
  | 'enemy_density'
  | 'item_placement'
  | 'path_length'
  | 'branching';

export interface LevelConstraint {
  type: LevelConstraintType;
  value: unknown;
}

export interface EngineCommand {
  command: string;
  payload: Record<string, unknown>;
}

// ===== Templates =====

function makeRoom(
  id: string,
  name: string,
  type: RoomType,
  width: number,
  height: number,
  x: number,
  y: number,
  connections: string[],
  entities: PlacedEntity[] = [],
): LevelRoom {
  return { id, name, type, width, height, position: { x, y }, entities, connections };
}

function linearTemplate(): LevelLayout {
  const rooms: LevelRoom[] = [
    makeRoom('r1', 'Entrance', 'start', 10, 10, 0, 0, ['r2'], [
      { entityType: 'point_light', position: { x: 0, y: 3, z: 0 } },
    ]),
    makeRoom('r2', 'Combat Arena', 'combat', 14, 14, 15, 0, ['r1', 'r3'], [
      { entityType: 'cube', position: { x: -3, y: 0.5, z: 0 }, properties: { role: 'enemy_spawn' } },
      { entityType: 'cube', position: { x: 3, y: 0.5, z: 0 }, properties: { role: 'enemy_spawn' } },
    ]),
    makeRoom('r3', 'Puzzle Chamber', 'puzzle', 12, 12, 34, 0, ['r2', 'r4'], [
      { entityType: 'sphere', position: { x: 0, y: 1, z: 0 }, properties: { role: 'puzzle_orb' } },
    ]),
    makeRoom('r4', 'Boss Lair', 'boss', 18, 18, 51, 0, ['r3', 'r5'], [
      { entityType: 'cube', position: { x: 0, y: 1.5, z: 0 }, properties: { role: 'boss_spawn' } },
    ]),
    makeRoom('r5', 'Exit', 'treasure', 8, 8, 74, 0, ['r4'], [
      { entityType: 'sphere', position: { x: 0, y: 1, z: 0 }, properties: { role: 'treasure_chest' } },
    ]),
  ];
  return {
    name: 'Linear Dungeon',
    theme: 'dungeon',
    rooms,
    startRoom: 'r1',
    exitRoom: 'r5',
    difficulty: 5,
    estimatedPlaytime: '5-8 min',
  };
}

function branchingTemplate(): LevelLayout {
  const rooms: LevelRoom[] = [
    makeRoom('hub', 'Central Hub', 'hub', 16, 16, 0, 0, ['wing_a', 'wing_b', 'wing_c']),
    makeRoom('wing_a', 'East Wing', 'combat', 12, 10, 20, 0, ['hub', 'reward_a'], [
      { entityType: 'cube', position: { x: 0, y: 0.5, z: -2 }, properties: { role: 'enemy_spawn' } },
    ]),
    makeRoom('reward_a', 'East Vault', 'treasure', 8, 8, 37, 0, ['wing_a'], [
      { entityType: 'sphere', position: { x: 0, y: 1, z: 0 }, properties: { role: 'treasure_chest' } },
    ]),
    makeRoom('wing_b', 'North Wing', 'puzzle', 12, 10, 0, 20, ['hub', 'reward_b'], [
      { entityType: 'sphere', position: { x: 0, y: 1, z: 0 }, properties: { role: 'puzzle_orb' } },
    ]),
    makeRoom('reward_b', 'North Vault', 'treasure', 8, 8, 0, 35, ['wing_b'], [
      { entityType: 'sphere', position: { x: 0, y: 1, z: 0 }, properties: { role: 'treasure_chest' } },
    ]),
    makeRoom('wing_c', 'West Wing', 'combat', 12, 10, -20, 0, ['hub', 'reward_c'], [
      { entityType: 'cube', position: { x: -2, y: 0.5, z: 0 }, properties: { role: 'enemy_spawn' } },
      { entityType: 'cube', position: { x: 2, y: 0.5, z: 0 }, properties: { role: 'enemy_spawn' } },
    ]),
    makeRoom('reward_c', 'West Vault', 'treasure', 8, 8, -37, 0, ['wing_c'], [
      { entityType: 'sphere', position: { x: 0, y: 1, z: 0 }, properties: { role: 'treasure_chest' } },
    ]),
  ];
  return {
    name: 'Branching Hub',
    theme: 'temple',
    rooms,
    startRoom: 'hub',
    exitRoom: 'reward_a',
    difficulty: 6,
    estimatedPlaytime: '8-12 min',
  };
}

function metroidvaniaTemplate(): LevelLayout {
  const rooms: LevelRoom[] = [
    makeRoom('start', 'Starting Room', 'start', 10, 10, 0, 0, ['hall_a']),
    makeRoom('hall_a', 'Main Hall', 'corridor', 8, 20, 15, 0, ['start', 'locked_a', 'key_room']),
    makeRoom('key_room', 'Key Chamber', 'puzzle', 10, 10, 15, 25, ['hall_a'], [
      { entityType: 'sphere', position: { x: 0, y: 1, z: 0 }, properties: { role: 'key', keyId: 'key_a' } },
    ]),
    makeRoom('locked_a', 'Locked Gate', 'corridor', 8, 8, 28, 0, ['hall_a', 'combat_a'], [
      { entityType: 'cube', position: { x: 0, y: 1.5, z: 0 }, properties: { role: 'locked_door', requiredKey: 'key_a' } },
    ]),
    makeRoom('combat_a', 'Guard Room', 'combat', 14, 14, 41, 0, ['locked_a', 'boss'], [
      { entityType: 'cube', position: { x: -3, y: 0.5, z: 0 }, properties: { role: 'enemy_spawn' } },
      { entityType: 'cube', position: { x: 3, y: 0.5, z: 0 }, properties: { role: 'enemy_spawn' } },
    ]),
    makeRoom('boss', 'Boss Chamber', 'boss', 18, 18, 60, 0, ['combat_a', 'exit'], [
      { entityType: 'cube', position: { x: 0, y: 2, z: 0 }, properties: { role: 'boss_spawn' } },
    ]),
    makeRoom('exit', 'Treasure Room', 'treasure', 10, 10, 83, 0, ['boss'], [
      { entityType: 'sphere', position: { x: 0, y: 1, z: 0 }, properties: { role: 'treasure_chest' } },
    ]),
  ];
  return {
    name: 'Metroidvania Dungeon',
    theme: 'castle',
    rooms,
    startRoom: 'start',
    exitRoom: 'exit',
    difficulty: 7,
    estimatedPlaytime: '10-15 min',
  };
}

function arenaTemplate(): LevelLayout {
  const rooms: LevelRoom[] = [
    makeRoom('arena', 'Battle Arena', 'combat', 30, 30, 0, 0, [], [
      { entityType: 'cube', position: { x: -8, y: 0.5, z: -8 }, properties: { role: 'enemy_spawn', wave: 1 } },
      { entityType: 'cube', position: { x: 8, y: 0.5, z: -8 }, properties: { role: 'enemy_spawn', wave: 1 } },
      { entityType: 'cube', position: { x: -8, y: 0.5, z: 8 }, properties: { role: 'enemy_spawn', wave: 2 } },
      { entityType: 'cube', position: { x: 8, y: 0.5, z: 8 }, properties: { role: 'enemy_spawn', wave: 2 } },
      { entityType: 'cube', position: { x: 0, y: 0.5, z: 0 }, properties: { role: 'enemy_spawn', wave: 3 } },
      { entityType: 'sphere', position: { x: -5, y: 1, z: 0 }, properties: { role: 'health_pickup' } },
      { entityType: 'sphere', position: { x: 5, y: 1, z: 0 }, properties: { role: 'ammo_pickup' } },
      { entityType: 'point_light', position: { x: 0, y: 6, z: 0 } },
    ]),
  ];
  return {
    name: 'Arena',
    theme: 'arena',
    rooms,
    startRoom: 'arena',
    exitRoom: 'arena',
    difficulty: 8,
    estimatedPlaytime: '3-5 min',
  };
}

function dungeonTemplate(): LevelLayout {
  const rooms: LevelRoom[] = [
    makeRoom('entry', 'Entrance', 'start', 10, 10, 0, 0, ['corr1']),
    makeRoom('corr1', 'Corridor 1', 'corridor', 6, 14, 12, 0, ['entry', 'room_a', 'corr2']),
    makeRoom('room_a', 'Side Chamber', 'treasure', 10, 10, 12, 19, ['corr1'], [
      { entityType: 'sphere', position: { x: 0, y: 1, z: 0 }, properties: { role: 'treasure_chest' } },
    ]),
    makeRoom('corr2', 'Corridor 2', 'corridor', 14, 6, 23, 0, ['corr1', 'room_b']),
    makeRoom('room_b', 'Combat Room', 'combat', 14, 14, 42, 0, ['corr2', 'corr3'], [
      { entityType: 'cube', position: { x: -3, y: 0.5, z: 0 }, properties: { role: 'enemy_spawn' } },
      { entityType: 'cube', position: { x: 3, y: 0.5, z: 0 }, properties: { role: 'enemy_spawn' } },
    ]),
    makeRoom('corr3', 'Corridor 3', 'corridor', 6, 14, 61, 0, ['room_b', 'final']),
    makeRoom('final', 'Final Room', 'boss', 16, 16, 72, 0, ['corr3'], [
      { entityType: 'cube', position: { x: 0, y: 1.5, z: 0 }, properties: { role: 'boss_spawn' } },
      { entityType: 'point_light', position: { x: 0, y: 5, z: 0 } },
    ]),
  ];
  return {
    name: 'Random Dungeon',
    theme: 'dungeon',
    rooms,
    startRoom: 'entry',
    exitRoom: 'final',
    difficulty: 6,
    estimatedPlaytime: '6-10 min',
  };
}

export type TemplateId = 'linear' | 'branching' | 'metroidvania' | 'arena' | 'dungeon';

export const LEVEL_TEMPLATES: Record<TemplateId, { name: string; description: string; generate: () => LevelLayout }> = {
  linear: {
    name: 'Linear',
    description: 'Start -> Combat -> Puzzle -> Boss -> Exit',
    generate: linearTemplate,
  },
  branching: {
    name: 'Branching',
    description: 'Hub with 3 wings, each ending in a reward',
    generate: branchingTemplate,
  },
  metroidvania: {
    name: 'Metroidvania',
    description: 'Interconnected rooms with locked doors and keys',
    generate: metroidvaniaTemplate,
  },
  arena: {
    name: 'Arena',
    description: 'Single large room with enemy waves',
    generate: arenaTemplate,
  },
  dungeon: {
    name: 'Dungeon',
    description: 'Random rooms connected by corridors',
    generate: dungeonTemplate,
  },
};

// ===== Validation =====

export function validateLayout(layout: LevelLayout): string[] {
  const errors: string[] = [];

  if (!layout.name) errors.push('Layout must have a name');
  if (!layout.rooms || layout.rooms.length === 0) errors.push('Layout must have at least one room');
  if (!layout.startRoom) errors.push('Layout must have a startRoom');
  if (!layout.exitRoom) errors.push('Layout must have an exitRoom');

  const roomIds = new Set(layout.rooms.map((r) => r.id));

  if (!roomIds.has(layout.startRoom)) {
    errors.push(`startRoom "${layout.startRoom}" does not reference a valid room`);
  }
  if (!roomIds.has(layout.exitRoom)) {
    errors.push(`exitRoom "${layout.exitRoom}" does not reference a valid room`);
  }

  // Check for orphan rooms (no connections to other rooms) except in single-room layouts
  if (layout.rooms.length > 1) {
    for (const room of layout.rooms) {
      if (room.connections.length === 0) {
        // Build a set of rooms that connect TO this room
        const connectedTo = layout.rooms.some(
          (other) => other.id !== room.id && other.connections.includes(room.id),
        );
        if (!connectedTo) {
          errors.push(`Room "${room.id}" is orphaned (no connections to or from it)`);
        }
      }
    }
  }

  // Check connections reference valid rooms
  for (const room of layout.rooms) {
    for (const connId of room.connections) {
      if (!roomIds.has(connId)) {
        errors.push(`Room "${room.id}" connects to unknown room "${connId}"`);
      }
    }
  }

  // Check entities are within room bounds
  for (const room of layout.rooms) {
    const halfW = room.width / 2;
    const halfH = room.height / 2;
    for (const entity of room.entities) {
      if (
        Math.abs(entity.position.x) > halfW ||
        Math.abs(entity.position.z) > halfH
      ) {
        errors.push(
          `Entity "${entity.entityType}" in room "${room.id}" at (${entity.position.x}, ${entity.position.z}) is outside room bounds (${room.width}x${room.height})`,
        );
      }
    }
  }

  // Check difficulty range
  if (layout.difficulty < 1 || layout.difficulty > 10) {
    errors.push('Difficulty must be between 1 and 10');
  }

  return errors;
}

// ===== Constraint Application =====

export function applyConstraints(
  layout: LevelLayout,
  constraints: LevelConstraint[],
): LevelLayout {
  let result = { ...layout, rooms: layout.rooms.map((r) => ({ ...r, entities: [...r.entities] })) };

  for (const constraint of constraints) {
    switch (constraint.type) {
      case 'room_count': {
        const targetCount = constraint.value as number;
        if (typeof targetCount !== 'number' || targetCount < 1) break;
        result = adjustRoomCount(result, targetCount);
        break;
      }
      case 'enemy_density': {
        const density = constraint.value as number;
        if (typeof density !== 'number') break;
        result = adjustEnemyDensity(result, Math.max(0, Math.min(1, density)));
        break;
      }
      case 'item_placement': {
        const itemCount = constraint.value as number;
        if (typeof itemCount !== 'number' || itemCount < 0) break;
        result = adjustItemPlacement(result, itemCount);
        break;
      }
      case 'path_length': {
        const pathLen = constraint.value as number;
        if (typeof pathLen !== 'number') break;
        result = adjustPathLength(result, pathLen);
        break;
      }
      case 'branching': {
        const branchFactor = constraint.value as number;
        if (typeof branchFactor !== 'number') break;
        // Branching adjusts room sizes — wider rooms for more branching
        for (const room of result.rooms) {
          if (room.type === 'hub' || room.type === 'corridor') {
            room.width = Math.round(room.width * (1 + branchFactor * 0.3));
            room.height = Math.round(room.height * (1 + branchFactor * 0.3));
          }
        }
        break;
      }
    }
  }

  return result;
}

function adjustRoomCount(layout: LevelLayout, targetCount: number): LevelLayout {
  const rooms = [...layout.rooms];
  // If we need more rooms, insert combat rooms on the main path before the exit
  while (rooms.length < targetCount) {
    const exitIdx = rooms.findIndex((r) => r.id === layout.exitRoom);
    const insertIdx = exitIdx > 0 ? exitIdx : rooms.length;
    const newId = `gen_room_${rooms.length}`;
    const prevRoom = rooms[insertIdx - 1] ?? rooms[0];
    const nextRoom = rooms[insertIdx] ?? null;
    const newRoom = makeRoom(
      newId,
      `Room ${rooms.length + 1}`,
      'combat',
      12,
      12,
      prevRoom.position.x + prevRoom.width + 5,
      prevRoom.position.y,
      [],
    );
    // Wire new room into the linear chain: prevRoom <-> newRoom <-> nextRoom
    newRoom.connections.push(prevRoom.id);
    // Remove the forward link from prevRoom to nextRoom (if any) and replace with newRoom
    if (nextRoom) {
      const fwdIdx = prevRoom.connections.indexOf(nextRoom.id);
      if (fwdIdx !== -1) {
        prevRoom.connections.splice(fwdIdx, 1);
      }
      // Remove the back link from nextRoom to prevRoom and replace with newRoom
      const backIdx = nextRoom.connections.indexOf(prevRoom.id);
      if (backIdx !== -1) {
        nextRoom.connections.splice(backIdx, 1);
      }
      nextRoom.connections.push(newId);
      newRoom.connections.push(nextRoom.id);
    }
    prevRoom.connections.push(newId);
    rooms.splice(insertIdx, 0, newRoom);
  }
  // If we need fewer rooms, remove corridor rooms first
  while (rooms.length > targetCount && rooms.length > 2) {
    const corridorIdx = rooms.findIndex(
      (r) => r.type === 'corridor' && r.id !== layout.startRoom && r.id !== layout.exitRoom,
    );
    if (corridorIdx === -1) break;
    const removed = rooms[corridorIdx];
    // Reconnect neighbors
    for (const room of rooms) {
      const idx = room.connections.indexOf(removed.id);
      if (idx !== -1) {
        room.connections.splice(idx, 1);
        // Connect to the removed room's neighbors
        for (const conn of removed.connections) {
          if (conn !== room.id && !room.connections.includes(conn)) {
            room.connections.push(conn);
          }
        }
      }
    }
    rooms.splice(corridorIdx, 1);
  }
  return { ...layout, rooms };
}

function adjustEnemyDensity(layout: LevelLayout, density: number): LevelLayout {
  const rooms = layout.rooms.map((room) => {
    if (room.type !== 'combat' && room.type !== 'boss') return room;
    const existingEnemies = room.entities.filter(
      (e) => e.properties?.role === 'enemy_spawn' || e.properties?.role === 'boss_spawn',
    );
    const baseCount = Math.max(1, existingEnemies.length);
    const targetCount = Math.max(1, Math.round(baseCount * (density * 2)));

    const newEntities = room.entities.filter(
      (e) => e.properties?.role !== 'enemy_spawn',
    );

    const halfW = room.width / 2 - 1;
    const halfH = room.height / 2 - 1;
    for (let i = 0; i < targetCount; i++) {
      const angle = (i / targetCount) * Math.PI * 2;
      const radius = Math.min(halfW, halfH) * 0.6;
      newEntities.push({
        entityType: 'cube',
        position: {
          x: Math.round(Math.cos(angle) * radius * 10) / 10,
          y: 0.5,
          z: Math.round(Math.sin(angle) * radius * 10) / 10,
        },
        properties: { role: 'enemy_spawn' },
      });
    }

    return { ...room, entities: newEntities };
  });
  return { ...layout, rooms };
}

function adjustItemPlacement(layout: LevelLayout, itemCount: number): LevelLayout {
  // Distribute items across non-start rooms
  const eligibleRooms = layout.rooms.filter((r) => r.id !== layout.startRoom);
  if (eligibleRooms.length === 0) return layout;

  const itemsPerRoom = Math.max(1, Math.ceil(itemCount / eligibleRooms.length));

  const rooms = layout.rooms.map((room) => {
    if (room.id === layout.startRoom) return room;
    const newEntities = room.entities.filter(
      (e) =>
        e.properties?.role !== 'health_pickup' &&
        e.properties?.role !== 'ammo_pickup',
    );
    for (let i = 0; i < itemsPerRoom; i++) {
      const halfW = room.width / 2 - 1;
      const halfH = room.height / 2 - 1;
      newEntities.push({
        entityType: 'sphere',
        position: {
          x: Math.round(((i % 3) - 1) * halfW * 0.5 * 10) / 10,
          y: 1,
          z: Math.round((Math.floor(i / 3) - 0.5) * halfH * 0.5 * 10) / 10,
        },
        properties: { role: i % 2 === 0 ? 'health_pickup' : 'ammo_pickup' },
      });
    }
    return { ...room, entities: newEntities };
  });

  return { ...layout, rooms };
}

function adjustPathLength(layout: LevelLayout, pathMultiplier: number): LevelLayout {
  // Scale room spacing by path multiplier
  const rooms = layout.rooms.map((room) => ({
    ...room,
    position: {
      x: Math.round(room.position.x * pathMultiplier),
      y: Math.round(room.position.y * pathMultiplier),
    },
  }));
  return { ...layout, rooms };
}

// ===== Level to Engine Commands =====

export function levelToCommands(layout: LevelLayout): EngineCommand[] {
  const commands: EngineCommand[] = [];

  // Create a root entity for the level
  commands.push({
    command: 'spawn_entity',
    payload: {
      entityType: 'cube',
      name: layout.name,
      position: [0, 0, 0],
    },
  });

  for (const room of layout.rooms) {
    // Create floor plane for each room
    commands.push({
      command: 'spawn_entity',
      payload: {
        entityType: 'plane',
        name: `${room.name} Floor`,
        position: [room.position.x, 0, room.position.y],
      },
    });

    // Scale floor to room dimensions (plane is 2x2 base)
    commands.push({
      command: 'update_transform',
      payload: {
        // entityId will be resolved at execution time
        name: `${room.name} Floor`,
        scale: [room.width / 2, 1, room.height / 2],
      },
    });

    // Add room walls (4 walls per room)
    const halfW = room.width / 2;
    const halfH = room.height / 2;
    const wallHeight = 3;

    const walls = [
      { name: 'N Wall', pos: [room.position.x, wallHeight / 2, room.position.y - halfH], scale: [halfW, wallHeight / 2, 0.15] },
      { name: 'S Wall', pos: [room.position.x, wallHeight / 2, room.position.y + halfH], scale: [halfW, wallHeight / 2, 0.15] },
      { name: 'E Wall', pos: [room.position.x + halfW, wallHeight / 2, room.position.y], scale: [0.15, wallHeight / 2, halfH] },
      { name: 'W Wall', pos: [room.position.x - halfW, wallHeight / 2, room.position.y], scale: [0.15, wallHeight / 2, halfH] },
    ];

    for (const wall of walls) {
      commands.push({
        command: 'spawn_entity',
        payload: {
          entityType: 'cube',
          name: `${room.name} ${wall.name}`,
          position: wall.pos,
        },
      });
      commands.push({
        command: 'update_transform',
        payload: {
          name: `${room.name} ${wall.name}`,
          scale: wall.scale,
        },
      });
    }

    // Add light to each room
    commands.push({
      command: 'spawn_entity',
      payload: {
        entityType: 'point_light',
        name: `${room.name} Light`,
        position: [room.position.x, 4, room.position.y],
      },
    });

    // Place entities in the room (offset by room position)
    for (let i = 0; i < room.entities.length; i++) {
      const entity = room.entities[i];
      const role = (entity.properties?.role as string) ?? entity.entityType;
      commands.push({
        command: 'spawn_entity',
        payload: {
          entityType: entity.entityType,
          name: `${room.name} ${role} ${i}`,
          position: [
            room.position.x + entity.position.x,
            entity.position.y,
            room.position.y + entity.position.z,
          ],
        },
      });
    }
  }

  // Create corridor connections between rooms
  for (const room of layout.rooms) {
    for (const connId of room.connections) {
      const target = layout.rooms.find((r) => r.id === connId);
      if (!target) continue;
      // Only create corridor in one direction (lower id to higher id)
      if (room.id >= connId) continue;

      const midX = (room.position.x + target.position.x) / 2;
      const midY = (room.position.y + target.position.y) / 2;

      commands.push({
        command: 'spawn_entity',
        payload: {
          entityType: 'plane',
          name: `Corridor ${room.name}-${target.name}`,
          position: [midX, 0.01, midY],
        },
      });

      const dx = Math.abs(target.position.x - room.position.x);
      const dy = Math.abs(target.position.y - room.position.y);
      const corridorLength = Math.max(dx, dy) / 2;
      const isHorizontal = dx > dy;

      commands.push({
        command: 'update_transform',
        payload: {
          name: `Corridor ${room.name}-${target.name}`,
          scale: isHorizontal
            ? [corridorLength / 2, 1, 1.5]
            : [1.5, 1, corridorLength / 2],
        },
      });
    }
  }

  return commands;
}

// ===== AI Response Parsing =====

export function parseLevelResponse(raw: string): LevelLayout {
  // Try to extract JSON from markdown code blocks or raw JSON
  let jsonStr = raw;

  const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error('Failed to parse level response as JSON');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Level response is not an object');
  }

  const obj = parsed as Record<string, unknown>;

  // Validate required fields
  if (typeof obj.name !== 'string') throw new Error('Missing or invalid "name" field');
  if (!Array.isArray(obj.rooms)) throw new Error('Missing or invalid "rooms" array');
  if (typeof obj.startRoom !== 'string') throw new Error('Missing or invalid "startRoom" field');
  if (typeof obj.exitRoom !== 'string') throw new Error('Missing or invalid "exitRoom" field');

  const rooms: LevelRoom[] = (obj.rooms as Array<Record<string, unknown>>).map((r, i) => {
    const id = (r.id as string) ?? `room_${i}`;
    const name = (r.name as string) ?? `Room ${i + 1}`;
    const type = (r.type as RoomType) ?? 'combat';
    const width = (r.width as number) ?? 10;
    const height = (r.height as number) ?? 10;
    const pos = (r.position as Record<string, number>) ?? { x: i * 15, y: 0 };
    const connections = (r.connections as string[]) ?? [];
    const entities = ((r.entities as Array<Record<string, unknown>>) ?? []).map((e) => ({
      entityType: (e.entityType as string) ?? 'cube',
      position: (e.position as { x: number; y: number; z: number }) ?? { x: 0, y: 0, z: 0 },
      properties: e.properties as Record<string, unknown> | undefined,
    }));

    return {
      id,
      name,
      type,
      width,
      height,
      position: { x: pos.x ?? 0, y: pos.y ?? 0 },
      entities,
      connections,
    };
  });

  return {
    name: obj.name as string,
    theme: (obj.theme as string) ?? 'default',
    rooms,
    startRoom: obj.startRoom as string,
    exitRoom: obj.exitRoom as string,
    difficulty: (obj.difficulty as number) ?? 5,
    estimatedPlaytime: (obj.estimatedPlaytime as string) ?? 'unknown',
  };
}

// ===== Main Generate Function =====

/**
 * Generate a level layout from a text description.
 * Uses template matching for common patterns, returns a structured layout.
 */
export async function generateLevel(
  description: string,
  constraints?: LevelConstraint[],
): Promise<LevelLayout> {
  // Match description to closest template
  const lowerDesc = description.toLowerCase();
  let templateId: TemplateId = 'linear';

  if (lowerDesc.includes('arena') || lowerDesc.includes('wave') || lowerDesc.includes('horde')) {
    templateId = 'arena';
  } else if (lowerDesc.includes('branch') || lowerDesc.includes('hub') || lowerDesc.includes('wing')) {
    templateId = 'branching';
  } else if (
    lowerDesc.includes('metroid') ||
    lowerDesc.includes('key') ||
    lowerDesc.includes('locked') ||
    lowerDesc.includes('backtrack')
  ) {
    templateId = 'metroidvania';
  } else if (
    lowerDesc.includes('dungeon') ||
    lowerDesc.includes('corridor') ||
    lowerDesc.includes('random')
  ) {
    templateId = 'dungeon';
  }

  let layout = LEVEL_TEMPLATES[templateId].generate();

  // Override name from description if it looks like a name
  if (description.length < 60) {
    layout = { ...layout, name: description };
  }

  // Apply constraints if provided
  if (constraints && constraints.length > 0) {
    layout = applyConstraints(layout, constraints);
  }

  return layout;
}
