import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { listProjects, createProject } from '@/lib/projects/service';
import { captureException } from '@/lib/monitoring/sentry-server';
import { rateLimit, rateLimitResponse } from '@/lib/rateLimit';
import { parseJsonBody, requireString, requireObject } from '@/lib/apiValidation';
import { apiErrorResponse, ErrorCode } from '@/lib/api/errors';

/**
 * GET /api/projects
 * List all projects for the authenticated user.
 */
export async function GET() {
  const authResult = await authenticateRequest();
  if (!authResult.ok) return authResult.response;

  const projectsList = await listProjects(authResult.ctx.user.id);

  return NextResponse.json(projectsList);
}

/**
 * POST /api/projects
 * Create a new project.
 * Body: { name: string, sceneData: object }
 */
export async function POST(req: Request) {
  const authResult = await authenticateRequest();
  if (!authResult.ok) return authResult.response;

  // Rate limit: 10 project creation requests per minute per user
  const rl = rateLimit(`projects-create:${authResult.ctx.user.id}`, 10, 60_000);
  if (!rl.allowed) return rateLimitResponse(rl.remaining, rl.resetAt);

  const parsed = await parseJsonBody(req);
  if (!parsed.ok) return parsed.response;

  const nameResult = requireString(parsed.body.name, 'Project name', { maxLength: 200 });
  if (!nameResult.ok) return nameResult.response;

  const sceneResult = requireObject(parsed.body.sceneData, 'Scene data');
  if (!sceneResult.ok) return sceneResult.response;

  try {
    const project = await createProject(authResult.ctx.user.id, nameResult.value, sceneResult.value);
    return NextResponse.json({ id: project.id, name: project.name }, { status: 201 });
  } catch (error) {
    const err = error as Error & { limit?: number };
    if (err.message === 'Project limit exceeded') {
      return apiErrorResponse(
        ErrorCode.FORBIDDEN,
        `Your plan allows ${err.limit} project${err.limit === 1 ? '' : 's'}. Upgrade to create more.`,
        403,
        { details: { limit: err.limit } }
      );
    }
    captureException(error, { route: '/api/projects', action: 'create' });
    throw error;
  }
}
