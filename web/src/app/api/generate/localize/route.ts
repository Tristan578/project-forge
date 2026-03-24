export const maxDuration = 120; // seconds — batch translation can be slow for large string sets

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { captureException } from '@/lib/monitoring/sentry-server';
import { rateLimitResponse } from '@/lib/rateLimit';
import { distributedRateLimit } from '@/lib/rateLimit/distributed';
import {
  buildTranslationPrompt,
  parseTranslationResponse,
  chunkArray,
  LOCALE_MAP,
  type TranslatableString,
  type LocaleBundle,
} from '@/lib/i18n/gameLocalization';
import { fetchAI } from '@/lib/ai/client';

// ---------------------------------------------------------------------------
// POST /api/generate/localize
//
// Accepts a batch of translatable strings and one or more target locales.
// Returns a map of locale -> Record<stringId, translatedString>.
// Strings are chunked into batches of 200 to stay within context limits.
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  // 1. Authenticate
  const authResult = await authenticateRequest();
  if (!authResult.ok) return authResult.response;

  // 2. Rate limit — 5 requests / 10 min per user (translation is expensive)
  const rl = await distributedRateLimit(`gen-localize:${authResult.ctx.user.id}`, 5, 600);
  if (!rl.allowed) return rateLimitResponse(rl.remaining, rl.resetAt);

  // 3. Parse body
  let body: {
    strings?: unknown;
    sourceLocale?: unknown;
    targetLocales?: unknown;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { strings, sourceLocale, targetLocales } = body;

  // 4. Validate
  if (!Array.isArray(strings) || strings.length === 0) {
    return NextResponse.json(
      { error: 'strings must be a non-empty array' },
      { status: 422 }
    );
  }

  if (strings.length > 2000) {
    return NextResponse.json(
      { error: 'Too many strings — maximum 2000 per request' },
      { status: 422 }
    );
  }

  if (typeof sourceLocale !== 'string' || sourceLocale.length === 0) {
    return NextResponse.json(
      { error: 'sourceLocale must be a non-empty string' },
      { status: 422 }
    );
  }

  if (!Array.isArray(targetLocales) || targetLocales.length === 0) {
    return NextResponse.json(
      { error: 'targetLocales must be a non-empty array' },
      { status: 422 }
    );
  }

  if (targetLocales.length > 10) {
    return NextResponse.json(
      { error: 'Maximum 10 target locales per request' },
      { status: 422 }
    );
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
      return NextResponse.json(
        { error: `strings[${i}] must have id, text, and context fields (all strings)` },
        { status: 422 }
      );
    }
    const item = s as TranslatableString;
    if (item.id.length === 0 || item.text.length === 0) {
      return NextResponse.json(
        { error: `strings[${i}] id and text must be non-empty` },
        { status: 422 }
      );
    }
    validatedStrings.push(item);
  }

  // Validate locale codes
  const validatedTargets: string[] = [];
  for (const locale of targetLocales) {
    if (typeof locale !== 'string' || locale.length === 0) {
      return NextResponse.json(
        { error: 'Each targetLocale must be a non-empty string' },
        { status: 422 }
      );
    }
    if (!LOCALE_MAP.has(locale)) {
      return NextResponse.json(
        { error: `Unsupported locale: ${locale}` },
        { status: 422 }
      );
    }
    validatedTargets.push(locale);
  }

  // 5. Translate each locale
  const result: Record<string, LocaleBundle> = {};
  const CHUNK_SIZE = 200;

  try {
    for (const targetLocale of validatedTargets) {
      const allTranslations: Record<string, string> = {};
      const chunks = chunkArray(validatedStrings, CHUNK_SIZE);

      for (const chunk of chunks) {
        const prompt = buildTranslationPrompt(chunk, sourceLocale, targetLocale);

        const raw = await fetchAI(prompt, {
          model: 'claude-sonnet-4-5',
          systemOverride: 'You are a professional video game localizer. Return only valid JSON.',
          priority: 2,
        });

        const { translations } = parseTranslationResponse(raw, chunk);
        Object.assign(allTranslations, translations);
      }

      result[targetLocale] = {
        locale: targetLocale,
        translations: allTranslations,
      };
    }
  } catch (err) {
    captureException(err);
    const message = err instanceof Error ? err.message : 'Translation failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ locales: result });
}
