import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { getProject, updateProject, deleteProject } from '@/lib/projects/service';

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
  const body = await req.json();

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
