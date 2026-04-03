export const maxDuration = 60; // API_MAX_DURATION_STANDARD_GEN_S

import { createGenerationHandler } from '@/lib/api/createGenerationHandler';
import { sanitizePrompt } from '@/lib/ai/contentSafety';
import { generateText, Output } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { AI_MODEL_FAST } from '@/lib/ai/models';
import { z } from 'zod';

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

const PacingSuggestionSchema = z.array(z.object({
  title: z.string(),
  description: z.string(),
  targetSceneIndex: z.number().nullable().optional(),
  priority: z.enum(['low', 'medium', 'high']),
}));

const SYSTEM_PROMPT = `You are an expert game designer specialising in emotional pacing and player experience.
You will receive a pacing analysis report for a game project.
Your task is to:
1. Review the existing local suggestions in the report.
2. Add 2–4 additional AI-generated suggestions that are specific, actionable, and grounded in established game design theory.
3. Each suggestion must include: title (max 10 words), description (2-3 sentences), targetSceneIndex (null or 0-based integer), priority ("low" | "medium" | "high").`;

export const POST = createGenerationHandler<
  { report: PacingReport },
  PacingReport
>({
  route: '/api/generate/pacing',
  provider: 'anthropic',
  operation: 'chat_short',
  rateLimitKey: 'gen-pacing',
  rateLimitMax: 20,
  skipContentSafety: true,
  validate: (body) => {
    const { report } = body as { report?: unknown };

    if (!report || typeof report !== 'object') {
      return { ok: false, error: 'Missing required field: report' };
    }

    const r = report as PacingReport;
    if (!r.curve || !Array.isArray(r.curve.segments)) {
      return { ok: false, error: 'report.curve.segments must be an array' };
    }

    // Content safety — scene names and emotions are user-authored text
    const textToCheck = r.curve.segments
      .map((s: PacingSegment) => `${s.sceneName} ${s.emotion}`)
      .join(' ');
    const safety = sanitizePrompt(textToCheck);
    if (!safety.safe) {
      return { ok: false, error: safety.reason ?? 'Content rejected by safety filter' };
    }

    return { ok: true, params: { report: r } };
  },
  execute: async (params, apiKey) => {
    const { report } = params;

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

    const anthropicClient = createAnthropic({ apiKey });
    const aiResult = await generateText({
      model: anthropicClient(AI_MODEL_FAST),
      system: SYSTEM_PROMPT,
      prompt,
      maxOutputTokens: 800,
      temperature: 0.4,
      output: Output.object({ schema: PacingSuggestionSchema }),
    });

    const aiSuggestions: PacingSuggestion[] = (aiResult.output ?? []).map((s) => ({
      title: s.title,
      description: s.description,
      priority: s.priority,
      ...(s.targetSceneIndex != null ? { sceneIndex: s.targetSceneIndex } : {}),
    }));

    return {
      ...report,
      suggestions: [...report.suggestions, ...aiSuggestions],
    };
  },
});
