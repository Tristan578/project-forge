import { describe, it, expect } from 'vitest';
import {
  STATUS_ENDPOINTS,
  resolveStatusEndpoint,
  getStatusEndpoint,
} from '@/lib/generation/statusEndpoints';

/**
 * Regression suite for #8762: `get_generation_status`'s status-route map had
 * drifted from `useGenerationPolling`'s — `pixel-art`, `sprite_sheet`, and
 * `tileset` were absent from the chat tool, so `get_generation_status({ type:
 * 'pixel-art' })` returned a false "Could not find generation job". Both now
 * consume STATUS_ENDPOINTS; these tests pin the contract so any future
 * single-sided edit fails CI.
 */
describe('STATUS_ENDPOINTS (single source of truth)', () => {
  it('covers exactly the async-pollable generation types', () => {
    // Adding a new async generation type? Add it here AND to STATUS_ENDPOINTS.
    // `sfx` and `voice` are deliberately excluded — they have no /status route.
    expect(Object.keys(STATUS_ENDPOINTS).sort()).toEqual(
      ['model', 'music', 'pixel-art', 'skybox', 'sprite', 'sprite_sheet', 'texture', 'tileset'].sort(),
    );
  });

  it('maps every type to a /api/generate/*/status route', () => {
    for (const route of Object.values(STATUS_ENDPOINTS)) {
      expect(route).toMatch(/^\/api\/generate\/[a-z-]+\/status$/);
    }
  });

  it('includes the three types that had drifted out of the chat tool (#8762)', () => {
    expect(resolveStatusEndpoint('pixel-art')).toBe('/api/generate/pixel-art/status');
    expect(resolveStatusEndpoint('sprite_sheet')).toBe('/api/generate/sprite-sheet/status');
    expect(resolveStatusEndpoint('tileset')).toBe('/api/generate/tileset-gen/status');
  });

  it('resolves the original five types unchanged', () => {
    expect(resolveStatusEndpoint('model')).toBe('/api/generate/model/status');
    expect(resolveStatusEndpoint('texture')).toBe('/api/generate/texture/status');
    expect(resolveStatusEndpoint('skybox')).toBe('/api/generate/skybox/status');
    expect(resolveStatusEndpoint('music')).toBe('/api/generate/music/status');
    expect(resolveStatusEndpoint('sprite')).toBe('/api/generate/sprite/status');
  });
});

describe('resolveStatusEndpoint', () => {
  it('returns undefined for non-pollable types (sfx, voice)', () => {
    expect(resolveStatusEndpoint('sfx')).toBeUndefined();
    expect(resolveStatusEndpoint('voice')).toBeUndefined();
  });

  it('returns undefined for an unknown type rather than throwing', () => {
    expect(resolveStatusEndpoint('not-a-real-type')).toBeUndefined();
  });
});

describe('getStatusEndpoint (poller variant)', () => {
  it('returns the route for a known type', () => {
    expect(getStatusEndpoint('pixel-art')).toBe('/api/generate/pixel-art/status');
  });

  it('throws on an unknown/unpollable type', () => {
    expect(() => getStatusEndpoint('not-a-real-type')).toThrow(/Unknown generation type/);
    expect(() => getStatusEndpoint('sfx')).toThrow(/Unknown generation type/);
  });
});
