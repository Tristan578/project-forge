import { describe, it, expect, beforeEach } from 'vitest';
import { createSliceStore } from './sliceTestTemplate';
import { createLocalizationSlice, type LocalizationSlice } from '../localizationSlice';
import type { LocaleBundle } from '@/lib/i18n/gameLocalization';

function makeStore() {
  return createSliceStore<LocalizationSlice>(createLocalizationSlice);
}

const frBundle: LocaleBundle = {
  locale: 'fr',
  translations: {
    'entity.e1.name': 'Dragon de feu',
    'ui.btn.text': 'Démarrer',
  },
};

const jaBundle: LocaleBundle = {
  locale: 'ja',
  translations: {
    'entity.e1.name': '炎のドラゴン',
    'ui.btn.text': 'ゲームスタート',
  },
};

describe('localizationSlice — initial state', () => {
  it('starts with empty locales', () => {
    const store = makeStore();
    expect(store.getState().locales).toEqual({});
  });

  it('defaults sourceLocale to "en"', () => {
    const store = makeStore();
    expect(store.getState().sourceLocale).toBe('en');
  });

  it('defaults previewLocale to null', () => {
    const store = makeStore();
    expect(store.getState().previewLocale).toBeNull();
  });
});

describe('localizationSlice — setSourceLocale', () => {
  it('updates sourceLocale', () => {
    const store = makeStore();
    store.getState().setSourceLocale('de');
    expect(store.getState().sourceLocale).toBe('de');
  });
});

describe('localizationSlice — setLocaleBundle', () => {
  it('stores a new bundle', () => {
    const store = makeStore();
    store.getState().setLocaleBundle(frBundle);
    expect(store.getState().locales['fr']).toEqual(frBundle);
  });

  it('overwrites an existing bundle for the same locale', () => {
    const store = makeStore();
    store.getState().setLocaleBundle(frBundle);
    const updated: LocaleBundle = {
      locale: 'fr',
      translations: { 'entity.e1.name': 'Dragon' },
    };
    store.getState().setLocaleBundle(updated);
    expect(store.getState().locales['fr'].translations['entity.e1.name']).toBe('Dragon');
  });

  it('does not affect other locales', () => {
    const store = makeStore();
    store.getState().setLocaleBundle(frBundle);
    store.getState().setLocaleBundle(jaBundle);
    expect(store.getState().locales['fr']).toEqual(frBundle);
    expect(store.getState().locales['ja']).toEqual(jaBundle);
  });
});

describe('localizationSlice — removeLocale', () => {
  it('removes the specified locale', () => {
    const store = makeStore();
    store.getState().setLocaleBundle(frBundle);
    store.getState().removeLocale('fr');
    expect(store.getState().locales['fr']).toBeUndefined();
  });

  it('clears previewLocale when that locale is removed', () => {
    const store = makeStore();
    store.getState().setLocaleBundle(frBundle);
    store.getState().setPreviewLocale('fr');
    store.getState().removeLocale('fr');
    expect(store.getState().previewLocale).toBeNull();
  });

  it('preserves previewLocale when a different locale is removed', () => {
    const store = makeStore();
    store.getState().setLocaleBundle(frBundle);
    store.getState().setLocaleBundle(jaBundle);
    store.getState().setPreviewLocale('ja');
    store.getState().removeLocale('fr');
    expect(store.getState().previewLocale).toBe('ja');
  });

  it('is a no-op for non-existent locale', () => {
    const store = makeStore();
    store.getState().setLocaleBundle(frBundle);
    store.getState().removeLocale('de');
    expect(store.getState().locales['fr']).toEqual(frBundle);
  });
});

describe('localizationSlice — setPreviewLocale', () => {
  it('sets previewLocale to a locale code', () => {
    const store = makeStore();
    store.getState().setPreviewLocale('ja');
    expect(store.getState().previewLocale).toBe('ja');
  });

  it('clears previewLocale when set to null', () => {
    const store = makeStore();
    store.getState().setPreviewLocale('fr');
    store.getState().setPreviewLocale(null);
    expect(store.getState().previewLocale).toBeNull();
  });
});

describe('localizationSlice — resolveString', () => {
  beforeEach(() => {});

  it('returns sourceText when previewLocale is null', () => {
    const store = makeStore();
    store.getState().setLocaleBundle(frBundle);
    const result = store.getState().resolveString('entity.e1.name', 'Fire Dragon');
    expect(result).toBe('Fire Dragon');
  });

  it('returns translated text when previewLocale is set and translation exists', () => {
    const store = makeStore();
    store.getState().setLocaleBundle(frBundle);
    store.getState().setPreviewLocale('fr');
    const result = store.getState().resolveString('entity.e1.name', 'Fire Dragon');
    expect(result).toBe('Dragon de feu');
  });

  it('falls back to sourceText when previewLocale has no bundle', () => {
    const store = makeStore();
    store.getState().setPreviewLocale('de'); // no bundle stored
    const result = store.getState().resolveString('entity.e1.name', 'Fire Dragon');
    expect(result).toBe('Fire Dragon');
  });

  it('falls back to sourceText when string ID not in bundle', () => {
    const store = makeStore();
    store.getState().setLocaleBundle(frBundle);
    store.getState().setPreviewLocale('fr');
    const result = store.getState().resolveString('entity.missing.name', 'Fallback');
    expect(result).toBe('Fallback');
  });
});

describe('localizationSlice — getAvailableLocales', () => {
  it('returns empty array initially', () => {
    const store = makeStore();
    expect(store.getState().getAvailableLocales()).toEqual([]);
  });

  it('returns all stored locale codes', () => {
    const store = makeStore();
    store.getState().setLocaleBundle(frBundle);
    store.getState().setLocaleBundle(jaBundle);
    const available = store.getState().getAvailableLocales();
    expect(available).toContain('fr');
    expect(available).toContain('ja');
    expect(available).toHaveLength(2);
  });

  it('updates after removeLocale', () => {
    const store = makeStore();
    store.getState().setLocaleBundle(frBundle);
    store.getState().setLocaleBundle(jaBundle);
    store.getState().removeLocale('fr');
    const available = store.getState().getAvailableLocales();
    expect(available).not.toContain('fr');
    expect(available).toContain('ja');
  });
});
