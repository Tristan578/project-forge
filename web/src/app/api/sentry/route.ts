import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/sentry
 *
 * Tunnel endpoint that proxies Sentry envelope data to sentry.io.
 * This bypasses ad-blockers that block requests to sentry.io directly.
 *
 * The envelope format is newline-delimited JSON. The first line (header)
 * contains a `dsn` field we use to determine the upstream project URL.
 */
export async function POST(request: NextRequest) {
  try {
    const envelope = await request.text();
    if (!envelope) {
      return NextResponse.json({ error: 'Empty envelope' }, { status: 400 });
    }

    // Parse the first line to extract the DSN
    const firstLine = envelope.split('\n')[0];
    let header: { dsn?: string };
    try {
      header = JSON.parse(firstLine);
    } catch {
      return NextResponse.json({ error: 'Invalid envelope header' }, { status: 400 });
    }

    const dsn = header.dsn;
    if (!dsn) {
      return NextResponse.json({ error: 'Missing DSN in envelope' }, { status: 400 });
    }

    // Parse the DSN to extract host and project ID
    // DSN format: https://<key>@<host>/<project-id>
    let dsnUrl: URL;
    try {
      dsnUrl = new URL(dsn);
    } catch {
      return NextResponse.json({ error: 'Invalid DSN URL' }, { status: 400 });
    }

    // Only allow forwarding to sentry.io hosts
    const host = dsnUrl.hostname;
    if (!host.endsWith('.sentry.io') && host !== 'sentry.io') {
      return NextResponse.json({ error: 'Invalid Sentry host' }, { status: 403 });
    }

    // Build the upstream envelope URL
    // https://<host>/api/<project-id>/envelope/
    // Extract single expected path segment (DSN format: https://key@host/project-id)
    const pathSegments = dsnUrl.pathname.split('/').filter(Boolean);
    if (pathSegments.length !== 1) {
      return NextResponse.json({ error: 'Invalid DSN path' }, { status: 400 });
    }
    const projectId = pathSegments[0];

    // Validate projectId is a numeric string (Sentry project IDs are always numeric)
    if (!/^\d+$/.test(projectId)) {
      return NextResponse.json({ error: 'Invalid project ID in DSN' }, { status: 400 });
    }

    const upstreamUrl = new URL(`https://${host}/api/${projectId}/envelope/`);

    // Forward the envelope
    const upstreamResponse = await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-sentry-envelope',
      },
      body: envelope,
    });

    return new NextResponse(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  } catch {
    // Silently fail -- tunnel errors should not break the app
    return NextResponse.json({ error: 'Tunnel error' }, { status: 500 });
  }
}
