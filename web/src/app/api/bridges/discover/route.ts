import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/lib/api/middleware';
import { discoverTool, isAllowedToolId } from '@/lib/bridges/bridgeManager';
import { captureException } from '@/lib/monitoring/sentry-server';

export async function POST(req: NextRequest) {
  const mid = await withApiMiddleware(req, {
    requireAuth: true,
    rateLimit: true,
    rateLimitConfig: { key: (id) => `user:bridges-discover:${id}`, max: 10, windowSeconds: 60, distributed: false },
  });
  if (mid.error) return mid.error;

  try {
    const body = await req.json();
    const toolId = body?.toolId;

    if (!toolId || typeof toolId !== 'string') {
      return NextResponse.json({ error: 'toolId is required' }, { status: 400 });
    }

    if (!isAllowedToolId(toolId)) {
      return NextResponse.json(
        { error: `Unknown tool: "${toolId}". Only known tools are supported.` },
        { status: 400 }
      );
    }

    const config = await discoverTool(toolId);
    // Strip filesystem paths from response — only return status and version
    return NextResponse.json({
      id: config.id,
      name: config.name,
      status: config.status,
      activeVersion: config.activeVersion,
    });
  } catch (err) {
    captureException(err, { route: '/api/bridges/discover' });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Discovery failed' },
      { status: 500 }
    );
  }
}
