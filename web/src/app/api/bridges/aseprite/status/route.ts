import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { discoverTool } from '@/lib/bridges/bridgeManager';

export async function GET() {
  const auth = await authenticateRequest();
  if (!auth.ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const config = await discoverTool('aseprite');
    // Only expose status and version — never leak filesystem paths
    return NextResponse.json({
      status: config.status,
      version: config.activeVersion,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Status check failed' },
      { status: 500 }
    );
  }
}
