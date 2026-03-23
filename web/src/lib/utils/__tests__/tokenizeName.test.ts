import { describe, it, expect } from 'vitest';
import { tokenizeName } from '../tokenizeName';

describe('tokenizeName', () => {
  // --- snake_case ---
  it('splits snake_case names', () => {
    expect(tokenizeName('Player_Character_01')).toEqual(['player', 'character', '01']);
  });

  it('splits simple snake_case', () => {
    expect(tokenizeName('red_cube')).toEqual(['red', 'cube']);
  });

  // --- PascalCase ---
  it('splits PascalCase names', () => {
    expect(tokenizeName('RedDragon')).toEqual(['red', 'dragon']);
  });

  it('splits multi-word PascalCase', () => {
    expect(tokenizeName('EnemySpawner')).toEqual(['enemy', 'spawner']);
  });

  // --- camelCase ---
  it('splits camelCase names', () => {
    expect(tokenizeName('playerHealth')).toEqual(['player', 'health']);
  });

  it('splits camelCase starting lowercase', () => {
    expect(tokenizeName('collectibleCoin')).toEqual(['collectible', 'coin']);
  });

  // --- kebab-case ---
  it('splits kebab-case names', () => {
    expect(tokenizeName('boss-enemy')).toEqual(['boss', 'enemy']);
  });

  // --- spaces ---
  it('splits space-separated names', () => {
    expect(tokenizeName('Big Rock')).toEqual(['big', 'rock']);
  });

  // --- mixed conventions ---
  it('splits mixed snake_case + PascalCase', () => {
    expect(tokenizeName('EnemySpawner_01')).toEqual(['enemy', 'spawner', '01']);
  });

  it('splits mixed camelCase + numbers', () => {
    expect(tokenizeName('platform3Jump')).toEqual(['platform', '3', 'jump']);
  });

  // --- numeric suffixes ---
  it('preserves numeric suffixes as separate tokens', () => {
    expect(tokenizeName('Cube_01')).toEqual(['cube', '01']);
  });

  it('preserves standalone numbers', () => {
    expect(tokenizeName('Enemy3')).toEqual(['enemy', '3']);
  });

  // --- single token ---
  it('returns single token for plain lowercase name', () => {
    expect(tokenizeName('player')).toEqual(['player']);
  });

  it('lowercases all tokens', () => {
    expect(tokenizeName('PLAYER')).toEqual(['player']);
  });

  // --- edge cases ---
  it('returns empty array for empty string', () => {
    expect(tokenizeName('')).toEqual([]);
  });

  it('returns empty array for null-like input', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(tokenizeName(null as any)).toEqual([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(tokenizeName(undefined as any)).toEqual([]);
  });

  it('handles consecutive underscores/separators', () => {
    expect(tokenizeName('Player__Wall')).toEqual(['player', 'wall']);
  });

  it('handles leading/trailing separators', () => {
    expect(tokenizeName('_player_')).toEqual(['player']);
  });

  it('handles dotted names', () => {
    expect(tokenizeName('player.body.mesh')).toEqual(['player', 'body', 'mesh']);
  });

  // --- acronyms ---
  it('handles acronyms followed by PascalCase word', () => {
    const tokens = tokenizeName('HTTPSRequest');
    // Expect "https" and "request" to be present (acronym boundary split)
    expect(tokens).toContain('request');
    expect(tokens.some((t) => t.includes('https') || t === 'http' || t === 's')).toBe(true);
  });

  // --- common game entity names ---
  it('handles common game entity naming patterns', () => {
    expect(tokenizeName('PlayerCharacterController')).toEqual([
      'player',
      'character',
      'controller',
    ]);
    expect(tokenizeName('CollectibleCoin_03')).toEqual(['collectible', 'coin', '03']);
    expect(tokenizeName('Ground_Platform_Wide')).toEqual(['ground', 'platform', 'wide']);
  });
});
