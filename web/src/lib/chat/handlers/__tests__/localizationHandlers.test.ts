/**
 * Tests for localizationHandlers.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { localizationHandlers } from '../localizationHandlers';
import { createMockStore } from './handlerTestUtils';
import type { ToolCallContext } from '../types';
import type { LocaleBundle } from '@/lib/i18n/gameLocalization';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildCtx(storeOverrides: Record<string, unknown> = {}): ToolCallContext {
  const store = createMockStore({
    // Localization slice fields
    locales: {} as Record<string, LocaleBundle>,
    sourceLocale: 'en',
    previewLocale: null as string | null,
    setSourceLocale: vi.fn(),
    setLocaleBundle: vi.fn().mockImplementation(function (this: Record<string, unknown>, bundle: LocaleBundle) {
      (this.locales as Record<string, LocaleBundle>)[bundle.locale] = bundle;
    }),
    removeLocale: vi.fn(),
    setPreviewLocale: vi.fn(),
    resolveString: vi.fn().mockReturnValue('source text'),
    getAvailableLocales: vi.fn().mockReturnValue([]),
    ...storeOverrides,
  });
  return { store, dispatchCommand: vi.fn() };
}

// ---------------------------------------------------------------------------
// extract_translatable_strings
// ---------------------------------------------------------------------------

describe('localizationHandlers — extract_translatable_strings', () => {
  it('returns empty result with helpful message when scene is empty', async () => {
    const ctx = buildCtx({ sceneGraph: { nodes: {}, rootIds: [] } });
    const result = await localizationHandlers['extract_translatable_strings']({}, ctx);
    expect(result.success).toBe(true);
    expect(result.message).toMatch(/no translatable strings/i);
    expect((result.result as Record<string, unknown>)['count']).toBe(0);
  });

  it('extracts strings from entity names in scene graph', async () => {
    const ctx = buildCtx({
      sceneGraph: {
        nodes: {
          'e1': { entityId: 'e1', name: 'Fire Dragon' },
          'e2': { entityId: 'e2', name: 'Player' },
        },
        rootIds: ['e1', 'e2'],
      },
    });
    const result = await localizationHandlers['extract_translatable_strings']({}, ctx);
    expect(result.success).toBe(true);
    const data = result.result as { strings: Array<{ id: string; text: string }>; count: number };
    expect(data.count).toBe(2);
    expect(data.strings.find((s) => s.text === 'Fire Dragon')).toBeDefined();
  });

  it('reports the count in the message', async () => {
    const ctx = buildCtx({
      sceneGraph: {
        nodes: { 'e1': { entityId: 'e1', name: 'Boss Enemy' } },
        rootIds: ['e1'],
      },
    });
    const result = await localizationHandlers['extract_translatable_strings']({}, ctx);
    expect(result.message).toContain('1 translatable string');
  });
});

// ---------------------------------------------------------------------------
// translate_scene
// ---------------------------------------------------------------------------

describe('localizationHandlers — translate_scene', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fails validation when targetLocales is missing', async () => {
    const ctx = buildCtx();
    const result = await localizationHandlers['translate_scene']({}, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/invalid arguments/i);
  });

  it('fails validation when targetLocales is empty array', async () => {
    const ctx = buildCtx();
    const result = await localizationHandlers['translate_scene']({ targetLocales: [] }, ctx);
    expect(result.success).toBe(false);
  });

  it('rejects unsupported locale codes', async () => {
    const ctx = buildCtx();
    const result = await localizationHandlers['translate_scene'](
      { targetLocales: ['xx-INVALID'] },
      ctx
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/unsupported locale/i);
  });

  it('returns friendly message when scene has no translatable strings', async () => {
    const ctx = buildCtx({ sceneGraph: { nodes: {}, rootIds: [] } });
    const result = await localizationHandlers['translate_scene'](
      { targetLocales: ['fr'] },
      ctx
    );
    expect(result.success).toBe(true);
    expect(result.message).toMatch(/no translatable strings/i);
  });

  it('calls fetch API and stores bundles on success', async () => {
    const frBundle: LocaleBundle = {
      locale: 'fr',
      translations: { 'entity.e1.name': 'Dragon de feu' },
    };
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ locales: { fr: frBundle } }),
    });

    const setLocaleBundleMock = vi.fn();
    const ctx = buildCtx({
      sceneGraph: {
        nodes: { 'e1': { entityId: 'e1', name: 'Fire Dragon' } },
        rootIds: ['e1'],
      },
      setLocaleBundle: setLocaleBundleMock,
    });

    const result = await localizationHandlers['translate_scene'](
      { targetLocales: ['fr'] },
      ctx
    );

    expect(result.success).toBe(true);
    expect(setLocaleBundleMock).toHaveBeenCalledWith(frBundle);
    expect(result.message).toContain('French');
  });

  it('handles API error response', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: () => Promise.resolve({ error: 'Rate limit exceeded' }),
    });

    const ctx = buildCtx({
      sceneGraph: {
        nodes: { 'e1': { entityId: 'e1', name: 'Fire Dragon' } },
        rootIds: ['e1'],
      },
    });

    const result = await localizationHandlers['translate_scene'](
      { targetLocales: ['fr'] },
      ctx
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/rate limit/i);
  });

  it('handles network fetch error', async () => {
    global.fetch = vi.fn().mockRejectedValueOnce(new Error('Network error'));

    const ctx = buildCtx({
      sceneGraph: {
        nodes: { 'e1': { entityId: 'e1', name: 'Fire Dragon' } },
        rootIds: ['e1'],
      },
    });

    const result = await localizationHandlers['translate_scene'](
      { targetLocales: ['fr'] },
      ctx
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/network error/i);
  });
});

// ---------------------------------------------------------------------------
// set_preview_locale
// ---------------------------------------------------------------------------

describe('localizationHandlers — set_preview_locale', () => {
  it('fails validation when locale field is missing', async () => {
    const ctx = buildCtx();
    const result = await localizationHandlers['set_preview_locale']({}, ctx);
    expect(result.success).toBe(false);
  });

  it('rejects unsupported locale code', async () => {
    const ctx = buildCtx();
    const result = await localizationHandlers['set_preview_locale'](
      { locale: 'xx-INVALID' },
      ctx
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/unsupported locale/i);
  });

  it('rejects locale with no stored translations', async () => {
    const ctx = buildCtx({ getAvailableLocales: vi.fn().mockReturnValue([]) });
    const result = await localizationHandlers['set_preview_locale'](
      { locale: 'fr' },
      ctx
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no translations available/i);
  });

  it('sets preview locale when bundle exists', async () => {
    const setPreviewLocaleMock = vi.fn();
    const ctx = buildCtx({
      getAvailableLocales: vi.fn().mockReturnValue(['fr', 'ja']),
      setPreviewLocale: setPreviewLocaleMock,
    });
    const result = await localizationHandlers['set_preview_locale'](
      { locale: 'fr' },
      ctx
    );
    expect(result.success).toBe(true);
    expect(setPreviewLocaleMock).toHaveBeenCalledWith('fr');
    expect(result.message).toContain('French');
  });

  it('clears preview when locale is null', async () => {
    const setPreviewLocaleMock = vi.fn();
    const ctx = buildCtx({ setPreviewLocale: setPreviewLocaleMock });
    const result = await localizationHandlers['set_preview_locale'](
      { locale: null },
      ctx
    );
    expect(result.success).toBe(true);
    expect(setPreviewLocaleMock).toHaveBeenCalledWith(null);
    expect(result.message).toMatch(/cleared/i);
  });
});

// ---------------------------------------------------------------------------
// list_locales
// ---------------------------------------------------------------------------

describe('localizationHandlers — list_locales', () => {
  it('returns empty list with friendly message when no locales stored', async () => {
    const ctx = buildCtx({
      getAvailableLocales: vi.fn().mockReturnValue([]),
      previewLocale: null,
      sourceLocale: 'en',
      locales: {},
    });
    const result = await localizationHandlers['list_locales']({}, ctx);
    expect(result.success).toBe(true);
    expect(result.message).toMatch(/no translations/i);
    const data = result.result as { locales: unknown[] };
    expect(data.locales).toHaveLength(0);
  });

  it('returns locale details when bundles are present', async () => {
    const frBundle: LocaleBundle = {
      locale: 'fr',
      translations: { 'entity.e1.name': 'Dragon de feu', 'ui.btn.text': 'Démarrer' },
    };
    const ctx = buildCtx({
      getAvailableLocales: vi.fn().mockReturnValue(['fr']),
      previewLocale: 'fr',
      sourceLocale: 'en',
      locales: { fr: frBundle },
    });
    const result = await localizationHandlers['list_locales']({}, ctx);
    expect(result.success).toBe(true);
    const data = result.result as {
      locales: Array<{ code: string; stringCount: number; displayName: string }>;
      previewLocale: string | null;
    };
    expect(data.previewLocale).toBe('fr');
    expect(data.locales[0].code).toBe('fr');
    expect(data.locales[0].stringCount).toBe(2);
    expect(data.locales[0].displayName).toBe('French');
  });

  it('includes the full list of supported locales', async () => {
    const ctx = buildCtx({
      getAvailableLocales: vi.fn().mockReturnValue([]),
      locales: {},
    });
    const result = await localizationHandlers['list_locales']({}, ctx);
    const data = result.result as { supportedLocales: Array<{ code: string }> };
    expect(data.supportedLocales.length).toBeGreaterThanOrEqual(50);
    expect(data.supportedLocales.find((l) => l.code === 'ja')).toBeDefined();
  });
});
