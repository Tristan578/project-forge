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
});
