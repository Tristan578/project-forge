import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { getProject, updateProject, deleteProject } from '@/lib/projects/service';
import { parseJsonBody, optionalString } from '@/lib/apiValidation';

/**
 * GET /api/projects/[id]
 * Load a single project by ID.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await authenticateRequest();
  if (!authResult.ok) return authResult.response;

  const { id } = await params;
  const project = await getProject(authResult.ctx.user.id, id);

  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  return NextResponse.json(project);
}

/**
 * PUT /api/projects/[id]
 * Update a project.
 * Body: { name?: string, sceneData?: object, thumbnail?: string, entityCount?: number }
 */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await authenticateRequest();
  if (!authResult.ok) return authResult.response;

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
    const nameResult = optionalString(parsed.body.name, 'name', { maxLength: 200 });
    if (!nameResult.ok) return nameResult.response;
    updates.name = nameResult.value;
  }

  if (parsed.body.sceneData !== undefined) {
    updates.sceneData = parsed.body.sceneData;
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
      return NextResponse.json({ error: 'entityCount must be a non-negative integer' }, { status: 400 });
    }
    updates.entityCount = count;
  }

  const project = await updateProject(authResult.ctx.user.id, id, updates);

  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  return NextResponse.json(project);
}

/**
 * DELETE /api/projects/[id]
 * Delete a project.
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await authenticateRequest();
  if (!authResult.ok) return authResult.response;

  const { id } = await params;
  const deleted = await deleteProject(authResult.ctx.user.id, id);

  if (!deleted) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  return new NextResponse(null, { status: 204 });
}
