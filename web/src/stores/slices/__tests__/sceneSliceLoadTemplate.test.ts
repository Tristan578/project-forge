/**
 * `loadTemplate` — the honesty tests.
 *
 * This action used to be `console.warn('not yet implemented')` followed by a
 * resolved promise, and three surfaces built on top of it (the Template
 * Gallery, the `load_template` chat command, and the TEMPLATE_USED /
 * TEMPLATE_APPLIED analytics events) all reported success. Every case here
 * asserts on the store state or the dispatched command, never on the fact that
 * a mock was called — a mock-was-called assertion is exactly what let the stub
 * pass its own test suite.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createSceneTestStore, createFakeEngineDispatcher } from './sceneSliceTestStore';
import { setSceneDispatcher } from '../sceneSlice';
import { takeStagedSceneAudio, clearStagedSceneAudio } from '@/lib/audio/sceneAudioManifest';

type Dispatcher = (command: string, payload: unknown) => { success: boolean; error?: string } | void;

function detachDispatcher() {
  setSceneDispatcher(null as unknown as Dispatcher);
}

/** A dispatcher that acknowledges the command but never applies it. */
function silentDispatcher() {
  return vi.fn<Dispatcher>(() => undefined);
}

describe('sceneSlice.loadTemplate', () => {
  let harness: ReturnType<typeof createSceneTestStore>;

  beforeEach(() => {
    harness = createSceneTestStore();
    clearStagedSceneAudio();
  });

  afterEach(() => {
    detachDispatcher();
    clearStagedSceneAudio();
  });

  describe('applying a real template', () => {
    it('puts the templates entities in sceneGraph before it resolves', async () => {
      const dispatch = createFakeEngineDispatcher(harness.store);
      setSceneDispatcher(dispatch);

      const result = await harness.store.getState().loadTemplate('2d-platformer');

      expect(result.success).toBe(true);
      const { sceneGraph, nodeCount } = harness.store.getState();
      expect(nodeCount).toBeGreaterThan(0);
      expect(Object.keys(sceneGraph.nodes)).toContain('player');
      if (result.success) expect(result.entityCount).toBe(nodeCount);
    });

    it('sends load_scene with JSON the engine can read, not the raw template data', async () => {
      const dispatch = createFakeEngineDispatcher(harness.store);
      setSceneDispatcher(dispatch);

      await harness.store.getState().loadTemplate('2d-platformer');

      const [command, payload] = dispatch.mock.calls[0];
      expect(command).toBe('load_scene');
      const scene = JSON.parse((payload as { json: string }).json);
      // The template's own spellings would fail serde and apply nothing.
      expect(scene.entities[0].transform).toHaveProperty('position');
      expect(scene.entities[0]).toHaveProperty('name');
      expect(scene.entities[0].entityType).toBe('sprite');
      expect(scene.inputBindings).toEqual({ actions: {}, preset: null });
    });

    it('attaches the templates scripts through the script slice', async () => {
      setSceneDispatcher(createFakeEngineDispatcher(harness.store));

      await harness.store.getState().loadTemplate('2d-platformer');

      // The engine re-emits SCRIPT_CHANGED only for the selected entity, so a
      // script that only rode inside the scene file would never reach
      // `allScripts` — the map the script worker runs in Play mode.
      const [entityId, source, enabled] = harness.setScript.mock.calls[0];
      expect(entityId).toBe('player');
      expect(typeof source).toBe('string');
      expect(source.length).toBeGreaterThan(0);
      expect(enabled).toBe(true);
    });

    it('attaches the templates game components through the game slice', async () => {
      setSceneDispatcher(createFakeEngineDispatcher(harness.store));

      await harness.store.getState().loadTemplate('2d-platformer');

      const applied = harness.addGameComponent.mock.calls.filter(([id]) => id === 'player');
      const types = applied.map(([, component]) => component.type);
      expect(types).toContain('characterController');
      expect(types).toContain('health');
      // Partial template data must arrive as a COMPLETE component, or the store
      // and the engine hold different numbers for the fields nobody wrote.
      const controller = applied.find(([, c]) => c.type === 'characterController')![1];
      expect(controller.characterController).toEqual({
        speed: 5,
        jumpHeight: 2,
        gravityScale: 1,
        canDoubleJump: false,
      });
    });

    it('applies the templates input preset', async () => {
      setSceneDispatcher(createFakeEngineDispatcher(harness.store));

      await harness.store.getState().loadTemplate('2d-platformer');

      expect(harness.setInputPreset).toHaveBeenCalledWith('platformer');
    });

    it('reports the entities it had to drop and attaches nothing to them', async () => {
      setSceneDispatcher(createFakeEngineDispatcher(harness.store));

      const result = await harness.store.getState().loadTemplate('2d-platformer');

      // `Camera2d` has no EntityType variant; serde rejects an unknown variant
      // for the WHOLE file, so the entity is dropped rather than sent.
      expect(result.success && result.skippedEntityIds).toEqual(['camera']);
      expect(harness.store.getState().sceneGraph.nodes.camera).toBeUndefined();
      expect(harness.setScript.mock.calls.map(([id]) => id)).not.toContain('camera');
      expect(harness.addGameComponent.mock.calls.map(([id]) => id)).not.toContain('camera');
    });

    it('applies every shipped template', async () => {
      const { TEMPLATE_REGISTRY } = await import('@/data/templates');
      for (const entry of TEMPLATE_REGISTRY) {
        const local = createSceneTestStore();
        setSceneDispatcher(createFakeEngineDispatcher(local.store));
        const result = await local.store.getState().loadTemplate(entry.id);
        expect(result, `template ${entry.id}`).toMatchObject({ success: true });
        expect(local.store.getState().nodeCount, `template ${entry.id}`).toBeGreaterThan(0);
      }
    });
  });

  describe('failures are reported as failures', () => {
    it('refuses an unknown templateId without touching the scene', async () => {
      const dispatch = createFakeEngineDispatcher(harness.store);
      setSceneDispatcher(dispatch);

      const result = await harness.store.getState().loadTemplate('no-such-template');

      expect(result).toEqual({ success: false, error: 'Unknown template: no-such-template' });
      expect(dispatch).not.toHaveBeenCalled();
      expect(harness.store.getState().nodeCount).toBe(0);
    });

    it('refuses when no engine is attached', async () => {
      detachDispatcher();

      const result = await harness.store.getState().loadTemplate('2d-platformer');

      expect(result.success).toBe(false);
      expect(harness.store.getState().nodeCount).toBe(0);
    });

    it('surfaces an engine rejection and clears the staged scene audio', async () => {
      setSceneDispatcher(
        vi.fn<Dispatcher>(() => ({ success: false, error: 'Scene JSON too large' })),
      );

      const result = await harness.store.getState().loadTemplate('2d-platformer');

      expect(result).toEqual({ success: false, error: 'Scene JSON too large' });
      // A rejected load never emits SCENE_LOADED, so an armed stash would be
      // claimed by whatever scene loads next.
      expect(takeStagedSceneAudio()).toEqual({});
      expect(harness.setScript).not.toHaveBeenCalled();
    });

    it('refuses when the engine acknowledges the load but never applies it', async () => {
      // The live failure mode: `handle_load_scene` returns Ok for any string and
      // `apply_scene_load` returns SILENTLY when serde rejects the payload, so a
      // resolved dispatch proves nothing on its own.
      const dispatch = silentDispatcher();
      setSceneDispatcher(dispatch);

      const result = await harness.store.getState().loadTemplate('2d-platformer', { timeoutMs: 20 });

      expect(result.success).toBe(false);
      expect(dispatch).toHaveBeenCalledWith('load_scene', expect.anything());
      expect(harness.store.getState().nodeCount).toBe(0);
      expect(harness.setScript).not.toHaveBeenCalled();
      expect(harness.setInputPreset).not.toHaveBeenCalled();
    });

    it('does not mistake a scene that was already populated for a successful apply', async () => {
      harness.store.setState({
        sceneGraph: {
          nodes: {
            stale: { entityId: 'stale', name: 'Stale', parentId: null, children: [], visible: true, components: [] },
          },
          rootIds: ['stale'],
        },
        nodeCount: 1,
      });
      setSceneDispatcher(silentDispatcher());

      const result = await harness.store.getState().loadTemplate('2d-platformer', { timeoutMs: 20 });

      expect(result.success).toBe(false);
    });
  });
});
