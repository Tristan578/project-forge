import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/lib/api/middleware';
import { listProjects, createProject } from '@/lib/projects/service';
import { captureException } from '@/lib/monitoring/sentry-server';
import { parseJsonBody, requireString, requireObject } from '@/lib/apiValidation';

/**
 * GET /api/projects
 * List all projects for the authenticated user.
 */
export async function GET(req: NextRequest) {
  const mid = await withApiMiddleware(req, {
    requireAuth: true,
    rateLimit: true,
    rateLimitConfig: { key: (id) => `projects-list:${id}`, max: 60, windowSeconds: 60 },
  });
  if (mid.error) return mid.error;

  try {
    const projectsList = await listProjects(mid.userId!);
    return NextResponse.json(projectsList);
  } catch (error) {
    captureException(error, { route: '/api/projects', method: 'GET' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/projects
 * Create a new project.
 * Body: { name: string, sceneData: object }
 */
export async function POST(req: NextRequest) {
  const mid = await withApiMiddleware(req, {
    requireAuth: true,
    rateLimit: true,
    rateLimitConfig: { key: (id) => `projects-create:${id}`, max: 10, windowSeconds: 60 },
  });
  if (mid.error) return mid.error;

  const parsed = await parseJsonBody(req);
  if (!parsed.ok) return parsed.response;

  const nameResult = requireString(parsed.body.name, 'Project name', { maxLength: 200 });
  if (!nameResult.ok) return nameResult.response;

  const sceneResult = requireObject(parsed.body.sceneData, 'Scene data');
  if (!sceneResult.ok) return sceneResult.response;

  try {
    const project = await createProject(mid.userId!, nameResult.value, sceneResult.value);
    return NextResponse.json({ id: project.id, name: project.name }, { status: 201 });
  } catch (error) {
    const err = error as Error & { limit?: number };
    if (err.message === 'Project limit exceeded') {
      return NextResponse.json(
        {
          error: 'PROJECT_LIMIT',
          message: `Your plan allows ${err.limit} project${err.limit === 1 ? '' : 's'}. Upgrade to create more.`,
          limit: err.limit,
        },
        { status: 403 }
      );
    }
    captureException(error, { route: '/api/projects', action: 'create' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
