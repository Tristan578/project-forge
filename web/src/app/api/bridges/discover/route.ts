import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { discoverTool, isAllowedToolId } from '@/lib/bridges/bridgeManager';

export async function POST(req: Request) {
  const auth = await authenticateRequest();
  if (!auth.ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

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
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Discovery failed' },
      { status: 500 }
    );
  }
}
