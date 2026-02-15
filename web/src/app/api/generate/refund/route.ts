import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { refundTokens } from '@/lib/tokens/service';

export async function POST(request: NextRequest) {
  // 1. Authenticate
  const authResult = await authenticateRequest();
  if (!authResult.ok) return authResult.response;

  // 2. Parse request
  let body: {
    usageId: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { usageId } = body;

  if (!usageId) {
    return NextResponse.json({ error: 'usageId required' }, { status: 400 });
  }

  // 3. Refund tokens
  try {
    await refundTokens(authResult.ctx.user.id, usageId);

    return NextResponse.json({
      success: true,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Refund error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
