import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withApiMiddleware } from '@/lib/api/middleware';
import { getProject, updateProject, deleteProject } from '@/lib/projects/service';
import { captureException } from '@/lib/monitoring/sentry-server';
import { notFound, internalError } from '@/lib/api/errors';

const updateProjectSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  sceneData: z.record(z.string(), z.unknown()).optional(),
  thumbnail: z.string().max(500_000).nullable().optional(),
  entityCount: z.number().int().nonnegative().optional(),
});

/**
 * GET /api/projects/[id]
 * Load a single project by ID.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
