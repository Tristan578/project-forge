import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { discoverTool } from '@/lib/bridges/bridgeManager';
import { rateLimit, rateLimitResponse } from '@/lib/rateLimit';
import { captureException } from '@/lib/monitoring/sentry-server';

export async function GET() {
  const auth = await authenticateRequest();
  if (!auth.ok) {
    return auth.response;
  }

  const rl = await rateLimit(`user:bridges-aseprite-status:${auth.ctx.user.id}`, 30, 60_000);
  if (!rl.allowed) return rateLimitResponse(rl.remaining, rl.resetAt);

  try {
    const config = await discoverTool('aseprite');
    // Only expose status and version — never leak filesystem paths
    return NextResponse.json({
      status: config.status,
      version: config.activeVersion,
    });
  } catch (err) {
    captureException(err, { route: '/api/bridges/aseprite/status' });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Status check failed' },
      { status: 500 }
    );
  }
}
