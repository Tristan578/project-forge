import { describe, it, expect } from 'vitest';
import { detectGameCreationIntent } from '../intentDetector';

describe('detectGameCreationIntent', () => {
  describe('strong game creation signals', () => {
    const cases = [
      'make me a platformer',
      'Make me a game',
      'create a game about space',
      'Build me a shooter',
      'generate a puzzle game',
      'Create a new 3D game',
      'make me a new adventure',
      "let's make a game",
      "Let's build a game about dragons",
      'I want to make a game',
      'I want to create a game',
    ];

    for (const msg of cases) {
      it(`"${msg}" -> game_creation with high confidence`, () => {
        const result = detectGameCreationIntent(msg);
        expect(result.intent).toBe('game_creation');
        expect(result.confidence).toBeGreaterThanOrEqual(0.9);
        expect(result.extractedPrompt).toBe(msg);
      });
    }
  });

  describe('medium game creation signals', () => {
    const cases = [
      'I want a game where you fly through caves',
      'a game about collecting gems in a forest',
      'game with enemies and power-ups',
      'game that features a boss battle with player health',
    ];

    for (const msg of cases) {
      it(`"${msg}" -> game_creation with medium confidence`, () => {
        const result = detectGameCreationIntent(msg);
        expect(result.intent).toBe('game_creation');
        expect(result.confidence).toBeGreaterThanOrEqual(0.6);
      });
    }
  });

  describe('editing / normal chat signals', () => {
    const cases = [
      'change the player color to red',
      'move the cube up by 2 units',
      'delete the enemy entity',
      'set the light intensity to 5',
      'update the material to be more shiny',
      'fix the physics on the ball',
      'rename the entity to Player',
    ];

    for (const msg of cases) {
      it(`"${msg}" -> normal_chat`, () => {
        const result = detectGameCreationIntent(msg);
        expect(result.intent).toBe('normal_chat');
      });
    }
  });

  describe('questions', () => {
    const cases = [
      'what is a game engine?',
      'how do I add physics?',
      'can you explain materials?',
      'is there a way to export?',
    ];

    for (const msg of cases) {
      it(`"${msg}" -> normal_chat`, () => {
        const result = detectGameCreationIntent(msg);
        expect(result.intent).toBe('normal_chat');
      });
    }
  });

  describe('edge cases', () => {
    it('empty string -> normal_chat', () => {
      const result = detectGameCreationIntent('');
      expect(result.intent).toBe('normal_chat');
      expect(result.confidence).toBe(0);
    });

    it('very short message -> normal_chat', () => {
      const result = detectGameCreationIntent('hi');
      expect(result.intent).toBe('normal_chat');
    });

    it('whitespace only -> normal_chat', () => {
      const result = detectGameCreationIntent('   ');
      expect(result.intent).toBe('normal_chat');
    });

    it('very long prompt still detects intent', () => {
      const prompt = 'make me a platformer where ' + 'the player jumps '.repeat(50);
      const result = detectGameCreationIntent(prompt);
      expect(result.intent).toBe('game_creation');
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });
  });

  describe('ambiguous cases default to normal_chat', () => {
    it('single word "game" -> normal_chat', () => {
      const result = detectGameCreationIntent('game');
      expect(result.intent).toBe('normal_chat');
    });

    it('"tell me about games" -> normal_chat', () => {
      const result = detectGameCreationIntent('tell me about games');
      expect(result.intent).toBe('normal_chat');
    });
  });

  describe('mixed signals — editing + creation', () => {
    it('"change this into a platformer game" -> normal_chat (editing wins)', () => {
      const result = detectGameCreationIntent('change this into a platformer game');
      expect(result.intent).toBe('normal_chat');
    });
  });
});
