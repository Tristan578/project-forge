import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { POST } from './route';

describe('POST /api/sentry', () => {
  it('forwards envelopes only to sentry.io host URL', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue({
      status: 200,
      body: null,
    } as Response);

    const envelope = `${JSON.stringify({ dsn: 'https://key@o123.ingest.sentry.io/456' })}\n{}`;
    const request = new NextRequest('http://localhost/api/sentry', { method: 'POST', body: envelope });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({ origin: 'https://o123.ingest.sentry.io', pathname: '/api/456/envelope/' }),
      expect.any(Object),
    );
  });
});
