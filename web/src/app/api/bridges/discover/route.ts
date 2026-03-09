import { NextResponse } from 'next/server';
import { discoverTool } from '@/lib/bridges/bridgeManager';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const toolId = body?.toolId;
    const customPath = body?.customPath;

    if (!toolId || typeof toolId !== 'string') {
      return NextResponse.json({ error: 'toolId is required' }, { status: 400 });
    }

    const config = await discoverTool(toolId, customPath);
    return NextResponse.json(config);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Discovery failed' },
      { status: 500 }
    );
  }
}
