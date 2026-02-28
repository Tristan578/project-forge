import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { deleteUserAccount } from '@/lib/auth/user-service';

/**
 * POST /api/user/delete
 * Permanently delete the authenticated user's account and all associated data.
 */
export async function POST() {
  const authResult = await authenticateRequest();
  if (!authResult.ok) return authResult.response;

  try {
    await deleteUserAccount(authResult.ctx.user.id);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    console.error('Account deletion failed:', err);
    return NextResponse.json(
      { error: 'Failed to delete account' },
      { status: 500 }
    );
  }
}
