import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';

export async function GET(request: NextRequest) {
  // 1. Authenticate
  const authResult = await authenticateRequest();
  if (!authResult.ok) return authResult.response;

  // 2. Get jobId from query params
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get('jobId');

  if (!jobId) {
    return NextResponse.json({ error: 'Missing jobId parameter' }, { status: 400 });
  }

  // 3. Check if this is a DALL-E job (URL) or Replicate job (prediction ID)
  if (jobId.startsWith('http')) {
    // DALL-E job - already completed, return the URL
    return NextResponse.json({
      jobId,
      status: 'completed',
      progress: 100,
      resultUrl: jobId,
    });
  }

  // 4. Poll Replicate status
  try {
    // We need an API key to check status
    // For now, return pending (would need to resolve key from user)
    return NextResponse.json({
      jobId,
      status: 'processing',
      progress: 50,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Status check failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
