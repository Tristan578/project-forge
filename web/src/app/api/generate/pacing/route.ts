export const maxDuration = 60; // API_MAX_DURATION_STANDARD_GEN_S

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { resolveApiKey, ApiKeyError } from '@/lib/keys/resolver';
import { getTokenCost } from '@/lib/tokens/pricing';
import { captureException } from '@/lib/monitoring/sentry-server';
import { rateLimitResponse } from '@/lib/rateLimit';
import { distributedRateLimit } from '@/lib/rateLimit/distributed';
import { generateText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { AI_MODEL_FAST } from '@/lib/ai/models';
// Inline types — the pacing analysis route receives these from the client.
interface PacingSegment {
  sceneIndex: number;
  sceneName: string;
  intensity: number;
  emotion: string;
}

interface PacingCurve {
  segments: PacingSegment[];
  averageIntensity: number;
  variance: number;
}

interface PacingSuggestion {
  title: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  sceneIndex?: number;
}

interface PacingReport {
  score: number;
  curve: PacingCurve;
  suggestions: PacingSuggestion[];
}

// ---------------------------------------------------------------------------
// Request body type
// ---------------------------------------------------------------------------

interface PacingRequestBody {
  report: PacingReport;
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are an expert game designer specialising in emotional pacing and player experience.
You will receive a pacing analysis report for a game project.
Your task is to:
1. Review the existing local suggestions in the report.
2. Add 2–4 additional AI-generated suggestions that are specific, actionable, and grounded in established game design theory.
3. Each suggestion must include: title (max 10 words), description (2-3 sentences), targetSceneIndex (null or 0-based integer), priority ("low" | "medium" | "high").

Respond with ONLY a JSON array of suggestion objects. No preamble, no code fences, no markdown. Example format:
[{"title":"Add a midpoint rest","description":"...","targetSceneIndex":2,"priority":"medium"}]`;

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  // 1. Authenticate
  const authResult = await authenticateRequest();
  if (!authResult.ok) return authResult.response;

  // 2. Rate limit: 20 pacing analysis requests per 5 minutes per user
  const rl = await distributedRateLimit(`gen-pacing:${authResult.ctx.user.id}`, 20, 300);
  if (!rl.allowed) return rateLimitResponse(rl.remaining, rl.resetAt);

  // 3. Parse request body
  let body: PacingRequestBody;
  try {
    body = await request.json() as PacingRequestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { report } = body;
  if (!report || typeof report !== 'object') {
    return NextResponse.json({ error: 'Missing required field: report' }, { status: 422 });
  }

  if (!report.curve || !Array.isArray(report.curve.segments)) {
    return NextResponse.json({ error: 'report.curve.segments must be an array' }, { status: 422 });
  }

  // 4. Resolve API key and deduct tokens
  const tokenCost = getTokenCost('chat_short');
  let apiKey: string;
  let usageId: string | undefined;

  try {
    const resolved = await resolveApiKey(
      authResult.ctx.user.id,
      'anthropic',
      tokenCost,
      'pacing_analysis',
      { segmentCount: report.curve.segments.length },
    );
    apiKey = resolved.key;
    usageId = resolved.usageId;
  } catch (err) {
    if (err instanceof ApiKeyError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 402 });
    }
    throw err;
  }

  // 5. Build prompt from report summary
  const segmentSummary = report.curve.segments
    .map((s) => `Scene ${s.sceneIndex} "${s.sceneName}": intensity=${s.intensity.toFixed(2)}, emotion=${s.emotion}`)
    .join('\n');

  const existingSuggestions = report.suggestions
    .map((s) => `- ${s.title}: ${s.description}`)
    .join('\n');

  const prompt = `Pacing analysis for a game project:

Score: ${report.score}/100
Average intensity: ${report.curve.averageIntensity.toFixed(2)}
Variance: ${report.curve.variance.toFixed(4)}

Scene breakdown (${report.curve.segments.length} scene(s)):
${segmentSummary}

Existing suggestions already identified:
${existingSuggestions || 'None yet.'}

Generate 2–4 additional AI suggestions to improve the emotional pacing.`;

  // 6. Call Anthropic API via BYOK-resolved key
  const anthropicClient = createAnthropic({ apiKey });

  try {
    const aiResult = await generateText({
      model: anthropicClient(AI_MODEL_FAST),
      system: SYSTEM_PROMPT,
      prompt,
      maxOutputTokens: 800,
      temperature: 0.4,
    });

    // 7. Parse AI suggestions
    let aiSuggestions: PacingSuggestion[] = [];
    try {
      const parsed = JSON.parse(aiResult.text) as unknown[];
      if (Array.isArray(parsed)) {
        aiSuggestions = parsed.filter(
          (s): s is PacingSuggestion =>
            typeof s === 'object' &&
            s !== null &&
            typeof (s as Record<string, unknown>).title === 'string' &&
            typeof (s as Record<string, unknown>).description === 'string' &&
            ['low', 'medium', 'high'].includes(
              (s as Record<string, unknown>).priority as string,
            ),
        );
      }
    } catch {
      // AI returned non-JSON — return report with local suggestions only
    }

    const enrichedReport: PacingReport = {
      ...report,
      suggestions: [...report.suggestions, ...aiSuggestions],
    };

    return NextResponse.json(enrichedReport, { status: 200 });
  } catch (err) {
    if (usageId) {
      try {
        const { refundTokens } = await import('@/lib/tokens/service');
        await refundTokens(authResult.ctx.user.id, usageId);
      } catch (refundErr) {
        captureException(refundErr, { route: '/api/generate/pacing', action: 'refund', usageId });
      }
    }
    captureException(err, { route: '/api/generate/pacing' });
    const message = err instanceof Error ? err.message : 'Provider error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
