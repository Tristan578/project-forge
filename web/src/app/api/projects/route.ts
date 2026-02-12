import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { listProjects, createProject } from '@/lib/projects/service';

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

  const body = await req.json();
  const { name, sceneData } = body;

  if (!name || typeof name !== 'string') {
    return NextResponse.json({ error: 'Project name is required' }, { status: 400 });
  }

  if (!sceneData) {
    return NextResponse.json({ error: 'Scene data is required' }, { status: 400 });
  }

  try {
    const project = await createProject(authResult.ctx.user.id, name, sceneData);
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
    throw error;
  }
}
