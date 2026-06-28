import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

// Controllable QStash SDK doubles. The real Client/Receiver are constructed
// lazily per call inside client.ts, so we assert on the constructor + method.
const publishJSON = vi.fn().mockResolvedValue({ messageId: 'm1' });
const verify = vi.fn();
vi.mock('@upstash/qstash', () => ({
  Client: vi.fn(function (this: Record<string, unknown>) { this.publishJSON = publishJSON; }),
  Receiver: vi.fn(function (this: Record<string, unknown>) { this.verify = verify; }),
}));

// getOptionalEnv just reads process.env with a localhost default for the app URL.
vi.mock('@/lib/config/validateEnv', () => ({
  getOptionalEnv: (key: string) => process.env[key] ?? 'http://localhost:3000',
}));

import { Client, Receiver } from '@upstash/qstash';
import {
  isQstashConfigured,
  publishGenerationCallback,
  verifyQstashSignature,
  GENERATION_CALLBACK_PATH,
  type GenerationCallbackPayload,
} from '../client';

const mockClient = vi.mocked(Client);
const mockReceiver = vi.mocked(Receiver);

const PAYLOAD: GenerationCallbackPayload = {
  userId: 'user-1',
  providerJobId: 'job-1',
  type: 'model',
  tokenUsageId: 'usage-1',
  attempt: 0,
};

const ENV_KEYS = [
  'QSTASH_TOKEN',
  'QSTASH_CURRENT_SIGNING_KEY',
  'QSTASH_NEXT_SIGNING_KEY',
  'NEXT_PUBLIC_APP_URL',
] as const;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  vi.clearAllMocks();
  savedEnv = {};
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe('isQstashConfigured', () => {
  it('is false when QSTASH_TOKEN is unset', () => {
    expect(isQstashConfigured()).toBe(false);
  });

  it('is true when QSTASH_TOKEN is set', () => {
    process.env.QSTASH_TOKEN = 'tok';
    expect(isQstashConfigured()).toBe(true);
  });
});

describe('publishGenerationCallback', () => {
  it('no-ops (never constructs a Client) when QStash is unconfigured', async () => {
    await publishGenerationCallback(PAYLOAD, { delaySeconds: 30 });
    expect(mockClient).not.toHaveBeenCalled();
    expect(publishJSON).not.toHaveBeenCalled();
  });

  it('publishes to the callback URL with the payload and an integer delay', async () => {
    process.env.QSTASH_TOKEN = 'tok';
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.spawnforge.ai';

    await publishGenerationCallback(PAYLOAD, { delaySeconds: 30 });

    expect(mockClient).toHaveBeenCalledWith({ token: 'tok' });
    expect(publishJSON).toHaveBeenCalledWith({
      url: `https://app.spawnforge.ai${GENERATION_CALLBACK_PATH}`,
      body: PAYLOAD,
      delay: 30,
    });
  });

  it('strips a trailing slash from the app URL before joining the path', async () => {
    process.env.QSTASH_TOKEN = 'tok';
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.spawnforge.ai/';

    await publishGenerationCallback(PAYLOAD, { delaySeconds: 5 });

    expect(publishJSON).toHaveBeenCalledWith(
      expect.objectContaining({ url: `https://app.spawnforge.ai${GENERATION_CALLBACK_PATH}` }),
    );
  });

  it('rounds fractional delays and clamps negatives to 0', async () => {
    process.env.QSTASH_TOKEN = 'tok';

    await publishGenerationCallback(PAYLOAD, { delaySeconds: 14.6 });
    expect(publishJSON).toHaveBeenLastCalledWith(expect.objectContaining({ delay: 15 }));

    await publishGenerationCallback(PAYLOAD, { delaySeconds: -5 });
    expect(publishJSON).toHaveBeenLastCalledWith(expect.objectContaining({ delay: 0 }));
  });
});

describe('verifyQstashSignature', () => {
  it('rejects when the signature header is missing', async () => {
    process.env.QSTASH_CURRENT_SIGNING_KEY = 'cur';
    process.env.QSTASH_NEXT_SIGNING_KEY = 'next';
    expect(await verifyQstashSignature('{}', null)).toBe(false);
    expect(mockReceiver).not.toHaveBeenCalled();
  });

  it('rejects when the signing keys are unset (never constructs a Receiver)', async () => {
    expect(await verifyQstashSignature('{}', 'sig')).toBe(false);
    expect(mockReceiver).not.toHaveBeenCalled();
  });

  it('returns the receiver verdict when keys + signature are present', async () => {
    process.env.QSTASH_CURRENT_SIGNING_KEY = 'cur';
    process.env.QSTASH_NEXT_SIGNING_KEY = 'next';
    verify.mockResolvedValueOnce(true);

    expect(await verifyQstashSignature('{"a":1}', 'sig')).toBe(true);
    expect(mockReceiver).toHaveBeenCalledWith({ currentSigningKey: 'cur', nextSigningKey: 'next' });
    expect(verify).toHaveBeenCalledWith({ body: '{"a":1}', signature: 'sig' });
  });

  it('fails closed (returns false) when the receiver throws on a bad signature', async () => {
    process.env.QSTASH_CURRENT_SIGNING_KEY = 'cur';
    process.env.QSTASH_NEXT_SIGNING_KEY = 'next';
    verify.mockRejectedValueOnce(new Error('SignatureError'));

    expect(await verifyQstashSignature('{}', 'bad-sig')).toBe(false);
  });
});
