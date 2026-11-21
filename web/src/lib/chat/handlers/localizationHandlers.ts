/**
 * Localization chat handlers.
 *
 * Covers: extract_translatable_strings, translate_scene, set_preview_locale.
 */

import { z } from 'zod';
import type { ToolHandler, ExecutionResult } from './types';
import { parseArgs } from './types';
import {
  extractTranslatableStrings,
  SUPPORTED_LOCALES,
  LOCALE_MAP,
  type SceneForExtraction,
} from '@/lib/i18n/gameLocalization';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a SceneForExtraction from the current editor store state.
 * We read what's available — missing sections are simply omitted.
 */
function buildSceneForExtraction(store: Parameters<ToolHandler>[1]['store']): SceneForExtraction {
  const scene: SceneForExtraction = {};

  // Entity names from scene graph
  if (store.sceneGraph?.nodes) {
    scene.nodes = store.sceneGraph.nodes as SceneForExtraction['nodes'];
  }

  // Dialogue trees (present when dialogue system is active)
  const storeAsUnknown = store as unknown as Record<string, unknown>;
  if (storeAsUnknown.dialogueTrees) {
    scene.dialogueTrees = storeAsUnknown.dialogueTrees as SceneForExtraction['dialogueTrees'];
  }

  // UI widgets (present when UI builder is active)
  if (storeAsUnknown.uiWidgets) {
    scene.uiWidgets = storeAsUnknown.uiWidgets as SceneForExtraction['uiWidgets'];
  }

  return scene;
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const translateSceneSchema = z.object({
  targetLocales: z
    .array(z.string().min(1))
    .min(1)
    .max(10)
    .describe('Array of BCP-47 locale codes to translate to (e.g. ["ja", "fr", "de"])'),
  sourceLocale: z
    .string()
    .min(1)
    .default('en')
    .describe('Source locale code (defaults to "en")'),
});

const setPreviewLocaleSchema = z.object({
  locale: z
    .string()
    .nullable()
    .describe('BCP-47 locale code to preview, or null to return to source locale'),
});

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export const localizationHandlers: Record<string, ToolHandler> = {

  extract_translatable_strings: async (_args, { store }) => {
    const scene = buildSceneForExtraction(store);
    const strings = extractTranslatableStrings(scene);

    if (strings.length === 0) {
      return {
        success: true,
        message:
          'No translatable strings found in the current scene. Add entity names, dialogue text, or UI widget text first.',
        result: { strings: [], count: 0 },
      };
    }

    return {
      success: true,
      message: `Found ${strings.length} translatable string${strings.length === 1 ? '' : 's'} in the scene.`,
      result: {
        strings,
        count: strings.length,
      },
    };
  },

  translate_scene: async (args, { store }) => {
    const parsed = parseArgs(translateSceneSchema, args);
    if (parsed.error) return parsed.error;

    const { targetLocales, sourceLocale } = parsed.data;

    // Validate sourceLocale against the same LOCALE_MAP used for targetLocales.
    // This prevents mismatched source labels being stored in translation bundles.
    if (!LOCALE_MAP.has(sourceLocale)) {
      const supportedList = SUPPORTED_LOCALES.slice(0, 20)
        .map((l) => l.code)
        .join(', ');
      return {
        success: false,
        error: `Unsupported source locale: "${sourceLocale}". Supported codes include: ${supportedList}, ...`,
      };
    }

    // Validate locale codes
    const invalidLocales = targetLocales.filter((l) => !LOCALE_MAP.has(l));
    if (invalidLocales.length > 0) {
      const supportedList = SUPPORTED_LOCALES.slice(0, 20)
        .map((l) => l.code)
        .join(', ');
      return {
        success: false,
        error: `Unsupported locale code(s): ${invalidLocales.join(', ')}. Supported codes include: ${supportedList}, ...`,
      };
    }

    // Extract strings from scene
    const scene = buildSceneForExtraction(store);
    const strings = extractTranslatableStrings(scene);

    if (strings.length === 0) {
      return {
        success: true,
        message:
          'No translatable strings found in the scene. Add dialogue text, UI labels, or entity names first.',
        result: { translated: false, stringCount: 0 },
      };
    }

    // Call the API route
    let response: Response;
    try {
      response = await fetch('/api/generate/localize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strings, sourceLocale, targetLocales }),
      });
    } catch (err) {
      return {
        success: false,
        error: `Network error calling localization API: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    if (!response.ok) {
      let errorMsg = `Localization API error: ${response.status}`;
      try {
        const data = (await response.json()) as Record<string, unknown>;
        if (typeof data.error === 'string') errorMsg = data.error;
      } catch {
        /* non-JSON body */
      }
      return { success: false, error: errorMsg };
    }

    let data: { locales: Record<string, { locale: string; translations: Record<string, string> }> };
    try {
      data = await response.json() as typeof data;
    } catch {
      return { success: false, error: 'Failed to parse localization API response' };
    }

    // Store each bundle in the slice
    for (const bundle of Object.values(data.locales)) {
      store.setLocaleBundle(bundle);
    }

    const localeNames = targetLocales
      .map((l) => LOCALE_MAP.get(l)?.displayName ?? l)
      .join(', ');

    return {
      success: true,
      message: `Translated ${strings.length} string${strings.length === 1 ? '' : 's'} into ${localeNames}.`,
      result: {
        stringCount: strings.length,
        locales: targetLocales,
      },
    };
  },

  set_preview_locale: async (args, { store }) => {
    const parsed = parseArgs(setPreviewLocaleSchema, args);
    if (parsed.error) return parsed.error;

    const { locale } = parsed.data;

    if (locale !== null && !LOCALE_MAP.has(locale)) {
      return {
        success: false,
        error: `Unsupported locale: ${locale}`,
      };
    }

    if (locale !== null) {
      const available = store.getAvailableLocales();
      if (!available.includes(locale)) {
        return {
          success: false,
          error: `No translations available for "${locale}". Run translate_scene first.`,
        };
      }
    }

    store.setPreviewLocale(locale);

    const localeName = locale ? (LOCALE_MAP.get(locale)?.displayName ?? locale) : null;
    return {
      success: true,
      message: locale
        ? `Editor now previewing in ${localeName}.`
        : 'Preview locale cleared — showing source text.',
      result: { previewLocale: locale },
    };
  },

  list_locales: async (_args, { store }) => {
    const available = store.getAvailableLocales();
    const previewLocale = store.previewLocale;
    const sourceLocale = store.sourceLocale;

    const localeDetails = available.map((code) => {
      const def = LOCALE_MAP.get(code);
      const bundle = store.locales[code];
      return {
        code,
        displayName: def?.displayName ?? code,
        nativeName: def?.nativeName ?? code,
        direction: def?.direction ?? 'ltr',
        stringCount: bundle ? Object.keys(bundle.translations).length : 0,
      };
    });

    return {
      success: true,
      message:
        available.length > 0
          ? `${available.length} locale${available.length === 1 ? '' : 's'} available: ${available.join(', ')}.`
          : 'No translations stored yet. Use translate_scene to add locales.',
      result: {
        sourceLocale,
        previewLocale,
        locales: localeDetails,
        supportedLocales: SUPPORTED_LOCALES.map((l) => ({
          code: l.code,
          displayName: l.displayName,
        })),
      },
    };
  },
};

/** Type-checked result for translate_scene. */
export type TranslateSceneResult = ExecutionResult & {
  result?: {
    stringCount: number;
    locales: string[];
  };
};
