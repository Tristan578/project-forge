import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  SCENE_EXPORTED_EVENT,
  MAX_SCENE_EXPORT_REQUEST_ID_LENGTH,
  newSceneExportRequestId,
  isSceneExportResponseFor,
  type SceneExportedDetail,
} from '../sceneExportWire';

function detail(overrides: Partial<SceneExportedDetail> = {}): SceneExportedDetail {
  return { json: '{}', name: 'Untitled', ...overrides };
}

describe('sceneExportWire', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('SCENE_EXPORTED_EVENT', () => {
    it('is the DOM event name the engine bridge dispatches on', () => {
      // Hard-coded rather than derived: this string is a contract with every
      // addEventListener call site, so a rename must break a test.
      expect(SCENE_EXPORTED_EVENT).toBe('forge:scene-exported');
    });
  });

  describe('newSceneExportRequestId', () => {
    it('returns a unique id on each call', () => {
      const ids = new Set(Array.from({ length: 100 }, () => newSceneExportRequestId()));
      expect(ids.size).toBe(100);
    });

    it('fits the engine validator bound', () => {
      const id = newSceneExportRequestId();
      // The engine rejects an id over its byte limit, which would turn a
      // correlated export into a dispatch error instead of an answer.
      expect(new TextEncoder().encode(id).length).toBeLessThanOrEqual(
        MAX_SCENE_EXPORT_REQUEST_ID_LENGTH,
      );
    });

    it('contains no control characters', () => {
      // Also rejected by the engine validator (log-injection surface).
      expect(newSceneExportRequestId()).not.toMatch(/[\u0000-\u001F\u007F]/);
    });

    it('falls back to a unique id when crypto.randomUUID is unavailable', () => {
      // randomUUID is undefined outside secure contexts; an export must still
      // correlate rather than throwing on the way to the engine.
      vi.stubGlobal('crypto', {
        randomUUID: () => {
          throw new Error('not a secure context');
        },
      });

      const a = newSceneExportRequestId();
      const b = newSceneExportRequestId();

      expect(a).not.toBe('');
      expect(a).not.toBe(b);
      expect(new TextEncoder().encode(a).length).toBeLessThanOrEqual(
        MAX_SCENE_EXPORT_REQUEST_ID_LENGTH,
      );
      expect(a).not.toMatch(/[\u0000-\u001F\u007F]/);
    });
  });

  describe('isSceneExportResponseFor', () => {
    it('accepts an event carrying the caller own id', () => {
      expect(isSceneExportResponseFor('req-1', detail({ requestId: 'req-1' }))).toBe(true);
    });

    it('rejects an event carrying a different id', () => {
      // The whole point of PF-1103: someone else asked, so this is not our answer.
      expect(isSceneExportResponseFor('req-1', detail({ requestId: 'req-2' }))).toBe(false);
    });

    it('accepts an event with no id at all', () => {
      // Back-compat: an engine binary built before the change echoes nothing.
      // Refusing here would hang every listener until the WASM rebuild ships.
      expect(isSceneExportResponseFor('req-1', detail())).toBe(true);
    });

    it('accepts an event whose id is explicitly undefined', () => {
      expect(isSceneExportResponseFor('req-1', detail({ requestId: undefined }))).toBe(true);
    });

    it('treats a null id as absent', () => {
      // Not reachable from the Rust emitter (the key is skipped when absent),
      // but a hand-built detail or a JSON round trip can produce it.
      const withNull = { json: '{}', name: 'Untitled', requestId: null } as unknown as SceneExportedDetail;
      expect(isSceneExportResponseFor('req-1', withNull)).toBe(true);
    });

    it('rejects an empty-string id rather than treating it as absent', () => {
      // The engine rejects an empty id outright, so an empty one on the wire is
      // not "no correlation" — it is a value that cannot be ours.
      expect(isSceneExportResponseFor('req-1', detail({ requestId: '' }))).toBe(false);
    });

    it('matches exactly, not by prefix', () => {
      expect(isSceneExportResponseFor('req-1', detail({ requestId: 'req-10' }))).toBe(false);
      expect(isSceneExportResponseFor('req-10', detail({ requestId: 'req-1' }))).toBe(false);
    });
  });
});
