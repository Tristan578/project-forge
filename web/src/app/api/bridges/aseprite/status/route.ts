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
      // Fixed text: the bridge's own error can name a local path or port (#9736).
      { error: 'Status check failed' },
      { status: 500 }
    );
  }
}
