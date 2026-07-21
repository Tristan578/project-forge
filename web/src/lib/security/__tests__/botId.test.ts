import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('botid/server', () => ({ checkBotId: vi.fn() }));
vi.mock('@/lib/monitoring/sentry-server', () => ({ captureException: vi.fn() }));

import { checkBotId } from 'botid/server';
import { captureException } from '@/lib/monitoring/sentry-server';
import { checkBotIdGate } from '../botId';

const mockCheckBotId = vi.mocked(checkBotId);
const mockCapture = vi.mocked(captureException);

describe('checkBotIdGate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null (pass-through) for a human verdict', async () => {
    mockCheckBotId.mockResolvedValue({
      isHuman: true,
      isBot: false,
      isVerifiedBot: false,
      bypassed: false,
    });

    const res = await checkBotIdGate();

    expect(res).toBeNull();
  });

  it('returns a 403 NextResponse when isBot is true', async () => {
    mockCheckBotId.mockResolvedValue({
      isHuman: false,
      isBot: true,
      isVerifiedBot: false,
      bypassed: false,
    });

    const res = await checkBotIdGate();

    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
    const body = await res!.json();
    // The error string is toast'd verbatim to users, so lock in that it tells
    // them what to do (retry, then contact support) and carries the stable
    // support-lookup code.
    expect(body).toEqual({
      error:
        'We could not verify this request came from your browser. Please refresh the page and try again — if this keeps happening, contact support and mention code BOT_CHECK.',
      code: 'BOT_CHECK',
    });
  });

  it('pins checkLevel to basic — code-only mode, independent of the Deep Analysis dashboard toggle', async () => {
    mockCheckBotId.mockResolvedValue({
      isHuman: true,
      isBot: false,
      isVerifiedBot: false,
      bypassed: false,
    });

    await checkBotIdGate();

    expect(mockCheckBotId).toHaveBeenCalledWith({ advancedOptions: { checkLevel: 'basic' } });
  });

  it('fails open when checkBotId() rejects — a BotID outage never blocks a route', async () => {
    const err = new Error('botid unreachable');
    mockCheckBotId.mockRejectedValue(err);

    const res = await checkBotIdGate();

    expect(res).toBeNull();
    expect(mockCapture).toHaveBeenCalledWith(err, expect.objectContaining({ route: 'checkBotIdGate' }));
  });
});
