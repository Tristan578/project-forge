import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { UPSTASH_REST_TIMEOUT_MS } from '@/lib/config/timeouts';
import {
  MAX_ERROR_DETAIL_CHARS,
  UpstashCommandError,
  isUpstashConfigured,
  normalizeDetail,
  postUpstashCommand,
} from '../restCommand';

const mockFetch = vi.fn();

function response(status: number, body: string, statusText = status === 200 ? 'OK' : 'Bad Request') {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    text: async () => body,
    json: async () => JSON.parse(body) as unknown,
  };
}

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal('fetch', mockFetch);
  vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.upstash.io');
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'test-token');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('postUpstashCommand', () => {
  it('posts the command array in body form to the BASE url with bearer auth', async () => {
    mockFetch.mockResolvedValue(response(200, '{"result":1}'));

    const result = await postUpstashCommand(['EVAL', 'return 1', 0]);

    expect(result).toBe(1);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    // Never a path such as `/eval`: Upstash appends a body to a path-form
    // command as ONE trailing argument (#9623).
    expect(url).toBe('https://redis.upstash.io');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(['EVAL', 'return 1', 0]);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-token');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('bounds every request with AbortSignal.timeout(UPSTASH_REST_TIMEOUT_MS) by default', async () => {
    const spy = vi.spyOn(AbortSignal, 'timeout');
    mockFetch.mockResolvedValue(response(200, '{"result":"PONG"}'));

    await postUpstashCommand(['PING']);

    expect(spy).toHaveBeenCalledWith(UPSTASH_REST_TIMEOUT_MS);
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('honours an explicit timeout', async () => {
    const spy = vi.spyOn(AbortSignal, 'timeout');
    mockFetch.mockResolvedValue(response(200, '{"result":"PONG"}'));

    await postUpstashCommand(['PING'], { timeoutMs: 750 });

    expect(spy).toHaveBeenCalledWith(750);
  });

  it('throws UpstashCommandError with the bounded, collapsed error body on a refused command', async () => {
    mockFetch.mockResolvedValue(
      response(400, '{"error":"ERR wrong number of arguments\n\n   for \'eval\' command"}'),
    );

    const err = await postUpstashCommand(['EVAL', 'x', 0]).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(UpstashCommandError);
    expect((err as UpstashCommandError).message).toBe(
      "Upstash EVAL failed: 400 Bad Request — {\"error\":\"ERR wrong number of arguments for 'eval' command\"}",
    );
    expect((err as UpstashCommandError).status).toBe(400);
  });

  it('omits the separator when the error body is unreadable or blank', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      text: async () => { throw new Error('stream closed'); },
      json: async () => ({}),
    });
    let err = await postUpstashCommand(['PING']).catch((e: unknown) => e);
    expect((err as Error).message).toBe('Upstash PING failed: 502 Bad Gateway');

    mockFetch.mockResolvedValueOnce(response(503, '   \n ', 'Service Unavailable'));
    err = await postUpstashCommand(['PING']).catch((e: unknown) => e);
    expect((err as Error).message).toBe('Upstash PING failed: 503 Service Unavailable');
  });

  it('names a non-JSON success body and a body without a result', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => '<html>maintenance</html>',
      json: async () => { throw new SyntaxError('Unexpected token <'); },
    });
    let err = await postUpstashCommand(['PING']).catch((e: unknown) => e);
    expect((err as Error).message).toBe('Upstash PING answered with a non-JSON body');

    mockFetch.mockResolvedValueOnce(response(200, '{"error":"unexpected"}'));
    err = await postUpstashCommand(['PING']).catch((e: unknown) => e);
    expect((err as Error).message).toBe('Upstash PING answered without a result: {"error":"unexpected"}');
  });

  it('refuses to run without configuration instead of posting to an empty url', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    const err = await postUpstashCommand(['PING']).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UpstashCommandError);
    expect((err as UpstashCommandError).status).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('helpers', () => {
  it('normalizeDetail collapses whitespace and bounds the length', () => {
    expect(normalizeDetail('  ERR foo\n\n\t bar ')).toBe('ERR foo bar');
    expect(normalizeDetail('x'.repeat(1000))).toHaveLength(MAX_ERROR_DETAIL_CHARS);
  });

  it('isUpstashConfigured needs both variables', () => {
    expect(isUpstashConfigured()).toBe(true);
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    expect(isUpstashConfigured()).toBe(false);
  });
});
