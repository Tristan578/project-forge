export const maxDuration = 120; // API_MAX_DURATION_BATCH_S

import { createGenerationHandler } from '@/lib/api/createGenerationHandler';
import { sanitizePrompt } from '@/lib/ai/contentSafety';
import { DB_PROVIDER } from '@/lib/config/providers';
import {
  buildTranslationPrompt,
  parseTranslationResponse,
  chunkArray,
  LOCALE_MAP,
  type TranslatableString,
  type LocaleBundle,
} from '@/lib/i18n/gameLocalization';
import { generateText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { AI_MODEL_FAST } from '@/lib/ai/models';
import { TOKEN_COSTS } from '@/lib/tokens/pricing';

const CHUNK_SIZE = 200;

interface LocalizeParams {
  strings: TranslatableString[];
  sourceLocale: string;
  targetLocales: string[];
}

export const POST = createGenerationHandler<
  LocalizeParams,
  { locales: Record<string, LocaleBundle> }
>({
  route: '/api/generate/localize',
  provider: DB_PROVIDER.chat,
  operation: 'localize_scene',
  rateLimitKey: 'gen-localize',
  rateLimitMax: 5,
  rateLimitWindowSeconds: 600,
  skipContentSafety: true,
  billingMetadata: (params) => ({
    stringCount: params.strings.length,
    localeCount: params.targetLocales.length,
  }),
  tokenCost: (params) => {
    const chunkCount = Math.ceil(params.strings.length / CHUNK_SIZE);
    return chunkCount * params.targetLocales.length * TOKEN_COSTS.localize_cost_per_chunk;
  },
  validate: (body) => {
    const { strings, sourceLocale, targetLocales } = body as Record<string, unknown>;

    if (!Array.isArray(strings) || strings.length === 0) {
      return { ok: false, error: 'strings must be a non-empty array' };
    }
    if (strings.length > 2000) {
      return { ok: false, error: 'Too many strings — maximum 2000 per request' };
    }
    if (typeof sourceLocale !== 'string' || sourceLocale.length === 0) {
      return { ok: false, error: 'sourceLocale must be a non-empty string' };
    }
    if (!Array.isArray(targetLocales) || targetLocales.length === 0) {
      return { ok: false, error: 'targetLocales must be a non-empty array' };
    }
    if (targetLocales.length > 10) {
      return { ok: false, error: 'Maximum 10 target locales per request' };
    }

    // Validate each string item shape
    const validatedStrings: TranslatableString[] = [];
    for (let i = 0; i < strings.length; i++) {
      const s = strings[i];
      if (
        typeof s !== 'object' ||
        s === null ||
        typeof (s as Record<string, unknown>).id !== 'string' ||
        typeof (s as Record<string, unknown>).text !== 'string' ||
        typeof (s as Record<string, unknown>).context !== 'string'
      ) {
        return { ok: false, error: `strings[${i}] must have id, text, and context fields (all strings)` };
      }
      const item = s as TranslatableString;
      if (item.id.length === 0 || item.text.length === 0) {
        return { ok: false, error: `strings[${i}] id and text must be non-empty` };
      }
      validatedStrings.push(item);
    }

    // Validate locale codes
    const validatedTargets: string[] = [];
    for (const locale of targetLocales) {
      if (typeof locale !== 'string' || locale.length === 0) {
        return { ok: false, error: 'Each targetLocale must be a non-empty string' };
      }
      if (!LOCALE_MAP.has(locale)) {
        return { ok: false, error: `Unsupported locale: ${locale}` };
      }
      validatedTargets.push(locale);
    }

    // Content safety — sample first 50 user-authored strings
    const sampleText = validatedStrings.slice(0, 50).map(s => s.text).join(' ');
    const safety = sanitizePrompt(sampleText);
    if (!safety.safe) {
      return { ok: false, error: safety.reason ?? 'Content rejected by safety filter' };
    }

    return {
      ok: true,
      params: {
        strings: validatedStrings,
        sourceLocale: sourceLocale as string,
        targetLocales: validatedTargets,
      },
    };
  },
  cacheKeyParams: (params) => ({
    strings: params.strings,
    sourceLocale: params.sourceLocale,
    targetLocales: params.targetLocales,
  }),
  execute: async (params, apiKey) => {
    const anthropicProvider = createAnthropic({ apiKey });
    const result: Record<string, LocaleBundle> = {};

    for (const targetLocale of params.targetLocales) {
      const allTranslations: Record<string, string> = {};
      const chunks = chunkArray(params.strings, CHUNK_SIZE);

      for (const chunk of chunks) {
        const prompt = buildTranslationPrompt(chunk, params.sourceLocale, targetLocale);
        const { text: raw } = await generateText({
          model: anthropicProvider(AI_MODEL_FAST),
          system: 'You are a professional video game localizer. Return only valid JSON.',
          prompt,
          maxOutputTokens: 4096,
          experimental_telemetry: { isEnabled: true },
        });

        const { translations } = parseTranslationResponse(raw, chunk);
        Object.assign(allTranslations, translations);
      }

      result[targetLocale] = {
        locale: targetLocale,
        translations: allTranslations,
      };
    }

    return { locales: result };
  },
});
