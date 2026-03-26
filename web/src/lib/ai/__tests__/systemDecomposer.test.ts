import { describe, it, expect } from 'vitest';
import {
  decomposeIntoSystems,
  getSystemLabel,
  SYSTEM_CATEGORIES,
  type SystemCategory,
} from '../systemDecomposer';

describe('decomposeIntoSystems', () => {
  it('detects movement:walk+jump for platformer descriptions', () => {
    const result = decomposeIntoSystems('a platformer where you jump over obstacles');
    const movement = result.systems.find(s => s.category === 'movement');
    expect(movement).toBeDefined();
    expect(movement!.type).toBe('walk+jump');
    expect(movement!.matchedKeywords).toContain('platformer');
  });

  it('detects challenge:puzzle for puzzle game descriptions', () => {
    const result = decomposeIntoSystems('a brain puzzle with logic riddles');
    const challenge = result.systems.find(s => s.category === 'challenge');
    expect(challenge).toBeDefined();
    expect(challenge!.type).toBe('puzzle');
  });

  it('detects multiple systems from a complex description', () => {
    const result = decomposeIntoSystems(
      'a platformer RPG with combat, inventory, and pixel art enemies'
    );
    const categories = result.systems.map(s => s.category);
    expect(categories).toContain('movement');
    expect(categories).toContain('progression');
    expect(categories).toContain('challenge');
    expect(categories).toContain('entities');
    expect(categories).toContain('visual');
  });

  it('detects challenge:ranged-combat for shooter descriptions', () => {
    const result = decomposeIntoSystems('a first-person shooter with guns and bullets');
    const challenge = result.systems.find(s => s.category === 'challenge');
    expect(challenge).toBeDefined();
    expect(challenge!.type).toBe('ranged-combat');
  });

  it('detects narrative:horror-atmosphere for horror descriptions', () => {
    const result = decomposeIntoSystems('a haunted castle with spooky ghosts');
    const narrative = result.systems.find(s => s.category === 'narrative');
    expect(narrative).toBeDefined();
    expect(narrative!.type).toBe('horror-atmosphere');
  });

  it('detects movement:vehicle for racing descriptions', () => {
    const result = decomposeIntoSystems('a kart racing game on a track');
    const movement = result.systems.find(s => s.category === 'movement');
    expect(movement).toBeDefined();
    expect(movement!.type).toBe('vehicle');
  });

  it('detects challenge:tower-defense for strategy descriptions', () => {
    const result = decomposeIntoSystems('a tower defense strategy game');
    const challenge = result.systems.find(s => s.category === 'challenge');
    expect(challenge).toBeDefined();
    expect(challenge!.type).toBe('tower-defense');
  });

  it('detects movement:auto-run for runner descriptions', () => {
    const result = decomposeIntoSystems('an endless runner auto-runner game');
    const movement = result.systems.find(s => s.category === 'movement');
    expect(movement).toBeDefined();
    expect(movement!.type).toBe('auto-run');
  });

  it('returns defaults for vague descriptions', () => {
    const result = decomposeIntoSystems('a game with things in it');
    // Should always include input and camera defaults
    expect(result.systems.some(s => s.category === 'input')).toBe(true);
    expect(result.systems.some(s => s.category === 'camera')).toBe(true);
  });

  it('is case-insensitive', () => {
    const result = decomposeIntoSystems('A PLATFORMER GAME');
    expect(result.systems.some(s => s.category === 'movement')).toBe(true);
  });

  it('detects highest-confidence system when multiple keyword groups match', () => {
    const result = decomposeIntoSystems('a platform jump game where you also shoot');
    const movement = result.systems.find(s => s.category === 'movement');
    // 'platformer' NOT in the string but 'platform' and 'jump' are
    expect(movement).toBeDefined();
    expect(movement!.type).toBe('walk+jump');
  });

  it('marks systems with 2+ keyword matches as core priority', () => {
    const result = decomposeIntoSystems('a platformer jump side-scroller game');
    const movement = result.systems.find(s => s.category === 'movement');
    expect(movement).toBeDefined();
    expect(movement!.priority).toBe('core');
  });

  it('marks systems with 1 keyword match as secondary priority', () => {
    const result = decomposeIntoSystems('a game with physics');
    const physics = result.systems.find(s => s.category === 'physics');
    expect(physics).toBeDefined();
    expect(physics!.priority).toBe('secondary');
  });

  it('sorts systems by confidence (most keywords first)', () => {
    const result = decomposeIntoSystems(
      'a platformer jump side-scroller with some physics'
    );
    // movement should have more matches than physics
    const movementIdx = result.systems.findIndex(s => s.category === 'movement');
    const physicsIdx = result.systems.findIndex(s => s.category === 'physics');
    expect(movementIdx).toBeLessThan(physicsIdx);
  });

  it('provides a summary string', () => {
    const result = decomposeIntoSystems('a platformer game');
    expect(result.summary).toContain('Detected');
    expect(result.summary).toContain('movement');
  });

  it('always includes input and camera defaults', () => {
    const result = decomposeIntoSystems('something completely abstract');
    const categories = result.systems.map(s => s.category);
    expect(categories).toContain('input');
    expect(categories).toContain('camera');
  });

  it('does not duplicate input/camera when already detected', () => {
    const result = decomposeIntoSystems('a top-down game with touch controls');
    const inputCount = result.systems.filter(s => s.category === 'input').length;
    const cameraCount = result.systems.filter(s => s.category === 'camera').length;
    expect(inputCount).toBe(1);
    expect(cameraCount).toBe(1);
  });
});

describe('getSystemLabel', () => {
  it('returns "custom game" when no core systems detected', () => {
    const label = getSystemLabel({ systems: [], summary: '' });
    expect(label).toBe('custom game');
  });

  it('returns a label from core systems', () => {
    const label = getSystemLabel({
      systems: [
        { category: 'movement', type: 'walk+jump', priority: 'core', matchedKeywords: ['platformer'] },
        { category: 'challenge', type: 'combat', priority: 'core', matchedKeywords: ['combat'] },
      ],
      summary: '',
    });
    expect(label).toBe('walk & jump + combat');
  });

  it('only includes core priority systems in label', () => {
    const label = getSystemLabel({
      systems: [
        { category: 'movement', type: 'walk+jump', priority: 'core', matchedKeywords: ['platformer'] },
        { category: 'physics', type: 'rigid-body', priority: 'secondary', matchedKeywords: ['physics'] },
      ],
      summary: '',
    });
    expect(label).toBe('walk & jump');
    expect(label).not.toContain('physics');
  });
});

describe('SYSTEM_CATEGORIES', () => {
  it('exports all 12 categories', () => {
    expect(SYSTEM_CATEGORIES).toHaveLength(12);
  });

  it('includes expected categories', () => {
    const expected: SystemCategory[] = [
      'movement', 'input', 'camera', 'world', 'challenge',
      'entities', 'progression', 'feedback', 'narrative',
      'audio', 'visual', 'physics',
    ];
    for (const cat of expected) {
      expect(SYSTEM_CATEGORIES).toContain(cat);
    }
  });
});
