import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { executeOperation } from '@/lib/bridges/asepriteBridge';
import { discoverTool } from '@/lib/bridges/bridgeManager';
import { ALLOWED_TEMPLATES } from '@/lib/bridges/luaTemplates';

export async function POST(req: Request) {
  const auth = await authenticateRequest();
  if (!auth.ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { operation, params } = body ?? {};

    if (!operation || typeof operation !== 'string') {
      return NextResponse.json({ error: 'operation is required' }, { status: 400 });
    }

    if (!ALLOWED_TEMPLATES.has(operation)) {
      return NextResponse.json(
        { error: `Unknown operation: "${operation}". Allowed: ${[...ALLOWED_TEMPLATES].join(', ')}` },
        { status: 400 }
      );
    }

    // Validate params is a plain object with string/number/boolean values
    if (params != null && typeof params !== 'object') {
      return NextResponse.json({ error: 'params must be an object' }, { status: 400 });
    }

    const tool = await discoverTool('aseprite');
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
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Execution failed' },
      { status: 500 }
    );
  }
}
