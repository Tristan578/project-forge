import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/lib/api/middleware';
import { getProject, updateProject, deleteProject } from '@/lib/projects/service';
import { parseJsonBody, requireString, requireObject, optionalString } from '@/lib/apiValidation';
import { captureException } from '@/lib/monitoring/sentry-server';
import { validationError, notFound, internalError } from '@/lib/api/errors';

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
  });
  if (mid.error) return mid.error;

  const { id } = await params;
  const parsed = await parseJsonBody(req);
  if (!parsed.ok) return parsed.response;

  const updates: {
    name?: string;
    sceneData?: unknown;
    thumbnail?: string | null;
    entityCount?: number;
  } = {};

  if (parsed.body.name !== undefined) {
    const nameResult = requireString(parsed.body.name, 'name', { minLength: 1, maxLength: 200 });
    if (!nameResult.ok) return nameResult.response;
    updates.name = nameResult.value;
  }

  if (parsed.body.sceneData !== undefined) {
    const sceneResult = requireObject(parsed.body.sceneData, 'sceneData');
    if (!sceneResult.ok) return sceneResult.response;
    updates.sceneData = sceneResult.value;
  }

  if (parsed.body.thumbnail !== undefined) {
    if (parsed.body.thumbnail === null) {
      updates.thumbnail = null;
    } else {
      const thumbResult = optionalString(parsed.body.thumbnail, 'thumbnail', { maxLength: 500_000 });
      if (!thumbResult.ok) return thumbResult.response;
      updates.thumbnail = thumbResult.value ?? null;
    }
  }

  if (parsed.body.entityCount !== undefined) {
    const count = parsed.body.entityCount;
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) {
      return validationError('entityCount must be a non-negative integer');
    }
    updates.entityCount = count;
  }

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
