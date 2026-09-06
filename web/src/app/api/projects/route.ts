import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/lib/api/middleware';
import { listProjects, createProject } from '@/lib/projects/service';
import { captureException } from '@/lib/monitoring/sentry-server';
import { apiError, internalError } from '@/lib/api/errors';
import { z } from 'zod';

const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(200),
  sceneData: z.record(z.string(), z.unknown()),
});

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
    return internalError();
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
    validate: createProjectSchema,
  });
  if (mid.error) return mid.error;

  const { name, sceneData } = mid.body as z.infer<typeof createProjectSchema>;

  try {
    const project = await createProject(mid.userId!, name, sceneData);
    return NextResponse.json({ id: project.id, name: project.name }, { status: 201 });
  } catch (error) {
    const err = error as Error & { limit?: number };
    if (err.message === 'Project limit exceeded') {
      // The only value read from the caught error here is `err.limit`, a number
      // that `lib/projects/service.ts` attaches itself. The sentence is ours and
      // no upstream text can reach it. The rule's `instanceof` exemption does
      // not apply because this error is narrowed by MESSAGE rather than by type;
      // typing it would ripple through the remix route and four suites, which is
      // a refactor this security fix should not be carrying.
      // eslint-disable-next-line spawnforge/no-raw-response-in-catch -- err.limit is a number we set; see above
      return apiError(
        403,
        `Your plan allows ${err.limit} project${err.limit === 1 ? '' : 's'}. Upgrade to create more.`,
        'PROJECT_LIMIT',
        { limit: err.limit },
      );
    }
    captureException(error, { route: '/api/projects', action: 'create' });
    return internalError();
  }
}
