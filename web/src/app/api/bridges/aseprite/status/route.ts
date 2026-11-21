import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/lib/api/middleware';
import { discoverTool } from '@/lib/bridges/bridgeManager';
import { captureException } from '@/lib/monitoring/sentry-server';

export async function GET(req: NextRequest) {
  const mid = await withApiMiddleware(req, {
    requireAuth: true,
    rateLimit: true,
    rateLimitConfig: { key: (id) => `user:bridges-aseprite-status:${id}`, max: 30, windowSeconds: 60, distributed: false },
  });
  if (mid.error) return mid.error;

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
