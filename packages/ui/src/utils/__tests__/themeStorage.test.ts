import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateCustomTheme } from '../themeValidator';

// Mock idb-keyval before importing themeStorage
const mockStore: Record<string, unknown> = {};

vi.mock('idb-keyval', () => ({
  get: vi.fn(async (key: string) => mockStore[key] ?? undefined),
  set: vi.fn(async (key: string, value: unknown) => { mockStore[key] = value; }),
  del: vi.fn(async (key: string) => { delete mockStore[key]; }),
  keys: vi.fn(async () => Object.keys(mockStore)),
}));

describe('themeStorage', () => {
  beforeEach(() => {
    // Clear mock store
    for (const key of Object.keys(mockStore)) delete mockStore[key];
    vi.clearAllMocks();
  });

  it('saveCustomTheme stores a ValidatedTheme', async () => {
    const { saveCustomTheme } = await import('../themeStorage');
    const { set } = await import('idb-keyval');
    const result = validateCustomTheme({
      schemaVersion: 1, name: 'My Theme', author: 'dev', description: '', tokens: {},
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await saveCustomTheme('test-id', result.theme);
    expect(set).toHaveBeenCalledWith('sf-theme-test-id', result.theme);
  });

  it('loadCustomTheme returns null for unknown id', async () => {
    const { loadCustomTheme } = await import('../themeStorage');
    const found = await loadCustomTheme('00000000-0000-4000-8000-000000000001');
    expect(found).toBeNull();
  });

  it('loadCustomTheme returns null for invalid UUID', async () => {
    const { loadCustomTheme } = await import('../themeStorage');
    const found = await loadCustomTheme('../evil');
    expect(found).toBeNull();
  });

  it('loadCustomTheme re-validates stored data', async () => {
    const { get } = await import('idb-keyval');
    vi.mocked(get).mockResolvedValueOnce({
      schemaVersion: 1, name: 'Stored', author: '', description: '', tokens: {},
    });
    const { loadCustomTheme } = await import('../themeStorage');
    const theme = await loadCustomTheme('00000000-0000-4000-8000-000000000001');
    expect(theme).not.toBeNull();
    expect(theme?.name).toBe('Stored');
  });

  it('loadCustomTheme returns null for corrupted data', async () => {
    const { get } = await import('idb-keyval');
    vi.mocked(get).mockResolvedValueOnce({ schemaVersion: 'bad', name: 'X', tokens: {} });
    const { loadCustomTheme } = await import('../themeStorage');
    const theme = await loadCustomTheme('00000000-0000-4000-8000-000000000001');
    expect(theme).toBeNull();
  });

  it('deleteCustomTheme removes the theme', async () => {
    const { deleteCustomTheme } = await import('../themeStorage');
    const { del } = await import('idb-keyval');
    await deleteCustomTheme('test-id');
    expect(del).toHaveBeenCalledWith('sf-theme-test-id');
  });

  it('listCustomThemes returns only sf-theme- prefixed keys', async () => {
    const { keys } = await import('idb-keyval');
    vi.mocked(keys).mockResolvedValueOnce([
      'sf-theme-abc', 'sf-theme-def', 'other-key'
    ] as unknown[]);
    const { listCustomThemes } = await import('../themeStorage');
    const ids = await listCustomThemes();
    expect(ids).toEqual(['abc', 'def']);
  });
});
