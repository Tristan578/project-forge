import { describe, it, expect, vi, beforeEach } from 'vitest';
import { saveSceneToCloud } from '../cloudSave';

describe('cloudSave', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns ok:true on successful save', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('', { status: 200 }),
    );

    const result = await saveSceneToCloud('proj-1', 'My Scene', '{"entities":[]}');
    expect(result.ok).toBe(true);
    expect(result.savedAt).toBeDefined();
  });

  it('sends PUT with correct body', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('', { status: 200 }),
    );

    await saveSceneToCloud('proj-1', 'My Scene', '{"entities":[]}');

    expect(fetchSpy).toHaveBeenCalledWith('/api/projects/proj-1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'My Scene', sceneData: { entities: [] } }),
    });
  });

  it('carries the completion mode the export folded in through the arrangement merge (#9998)', async () => {
    // The SCENE_EXPORTED handler puts `completionMode` on the JSON; this PUT is
    // what a reopen reads back, so the merge must not drop it.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('', { status: 200 }),
    );

    await saveSceneToCloud('proj-1', 'My Scene', '{"entities":[],"completionMode":"sandbox"}');

    const body = JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body)) as {
      sceneData: Record<string, unknown>;
    };
    expect(body.sceneData.completionMode).toBe('sandbox');
  });

  it('returns error for invalid JSON', async () => {
    const result = await saveSceneToCloud('proj-1', 'Scene', '{bad json');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Invalid scene JSON');
  });

  it('returns error on non-ok HTTP response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Unauthorized', { status: 401 }),
    );

    const result = await saveSceneToCloud('proj-1', 'Scene', '{}');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('401');
    expect(result.error).toContain('Unauthorized');
  });

  it('returns error on network failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Failed to fetch'));

    const result = await saveSceneToCloud('proj-1', 'Scene', '{}');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Failed to fetch');
  });

  it('returns generic error on non-Error throw', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue('string error');

    const result = await saveSceneToCloud('proj-1', 'Scene', '{}');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Network error');
  });

  it('handles server response with empty body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('', { status: 500 }),
    );

    const result = await saveSceneToCloud('proj-1', 'Scene', '{}');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('500');
  });

  // #9854: the music arrangement rides the same project payload.
  it('merges a music arrangement into sceneData under its namespaced key', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }));
    const arrangement = {
      version: 1,
      tempoBpm: 120,
      tracks: [{ id: 'tk', name: 'T', muted: false }],
      clips: [
        { id: 'cl', trackId: 'tk', sourceUrl: 'm', sourceDurationSeconds: 10, startOffset: 0, trimStart: 0, trimEnd: 10, loopEnabled: false, name: 'm' },
      ],
    };
    await saveSceneToCloud('proj-1', 'My Scene', '{"entities":[]}', arrangement);
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.sceneData.entities).toEqual([]);
    expect(body.sceneData.musicArrangement).toEqual(arrangement);
  });

  it('omits the arrangement key when none is passed (existing one-shot flow unchanged)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }));
    await saveSceneToCloud('proj-1', 'My Scene', '{"entities":[]}');
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect('musicArrangement' in body.sceneData).toBe(false);
  });
});
