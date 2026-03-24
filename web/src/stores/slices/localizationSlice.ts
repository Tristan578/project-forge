/**
 * Localization slice — tracks available locale bundles and the active preview locale.
 *
 * Locale bundles are stored as Record<locale, Record<stringId, translatedText>>.
 * The `previewLocale` swaps UI text in the editor to a translated version.
 */

import type { StateCreator } from 'zustand';
import type { LocaleBundle } from '@/lib/i18n/gameLocalization';

export interface LocalizationSlice {
  /** All stored locale translation bundles keyed by BCP-47 locale code. */
  locales: Record<string, LocaleBundle>;
  /** Source locale for the current project (default: 'en'). */
  sourceLocale: string;
  /** When non-null, the editor renders strings in this locale for preview. */
  previewLocale: string | null;

  /** Set the source locale for the project. */
  setSourceLocale: (locale: string) => void;
  /** Store or update a locale bundle. */
  setLocaleBundle: (bundle: LocaleBundle) => void;
  /** Remove a locale bundle entirely. */
  removeLocale: (locale: string) => void;
  /** Set which locale is currently being previewed in the editor (null = source). */
  setPreviewLocale: (locale: string | null) => void;
  /** Resolve a string ID to its preview-locale translation, or fall back to the source text. */
  resolveString: (stringId: string, sourceText: string) => string;
  /** Return all locale codes that have stored translations. */
  getAvailableLocales: () => string[];
}

export const createLocalizationSlice: StateCreator<LocalizationSlice, [], [], LocalizationSlice> = (set, get) => ({
  locales: {},
  sourceLocale: 'en',
  previewLocale: null,

  setSourceLocale: (locale) => set({ sourceLocale: locale }),

  setLocaleBundle: (bundle) =>
    set((state) => ({
      locales: {
        ...state.locales,
        [bundle.locale]: bundle,
      },
    })),

  removeLocale: (locale) =>
    set((state) => {
      const next = { ...state.locales };
      delete next[locale];
      // Clear preview if we removed the active preview locale
      return {
        locales: next,
        previewLocale: state.previewLocale === locale ? null : state.previewLocale,
      };
    }),

  setPreviewLocale: (locale) => set({ previewLocale: locale }),

  resolveString: (stringId, sourceText) => {
    const { previewLocale, locales } = get();
    if (!previewLocale) return sourceText;
    const bundle = locales[previewLocale];
    if (!bundle) return sourceText;
    return bundle.translations[stringId] ?? sourceText;
  },

  getAvailableLocales: () => Object.keys(get().locales),
});
