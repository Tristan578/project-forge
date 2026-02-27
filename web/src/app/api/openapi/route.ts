import { NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import path from 'path';

/**
 * GET /api/openapi
 * Serves the OpenAPI 3.0 specification as JSON.
 * Used by the Swagger UI at /api-docs.
 */
export async function GET() {
  try {
    // Resolve from web/ working directory up to docs/api/openapi.json
    const specPath = path.join(process.cwd(), '..', 'docs', 'api', 'openapi.json');
    const raw = readFileSync(specPath, 'utf-8');
    const spec = JSON.parse(raw) as Record<string, unknown>;

    return NextResponse.json(spec, {
      headers: {
        'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load spec';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
