import { NextResponse } from 'next/server';
import { executeOperation } from '@/lib/bridges/asepriteBridge';
import { discoverTool } from '@/lib/bridges/bridgeManager';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { operation, params, customPath } = body ?? {};

    if (!operation || typeof operation !== 'string') {
      return NextResponse.json({ error: 'operation is required' }, { status: 400 });
    }

    const tool = await discoverTool('aseprite', customPath);
    if (tool.status !== 'connected') {
      return NextResponse.json(
        { error: `Aseprite not available: ${tool.status}` },
        { status: 503 }
      );
    }

    const platform = process.platform as 'darwin' | 'win32' | 'linux';
    const binaryPath = tool.customPath || tool.paths[platform];
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
