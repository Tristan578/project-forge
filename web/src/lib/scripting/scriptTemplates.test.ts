import { describe, it, expect } from 'vitest';
import { SCRIPT_TEMPLATES } from './scriptTemplates';

describe('scriptTemplates', () => {
  describe('Structural Integrity', () => {
    it('should have exactly 10 templates', () => {
      expect(SCRIPT_TEMPLATES).toHaveLength(10);
    });

    it('should have all required fields on every template', () => {
      for (const template of SCRIPT_TEMPLATES) {
        expect(template).toHaveProperty('id');
        expect(template).toHaveProperty('name');
        expect(template).toHaveProperty('description');
        expect(template).toHaveProperty('source');

        expect(typeof template.id).toBe('string');
        expect(typeof template.name).toBe('string');
        expect(typeof template.description).toBe('string');
        expect(typeof template.source).toBe('string');

        expect(template.id.length).toBeGreaterThan(0);
        expect(template.name.length).toBeGreaterThan(0);
        expect(template.description.length).toBeGreaterThan(0);
        expect(template.source.length).toBeGreaterThan(0);
      }
    });

    it('should have no duplicate template IDs', () => {
      const ids = SCRIPT_TEMPLATES.map(t => t.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it('should have no duplicate template names', () => {
      const names = SCRIPT_TEMPLATES.map(t => t.name);
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(names.length);
    });
  });

  describe('Source Code Quality', () => {
    it('should contain onUpdate or onStart function in all templates', () => {
      for (const template of SCRIPT_TEMPLATES) {
        const hasOnUpdate = template.source.includes('function onUpdate(dt)');
        const hasOnStart = template.source.includes('function onStart()');
        expect(hasOnUpdate || hasOnStart).toBe(true);
      }
    });

    it('should reference forge API in all templates', () => {
      for (const template of SCRIPT_TEMPLATES) {
        expect(template.source).toContain('forge.');
      }
    });

    it('should reference entityId variable in most templates', () => {
      const templatesWithEntityId = SCRIPT_TEMPLATES.filter(t =>
        t.source.includes('entityId')
      );
      // Most templates should use entityId (e.g. for forge.translate, forge.rotate, etc.)
      // Some templates like day_night_cycle may operate on other entities via forge.scene
      expect(templatesWithEntityId.length).toBeGreaterThanOrEqual(8);
    });

    it('should not contain bare console.log calls', () => {
      for (const template of SCRIPT_TEMPLATES) {
        // Should use forge.log instead
        expect(template.source).not.toContain('console.log');
      }
    });

    it('should reference dt parameter in onUpdate functions', () => {
      for (const template of SCRIPT_TEMPLATES) {
        if (template.source.includes('function onUpdate(dt)')) {
          expect(template.source).toContain('dt');
        }
      }
    });
  });

  describe('Specific Templates', () => {
    it('character_controller should use forge.input API', () => {
      const template = SCRIPT_TEMPLATES.find(t => t.id === 'character_controller');
      expect(template).toBeDefined();
      expect(template?.source).toContain('forge.input');
      expect(template?.source).toContain('isPressed');
      expect(template?.source).toContain('justPressed');
    });

    it('health_system should use forge.ui API for HP display', () => {
      const template = SCRIPT_TEMPLATES.find(t => t.id === 'health_system');
      expect(template).toBeDefined();
      expect(template?.source).toContain('forge.ui');
      expect(template?.source).toContain('showText');
      expect(template?.source).toContain('HP');
    });

    it('enemy_patrol should use forge.physics.distanceTo', () => {
      const template = SCRIPT_TEMPLATES.find(t => t.id === 'enemy_patrol');
      expect(template).toBeDefined();
      expect(template?.source).toContain('forge.physics.distanceTo');
    });

    it('projectile should spawn entities', () => {
      const template = SCRIPT_TEMPLATES.find(t => t.id === 'projectile');
      expect(template).toBeDefined();
      expect(template?.source).toContain('forge.spawn');
      expect(template?.source).toContain('forge.destroy');
    });

    it('day_night_cycle should manipulate time of day', () => {
      const template = SCRIPT_TEMPLATES.find(t => t.id === 'day_night_cycle');
      expect(template).toBeDefined();
      expect(template?.source).toContain('timeOfDay');
      expect(template?.source).toContain('CYCLE_DURATION');
    });
  });

  describe('Template IDs', () => {
    const expectedIds = [
      'character_controller',
      'collectible',
      'rotating_object',
      'follow_camera',
      'enemy_patrol',
      'health_system',
      'score_manager',
      'projectile',
      'npc_dialog',
      'day_night_cycle',
    ];

    it('should have all expected template IDs', () => {
      const actualIds = SCRIPT_TEMPLATES.map(t => t.id);
      for (const id of expectedIds) {
        expect(actualIds).toContain(id);
      }
    });
  });
});
