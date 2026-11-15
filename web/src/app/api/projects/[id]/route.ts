import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withApiMiddleware } from '@/lib/api/middleware';
import { getProject, updateProject, deleteProject } from '@/lib/projects/service';
import { captureException } from '@/lib/monitoring/sentry-server';
import { notFound, internalError } from '@/lib/api/errors';
import { withEgressGuard } from '@/lib/security/egressGuard';

const updateProjectSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  sceneData: z.record(z.string(), z.unknown()).optional(),
  thumbnail: z.string().max(500_000).nullable().optional(),
  entityCount: z.number().int().nonnegative().optional(),
});

/**
 * GET /api/projects/[id]
 * Load a single project by ID.
 */
async function GET_impl(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const mid = await withApiMiddleware(req, {
    requireAuth: true,
    rateLimit: true,
    rateLimitConfig: { key: (id) => `user:project-get:${id}`, max: 30, windowSeconds: 60, distributed: false },
  });
  if (mid.error) return mid.error;

  const { id } = await params;

  try {
    const project = await getProject(mid.userId!, id);

    if (!project) {
      return notFound('Project not found');
    }

    return NextResponse.json(project);
  } catch (error) {
    captureException(error, { route: '/api/projects/[id]', method: 'GET' });
    return internalError();
  }
}

/**
 * PUT /api/projects/[id]
 * Update a project.
 * Body: { name?: string, sceneData?: object, thumbnail?: string, entityCount?: number }
 */
async function PUT_impl(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const mid = await withApiMiddleware(req, {
    requireAuth: true,
    rateLimit: true,
    rateLimitConfig: { key: (id) => `user:project-put:${id}`, max: 10, windowSeconds: 60, distributed: false },
    validate: updateProjectSchema,
  });
  if (mid.error) return mid.error;

  const { id } = await params;
  const body = mid.body as z.infer<typeof updateProjectSchema>;

  const updates: {
    name?: string;
    sceneData?: unknown;
    thumbnail?: string | null;
    entityCount?: number;
  } = {};

  if (body.name !== undefined) updates.name = body.name;
  if (body.sceneData !== undefined) updates.sceneData = body.sceneData;
  if (body.thumbnail !== undefined) updates.thumbnail = body.thumbnail;
  if (body.entityCount !== undefined) updates.entityCount = body.entityCount;

  try {
    const project = await updateProject(mid.userId!, id, updates);

    if (!project) {
      return notFound('Project not found');
    }

    return NextResponse.json(project);
  } catch (error) {
    captureException(error, { route: '/api/projects/[id]', method: 'PUT' });
    return internalError();
  }
}

/**
 * DELETE /api/projects/[id]
 * Delete a project.
 */
async function DELETE_impl(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const mid = await withApiMiddleware(req, {
    requireAuth: true,
    rateLimit: true,
    rateLimitConfig: { key: (id) => `user:project-delete:${id}`, max: 10, windowSeconds: 60, distributed: false },
  });
  if (mid.error) return mid.error;

  const { id } = await params;

  try {
    const deleted = await deleteProject(mid.userId!, id);

    if (!deleted) {
      return notFound('Project not found');
    }

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    captureException(error, { route: '/api/projects/[id]', method: 'DELETE' });
    return internalError();
  }
}

// Egress guard (#9736): every response this route returns leaves through the
// one redaction chokepoint. See `src/lib/security/egressGuard.ts`.
export const GET = withEgressGuard(GET_impl);
export const PUT = withEgressGuard(PUT_impl);
export const DELETE = withEgressGuard(DELETE_impl);
