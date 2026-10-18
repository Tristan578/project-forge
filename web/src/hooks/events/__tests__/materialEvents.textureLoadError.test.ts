import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createMockSetGet, createMockActions, type StoreState } from './eventTestUtils';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: {
    getState: vi.fn(),
    setState: vi.fn(),
    subscribe: vi.fn(),
  },
}));

vi.mock('@/lib/toast', () => ({
  showError: vi.fn(),
  showPersistentError: vi.fn(),
  showSuccess: vi.fn(),
  showInfo: vi.fn(),
}));

import { useEditorStore } from '@/stores/editorStore';
import { showPersistentError } from '@/lib/toast';
import { handleMaterialEvent } from '../materialEvents';

/**
 * TEXTURE_LOAD_ERROR (#10399). `load_texture` answers when the request is
 * queued; the engine decodes and assigns the texture a frame later, so a
 * failure there reaches the editor only through this event. Before it, the
 * drain logged and moved on, and the person saw nothing.
 */
describe('handleMaterialEvent: TEXTURE_LOAD_ERROR', () => {
  let mockSetGet: ReturnType<typeof createMockSetGet>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSetGet = createMockSetGet();
    vi.mocked(useEditorStore.getState).mockReturnValue(createMockActions() as unknown as StoreState);
  });

  it('shows a persistent notice naming the file and the engine reason, deduped per file', () => {
    const handled = handleMaterialEvent(
      'TEXTURE_LOAD_ERROR',
      { name: 'hero.png', entityId: 'ent-1', slot: 'sprite', reason: 'the entity has no sprite to apply it to' },
      mockSetGet.set,
      mockSetGet.get,
    );

    expect(handled).toBe(true);
    expect(showPersistentError).toHaveBeenCalledExactlyOnceWith(
      'Texture "hero.png" was not applied: the entity has no sprite to apply it to',
      { id: 'load_texture-failed:hero.png' },
    );
  });

  it('bounds a long file name and a long engine reason', () => {
    handleMaterialEvent(
      'TEXTURE_LOAD_ERROR',
      { name: `${'n'.repeat(100)}.png`, entityId: 'ent-1', slot: 'base_color', reason: 'r'.repeat(500) },
      mockSetGet.set,
      mockSetGet.get,
    );

    const [message] = vi.mocked(showPersistentError).mock.calls[0]!;
    expect(message).toContain(`"${'n'.repeat(60)}…"`);
    expect(message.endsWith(`${'r'.repeat(200)}…`)).toBe(true);
  });

  /**
   * The wire, read from the engine itself: the bridge is wasm32-only, so no
   * test can run it, and a mocked payload would pin whatever shape this file
   * believed. The emitter must send the event name this handler matches and
   * every key it reads.
   */
  it('matches the event name and payload keys the engine emits', () => {
    const events = readFileSync(
      join(__dirname, '..', '..', '..', '..', '..', 'engine', 'src', 'bridge', 'events.rs'),
      'utf8',
    );
    const start = events.indexOf('pub fn emit_texture_load_error(');
    expect(start, 'emit_texture_load_error is missing from bridge/events.rs').toBeGreaterThan(-1);
    const end = events.indexOf('\n}\n', start);
    expect(end, 'emit_texture_load_error has no closing brace at column 0').toBeGreaterThan(start);
    const body = events.slice(start, end);

    expect(body).toContain('emit_event("TEXTURE_LOAD_ERROR"');
    for (const key of ['"name"', '"entityId"', '"slot"', '"reason"']) {
      expect(body, `the engine payload lacks ${key}`).toContain(`${key}:`);
    }
  });
});
