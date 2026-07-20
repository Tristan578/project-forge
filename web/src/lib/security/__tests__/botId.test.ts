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
    expect(body).toEqual({ error: expect.any(String) });
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
