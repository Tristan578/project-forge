import { describe, it, expect } from 'vitest';
import { PANEL_DEFINITIONS, UNCLOSABLE_PANELS } from './panelRegistry';

describe('panelRegistry', () => {
  describe('PANEL_DEFINITIONS', () => {
    it('exports a non-empty registry', () => {
      expect(PANEL_DEFINITIONS).toBeDefined();
      expect(Object.keys(PANEL_DEFINITIONS).length).toBeGreaterThan(0);
    });

    it('has scene-viewport panel', () => {
      expect(PANEL_DEFINITIONS['scene-viewport']).toBeDefined();
      expect(PANEL_DEFINITIONS['scene-viewport'].id).toBe('scene-viewport');
      expect(PANEL_DEFINITIONS['scene-viewport'].title).toBe('Scene');
      expect(PANEL_DEFINITIONS['scene-viewport'].component).toBe('scene-viewport');
    });

    it('has script-editor panel', () => {
      expect(PANEL_DEFINITIONS['script-editor']).toBeDefined();
      expect(PANEL_DEFINITIONS['script-editor'].id).toBe('script-editor');
      expect(PANEL_DEFINITIONS['script-editor'].title).toBe('Script Editor');
    });

    it('has scene-hierarchy panel', () => {
      expect(PANEL_DEFINITIONS['scene-hierarchy']).toBeDefined();
      expect(PANEL_DEFINITIONS['scene-hierarchy'].id).toBe('scene-hierarchy');
      expect(PANEL_DEFINITIONS['scene-hierarchy'].title).toBe('Hierarchy');
    });

    it('has inspector panel', () => {
      expect(PANEL_DEFINITIONS['inspector']).toBeDefined();
      expect(PANEL_DEFINITIONS['inspector'].id).toBe('inspector');
      expect(PANEL_DEFINITIONS['inspector'].title).toBe('Inspector');
    });

    it('has asset-browser panel', () => {
      expect(PANEL_DEFINITIONS['asset-browser']).toBeDefined();
      expect(PANEL_DEFINITIONS['asset-browser'].title).toBe('Assets');
    });

    it('has audio-mixer panel', () => {
      expect(PANEL_DEFINITIONS['audio-mixer']).toBeDefined();
      expect(PANEL_DEFINITIONS['audio-mixer'].title).toBe('Audio Mixer');
    });

    it('has docs panel', () => {
      expect(PANEL_DEFINITIONS['docs']).toBeDefined();
      expect(PANEL_DEFINITIONS['docs'].title).toBe('Documentation');
    });

    it('has dialogue-editor panel', () => {
      expect(PANEL_DEFINITIONS['dialogue-editor']).toBeDefined();
      expect(PANEL_DEFINITIONS['dialogue-editor'].title).toBe('Dialogue Editor');
    });

    it('has tileset panel', () => {
      expect(PANEL_DEFINITIONS['tileset']).toBeDefined();
      expect(PANEL_DEFINITIONS['tileset'].title).toBe('Tileset');
    });

    it('has timeline panel', () => {
      expect(PANEL_DEFINITIONS['timeline']).toBeDefined();
      expect(PANEL_DEFINITIONS['timeline'].title).toBe('Timeline');
    });

    it('all panels have required id field', () => {
      Object.values(PANEL_DEFINITIONS).forEach((panel) => {
        expect(panel.id).toBeDefined();
        expect(typeof panel.id).toBe('string');
        expect(panel.id.length).toBeGreaterThan(0);
      });
    });

    it('all panels have required title field', () => {
      Object.values(PANEL_DEFINITIONS).forEach((panel) => {
        expect(panel.title).toBeDefined();
        expect(typeof panel.title).toBe('string');
        expect(panel.title.length).toBeGreaterThan(0);
      });
    });

    it('all panels have required component field', () => {
      Object.values(PANEL_DEFINITIONS).forEach((panel) => {
        expect(panel.component).toBeDefined();
        expect(typeof panel.component).toBe('string');
        expect(panel.component.length).toBeGreaterThan(0);
      });
    });

    it('panel IDs match registry keys', () => {
      Object.entries(PANEL_DEFINITIONS).forEach(([key, panel]) => {
        expect(panel.id).toBe(key);
      });
    });

    describe('Panel constraints', () => {
      it('scene-viewport has minimum dimensions', () => {
        const panel = PANEL_DEFINITIONS['scene-viewport'];
        expect(panel.minWidth).toBe(400);
        expect(panel.minHeight).toBe(300);
      });

      it('scene-viewport is unclosable', () => {
        const panel = PANEL_DEFINITIONS['scene-viewport'];
        expect(panel.unclosable).toBe(true);
      });

      it('scene-viewport uses always renderer', () => {
        const panel = PANEL_DEFINITIONS['scene-viewport'];
        expect(panel.renderer).toBe('always');
      });

      it('timeline uses always renderer', () => {
        const panel = PANEL_DEFINITIONS['timeline'];
        expect(panel.renderer).toBe('always');
      });

      it('script-editor has reasonable minimum width', () => {
        const panel = PANEL_DEFINITIONS['script-editor'];
        expect(panel.minWidth).toBeGreaterThanOrEqual(200);
      });

      it('inspector has reasonable minimum width', () => {
        const panel = PANEL_DEFINITIONS['inspector'];
        expect(panel.minWidth).toBeGreaterThanOrEqual(200);
      });
    });

    describe('Optional fields', () => {
      it('minWidth is optional but valid when present', () => {
        Object.values(PANEL_DEFINITIONS).forEach((panel) => {
          if (panel.minWidth !== undefined) {
            expect(typeof panel.minWidth).toBe('number');
            expect(panel.minWidth).toBeGreaterThan(0);
          }
        });
      });

      it('minHeight is optional but valid when present', () => {
        Object.values(PANEL_DEFINITIONS).forEach((panel) => {
          if (panel.minHeight !== undefined) {
            expect(typeof panel.minHeight).toBe('number');
            expect(panel.minHeight).toBeGreaterThan(0);
          }
        });
      });

      it('unclosable is optional but boolean when present', () => {
        Object.values(PANEL_DEFINITIONS).forEach((panel) => {
          if (panel.unclosable !== undefined) {
            expect(typeof panel.unclosable).toBe('boolean');
          }
        });
      });

      it('renderer is optional but valid when present', () => {
        Object.values(PANEL_DEFINITIONS).forEach((panel) => {
          if (panel.renderer !== undefined) {
            expect(['onlyWhenVisible', 'always']).toContain(panel.renderer);
          }
        });
      });
    });
  });

  describe('UNCLOSABLE_PANELS', () => {
    it('exports a Set', () => {
      expect(UNCLOSABLE_PANELS).toBeInstanceOf(Set);
    });

    it('contains scene-viewport', () => {
      expect(UNCLOSABLE_PANELS.has('scene-viewport')).toBe(true);
    });

    it('only contains panels marked as unclosable', () => {
      UNCLOSABLE_PANELS.forEach((panelId) => {
        const panel = PANEL_DEFINITIONS[panelId];
        expect(panel).toBeDefined();
        expect(panel.unclosable).toBe(true);
      });
    });

    it('contains all unclosable panels from definitions', () => {
      Object.values(PANEL_DEFINITIONS).forEach((panel) => {
        if (panel.unclosable) {
          expect(UNCLOSABLE_PANELS.has(panel.id)).toBe(true);
        }
      });
    });

    it('does not contain closable panels', () => {
      const closablePanels = Object.values(PANEL_DEFINITIONS).filter((p) => !p.unclosable);
      closablePanels.forEach((panel) => {
        expect(UNCLOSABLE_PANELS.has(panel.id)).toBe(false);
      });
    });
  });

  describe('Registry coverage', () => {
    it('has at least 10 panel definitions', () => {
      expect(Object.keys(PANEL_DEFINITIONS).length).toBeGreaterThanOrEqual(10);
    });

    it('has core editor panels', () => {
      const corePanels = [
        'scene-viewport',
        'scene-hierarchy',
        'inspector',
        'asset-browser',
        'script-editor',
      ];

      corePanels.forEach((panelId) => {
        expect(PANEL_DEFINITIONS[panelId]).toBeDefined();
      });
    });

    it('has specialized tool panels', () => {
      const toolPanels = ['audio-mixer', 'dialogue-editor', 'tileset', 'timeline'];

      toolPanels.forEach((panelId) => {
        expect(PANEL_DEFINITIONS[panelId]).toBeDefined();
      });
    });
  });

  describe('Component mapping', () => {
    it('component field matches id for most panels', () => {
      const exceptions = ['scene-settings', 'ui-builder'];
      Object.entries(PANEL_DEFINITIONS).forEach(([id, panel]) => {
        if (!exceptions.includes(id)) {
          expect(panel.component).toBe(id);
        }
      });
    });

    it('no duplicate component names', () => {
      const components = Object.values(PANEL_DEFINITIONS).map((p) => p.component);
      const uniqueComponents = new Set(components);
      expect(components.length).toBe(uniqueComponents.size);
    });
  });

  describe('Title formatting', () => {
    it('all titles are properly capitalized', () => {
      Object.values(PANEL_DEFINITIONS).forEach((panel) => {
        expect(panel.title[0]).toBe(panel.title[0].toUpperCase());
      });
    });

    it('no titles end with punctuation', () => {
      Object.values(PANEL_DEFINITIONS).forEach((panel) => {
        expect(panel.title).not.toMatch(/[.,!?;:]$/);
      });
    });

    it('titles are concise (under 25 characters)', () => {
      Object.values(PANEL_DEFINITIONS).forEach((panel) => {
        expect(panel.title.length).toBeLessThanOrEqual(25);
      });
    });
  });
});
