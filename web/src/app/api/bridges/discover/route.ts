import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withApiMiddleware } from '@/lib/api/middleware';
import { discoverTool, isAllowedToolId } from '@/lib/bridges/bridgeManager';
import { captureException } from '@/lib/monitoring/sentry-server';

const discoverSchema = z.object({
  toolId: z.string().min(1).max(100),
});

export async function POST(req: NextRequest) {
  const mid = await withApiMiddleware(req, {
    requireAuth: true,
    rateLimit: true,
    rateLimitConfig: { key: (id) => `user:bridges-discover:${id}`, max: 10, windowSeconds: 60, distributed: false },
    validate: discoverSchema,
  });
  if (mid.error) return mid.error;

  try {
    const { toolId } = mid.body as z.infer<typeof discoverSchema>;

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
