import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/sentry
 *
 * Tunnel endpoint that proxies Sentry envelope data to sentry.io.
 * This bypasses ad-blockers that block requests to sentry.io directly.
 *
 * The envelope format is newline-delimited JSON. The first line (header)
 * contains a `dsn` field we use to determine the upstream project URL.
 *
 * Security: The upstream host and project ID are derived from a trusted
 * server-side env var (SENTRY_DSN / NEXT_PUBLIC_SENTRY_DSN) at module load.
 * Envelopes whose DSN does not match the configured values are rejected,
 * preventing server-side request forgery via user-controlled hosts.
 */

// --- Trusted configuration derived once at module load ---
function parseTrustedSentryConfig(): { host: string; projectId: string } | null {
  const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return null;
  try {
    const url = new URL(dsn);
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length !== 1 || !/^\d+$/.test(segments[0])) return null;
    if (!url.hostname.endsWith('.sentry.io') && url.hostname !== 'sentry.io') return null;
    return { host: url.hostname, projectId: segments[0] };
  } catch {
    return null;
  }
}

const TRUSTED_SENTRY = parseTrustedSentryConfig();

export async function POST(request: NextRequest) {
  try {
    if (!TRUSTED_SENTRY) {
      return NextResponse.json({ error: 'Sentry tunnel not configured' }, { status: 503 });
    }

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

    // Validate the envelope DSN matches our trusted configuration
    let dsnUrl: URL;
    try {
      dsnUrl = new URL(dsn);
    } catch {
      return NextResponse.json({ error: 'Invalid DSN URL' }, { status: 400 });
    }

    const dsnSegments = dsnUrl.pathname.split('/').filter(Boolean);
    if (
      dsnUrl.hostname !== TRUSTED_SENTRY.host ||
      dsnSegments.length !== 1 ||
      dsnSegments[0] !== TRUSTED_SENTRY.projectId
    ) {
      return NextResponse.json({ error: 'DSN does not match configured Sentry project' }, { status: 403 });
    }

    // Build the upstream URL from trusted config only (not from request data)
    const upstreamUrl = `https://${TRUSTED_SENTRY.host}/api/${TRUSTED_SENTRY.projectId}/envelope/`;

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
