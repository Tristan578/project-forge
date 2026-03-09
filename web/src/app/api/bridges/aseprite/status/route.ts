import { NextResponse } from 'next/server';
import { discoverTool } from '@/lib/bridges/bridgeManager';

export async function GET() {
  try {
    const config = await discoverTool('aseprite');
    return NextResponse.json({
      status: config.status,
      version: config.activeVersion,
      paths: config.paths,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Status check failed' },
      { status: 500 }
    );
  }
}
