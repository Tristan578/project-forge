import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { getDb } from '@/lib/db/client';
import { apiKeys } from '@/lib/db/schema';

/** DELETE /api/keys/api-key/:id — revoke an API key */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await authenticateRequest();
  if (!authResult.ok) return authResult.response;

  const { id } = await params;
  const db = getDb();

  const deleted = await db
    .delete(apiKeys)
    .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, authResult.ctx.user.id)))
    .returning({ id: apiKeys.id });

  if (deleted.length === 0) {
    return NextResponse.json({ error: 'API key not found' }, { status: 404 });
  }

  return NextResponse.json({ success: true, revoked: id });
}
