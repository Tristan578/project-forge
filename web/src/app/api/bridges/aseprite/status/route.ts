import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/lib/api/middleware';
import { discoverTool } from '@/lib/bridges/bridgeManager';
import { captureException } from '@/lib/monitoring/sentry-server';
import { redactedJson } from '@/lib/api/errors';

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
    return redactedJson(
      // Fixed text rather than the caught message, which can name a local path
      // or port (#9736) — but still ACTIONABLE. This bridge runs on the user's
      // own machine and they are the only person who can fix it, so a bare
      // "Status check failed" removed the one thing that made the message
      // useful without protecting anything extra.
      {
        error:
          'Could not reach the local Aseprite bridge. Check that Aseprite is installed and the bridge is running, then try again.',
      },
      { status: 500 }
    );
  }
}
