import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { getUsageHistory } from '@/lib/tokens/service';

export async function GET(req: Request) {
  const authResult = await authenticateRequest();
  if (!authResult.ok) return authResult.response;

  const url = new URL(req.url);
  const days = parseInt(url.searchParams.get('days') ?? '30', 10);

  const usage = await getUsageHistory(authResult.ctx.user.id, Math.min(days, 90));
  return NextResponse.json({ usage });
}
