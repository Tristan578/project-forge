import { describe, it, expect, beforeAll } from 'vitest';
import { TEMPLATE_REGISTRY, loadTemplate, getTemplateInfo } from './index';
import type { GameTemplate } from './index';

describe('game templates', () => {
  it('registry has 11 templates', () => {
    expect(TEMPLATE_REGISTRY).toHaveLength(11);
  });

  it('all registry entries have required fields', () => {
    for (const entry of TEMPLATE_REGISTRY) {
      expect(typeof entry.id).toBe('string');
      expect(entry.id.length).toBeGreaterThan(0);
      expect(typeof entry.name).toBe('string');
      expect(entry.name.length).toBeGreaterThan(0);
      expect(typeof entry.description).toBe('string');
      expect(entry.description.length).toBeGreaterThan(0);
      expect(typeof entry.category).toBe('string');
      expect(entry.category.length).toBeGreaterThan(0);
      expect(typeof entry.difficulty).toBe('string');
      expect(entry.difficulty.length).toBeGreaterThan(0);
      expect(typeof entry.thumbnail).toBe('object');
      expect(entry.thumbnail).toMatchObject({ gradient: expect.any(String), icon: expect.any(String) });
      expect(entry.entityCount).toBeGreaterThan(0);
      expect(typeof entry.load).toBe('function');
    }
  });

  it('all template IDs are unique', () => {
    const ids = TEMPLATE_REGISTRY.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('getTemplateInfo works', () => {
    const info = getTemplateInfo('platformer');
    expect(info).not.toBeNull();
    expect(info?.id).toBe('platformer');

    const missing = getTemplateInfo('nonexistent');
    expect(missing).toBeNull();
  });

  // Load and validate each template
  for (const entry of TEMPLATE_REGISTRY) {
    describe(`template: ${entry.id}`, () => {
      let template: GameTemplate;

      beforeAll(async () => {
        template = await entry.load();
      });

      it('loads successfully', () => {
        expect(template).not.toBeNull();
        expect(template.id).toBe(entry.id);
      });

      it('has valid sceneData with entities', () => {
        expect(template.sceneData.formatVersion).toBe(3);
        expect(template.sceneData.entities.length).toBeGreaterThan(5);
        expect(template.sceneData.entities.length).toBeLessThanOrEqual(50);
      });

      it('has reasonable entity count', () => {
        // Entity count in range (actual count depends on Array.from spreads)
        // 2D templates may have fewer entities (min 5 is fine for focused templates like fighter)
        expect(template.sceneData.entities.length).toBeGreaterThan(5);
        expect(template.sceneData.entities.length).toBeLessThan(50);
      });

      it('all entities have required fields', () => {
        for (const entity of template.sceneData.entities) {
          expect(typeof entity.entityId).toBe('string');
          expect(entity.entityId.length).toBeGreaterThan(0);
          expect(typeof entity.entityName).toBe('string');
          expect(entity.entityName.length).toBeGreaterThan(0);
          expect(typeof entity.entityType).toBe('string');
          expect(entity.entityType.length).toBeGreaterThan(0);
          expect(entity.transform).toMatchObject({ translation: expect.any(Array), rotation: expect.any(Array), scale: expect.any(Array) });
          expect(entity.transform.translation).toHaveLength(3);
          expect(entity.transform.rotation).toHaveLength(4);
          expect(entity.transform.scale).toHaveLength(3);
        }
      });

      it('has at least one script', () => {
        expect(Object.keys(template.scripts).length).toBeGreaterThan(0);
      });

      it('all script entity IDs exist in scene', () => {
        const entityIds = new Set(template.sceneData.entities.map(e => e.entityId));
        for (const scriptEntityId of Object.keys(template.scripts)) {
          expect(entityIds.has(scriptEntityId),
            `Script references non-existent entity: ${scriptEntityId}`
          ).toBe(true);
        }
      });

      it('scripts have non-empty source code', () => {
        for (const [entityId, script] of Object.entries(template.scripts)) {
          expect(script.source.length,
            `Empty script on ${entityId}`
          ).toBeGreaterThan(10);
          expect(script.enabled).toBe(true);
        }
      });

      it('has valid environment settings', () => {
        expect(template.sceneData.environment).not.toBeNull();
        expect(typeof template.sceneData.environment).toBe('object');
        expect(template.sceneData.ambientLight).not.toBeNull();
        expect(template.sceneData.ambientLight.brightness).toBeGreaterThan(0);
      });

      it('has an input preset', () => {
        expect(['fps', 'platformer', 'topdown', 'racing']).toContain(template.inputPreset);
      });
    });
  }

  it('loadTemplate works for valid ID', async () => {
    const template = await loadTemplate('platformer');
    expect(template).not.toBeNull();
    expect(template?.id).toBe('platformer');
  });

  it('loadTemplate returns null for invalid ID', async () => {
    const template = await loadTemplate('invalid_template');
    expect(template).toBeNull();
  });
});
