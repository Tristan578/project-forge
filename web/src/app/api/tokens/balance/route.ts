import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { getTokenBalance } from '@/lib/tokens/service';

export async function GET() {
  const authResult = await authenticateRequest();
  if (!authResult.ok) return authResult.response;

  const balance = await getTokenBalance(authResult.ctx.user.id);
  return NextResponse.json(balance);
}
