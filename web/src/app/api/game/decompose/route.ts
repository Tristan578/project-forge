/**
 * POST /api/game/decompose — Decompose a natural language game description
 * into a structured OrchestratorGDD via LLM.
 *
 * This is the ONLY server-side step in the game creation pipeline.
 * All subsequent steps (buildPlan, runPipeline) run client-side because
 * they call dispatchCommand() which requires the WASM engine.
 *
 * Spec: specs/2026-04-12-e1-pipeline-integration.md (Deliverable 2)
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withApiMiddleware } from '@/lib/api/middleware';
import { decomposeIntoSystems } from '@/lib/game-creation';
import { captureException } from '@/lib/monitoring/sentry-server';

export const maxDuration = 30;

const requestSchema = z.object({
  prompt: z.string().min(1).max(1000),
  projectType: z.enum(['2d', '3d']),
});

export async function POST(req: NextRequest) {
  const mid = await withApiMiddleware(req, {
    requireAuth: true,
    rateLimit: true,
    rateLimitConfig: { key: (id) => `game-decompose:${id}`, max: 5, windowSeconds: 60 },
  });
  if (mid.error) return mid.error;

  // Parse and validate request body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'validation_error', details: ['Invalid JSON body'] },
      { status: 400 },
    );
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'validation_error',
        details: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`),
      },
      { status: 400 },
    );
  }

  const { prompt, projectType } = parsed.data;

  try {
    const gdd = await decomposeIntoSystems(prompt, projectType);

    return NextResponse.json({ gdd });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // Prompt rejection is a 400, not a 500
    if (message.startsWith('Prompt rejected:')) {
      return NextResponse.json(
        { error: 'prompt_rejected', message },
        { status: 400 },
      );
    }

    captureException(err instanceof Error ? err : new Error(message), {
      extra: { endpoint: 'POST /api/game/decompose', projectType },
    });

    return NextResponse.json(
      { error: 'decomposition_failed', message },
      { status: 500 },
    );
  }
}
