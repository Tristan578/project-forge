import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withApiMiddleware } from '@/lib/api/middleware';
import { executeOperation } from '@/lib/bridges/asepriteBridge';
import { discoverTool } from '@/lib/bridges/bridgeManager';
import type { BridgeToolConfig } from '@/lib/bridges/types';
import { ALLOWED_TEMPLATES } from '@/lib/bridges/luaTemplates';
import { captureException } from '@/lib/monitoring/sentry-server';
import { BRIDGE_CACHE_TTL_MS } from '@/lib/config/timeouts';

const asepriteExecuteSchema = z.object({
  operation: z.string().min(1).max(100),
  params: z.record(z.string(), z.unknown()).nullish(),
});

// Cache discovered tool config to avoid spawning a child process on every request
let cachedTool: { config: BridgeToolConfig; expiresAt: number } | null = null;

async function getCachedTool(): Promise<BridgeToolConfig> {
  const now = Date.now();
  if (cachedTool && now < cachedTool.expiresAt) {
    return cachedTool.config;
  }
  const config = await discoverTool('aseprite');
  cachedTool = { config, expiresAt: now + BRIDGE_CACHE_TTL_MS };
  return config;
}

export async function POST(req: NextRequest) {
  const mid = await withApiMiddleware(req, {
    requireAuth: true,
    rateLimit: true,
    rateLimitConfig: { key: (id) => `user:bridges-aseprite-execute:${id}`, max: 10, windowSeconds: 60, distributed: false },
    validate: asepriteExecuteSchema,
  });
  if (mid.error) return mid.error;

  try {
    const { operation, params } = mid.body as z.infer<typeof asepriteExecuteSchema>;

    // Runtime allowlist check — ALLOWED_TEMPLATES is a Set, not expressible as a static Zod enum
    if (!ALLOWED_TEMPLATES.has(operation)) {
      return NextResponse.json(
        { error: `Unknown operation: "${operation}". Allowed: ${[...ALLOWED_TEMPLATES].join(', ')}` },
        { status: 400 }
      );
    }

    const tool = await getCachedTool();
    if (tool.status !== 'connected') {
      return NextResponse.json(
        { error: `Aseprite not available: ${tool.status}` },
        { status: 503 }
      );
    }

    const plat = process.platform as 'darwin' | 'win32' | 'linux';
    const binaryPath = tool.paths[plat];
    if (!binaryPath) {
      return NextResponse.json(
        { error: 'No Aseprite binary path for current platform' },
        { status: 503 }
      );
    }

    const result = await executeOperation(binaryPath, {
      name: operation,
      params: params ?? {},
    });

    return NextResponse.json(result);
  } catch (err) {
    captureException(err, { route: '/api/bridges/aseprite/execute' });
    // Return a generic error message to avoid leaking internal paths or system details.
    // The full error is captured by Sentry above for debugging.
    return NextResponse.json(
      { error: 'Aseprite operation failed. Check Sentry for details.' },
      { status: 500 }
    );
  }
}
