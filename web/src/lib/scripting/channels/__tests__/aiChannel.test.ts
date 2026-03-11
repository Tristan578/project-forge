/**
 * Unit tests for the AI channel handler (aiChannel.ts).
 *
 * Tests cover: unknown method rejection, successful generation with polling,
 * job submission failure, generation failure status, abort signal handling,
 * and progress reporting.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAiHandler } from '../aiChannel';

// Fast polling: override POLL_INTERVAL_MS by controlling Promise resolution
function makeFetchJson(responses: unknown[]) {
  let callIndex = 0;
  return vi.fn((_url: string, _init?: RequestInit) => {
    const response = responses[callIndex++];
    return Promise.resolve(response);
  });
}

function makeSignal(): AbortSignal {
  return new AbortController().signal;
}

describe('createAiHandler', () => {
  const reportProgress = vi.fn();

  beforeEach(() => {
    reportProgress.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('throws for unknown AI methods', async () => {
    const fetchJson = makeFetchJson([]);
    const handler = createAiHandler({ fetchJson });
    await expect(
      handler('unknownMethod', {}, reportProgress, makeSignal()),
    ).rejects.toThrow('Unknown AI method: unknownMethod');
  });

  it('submits to correct route for generateTexture', async () => {
    const fetchJson = makeFetchJson([
      { jobId: 'job-1' },
      { status: 'completed', data: { url: 'texture.png' } },
    ]);
    const handler = createAiHandler({ fetchJson });

    const resultPromise = handler(
      'generateTexture',
      { prompt: 'marble' },
      reportProgress,
      makeSignal(),
    );

    // Advance timer past poll interval so the while loop advances
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(fetchJson).toHaveBeenCalledWith(
      '/api/generate/texture',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(result).toEqual({ url: 'texture.png' });
  });

  it('submits to correct routes for all five generation methods', async () => {
    const methods = [
      ['generateTexture', '/api/generate/texture'],
      ['generateModel', '/api/generate/model'],
      ['generateSound', '/api/generate/sound'],
      ['generateVoice', '/api/generate/voice'],
      ['generateMusic', '/api/generate/music'],
    ] as const;

    for (const [method, expectedRoute] of methods) {
      const fetchJson = makeFetchJson([
        { jobId: 'job-x' },
        { status: 'completed', data: 'asset' },
      ]);
      const handler = createAiHandler({ fetchJson });

      const resultPromise = handler(method, {}, reportProgress, makeSignal());
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(fetchJson.mock.calls[0][0]).toBe(expectedRoute);
    }
  });

  it('throws when job submission returns no jobId', async () => {
    const fetchJson = makeFetchJson([{ error: 'quota exceeded' }]);
    const handler = createAiHandler({ fetchJson });

    await expect(
      handler('generateTexture', {}, reportProgress, makeSignal()),
    ).rejects.toThrow('quota exceeded');
  });

  it('throws with fallback message when submission fails without error field', async () => {
    const fetchJson = makeFetchJson([{}]);
    const handler = createAiHandler({ fetchJson });

    await expect(
      handler('generateTexture', {}, reportProgress, makeSignal()),
    ).rejects.toThrow('Failed to submit generation request');
  });

  it('throws when status is failed', async () => {
    const fetchJson = makeFetchJson([
      { jobId: 'job-2' },
      { status: 'failed', error: 'GPU error' },
    ]);
    const handler = createAiHandler({ fetchJson });

    const error = await handler('generateModel', {}, reportProgress, makeSignal()).catch((e: Error) => e);
    await vi.runAllTimersAsync();
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('GPU error');
  });

  it('throws with fallback message when failed status has no error', async () => {
    const fetchJson = makeFetchJson([
      { jobId: 'job-3' },
      { status: 'failed' },
    ]);
    const handler = createAiHandler({ fetchJson });

    const error = await handler('generateSound', {}, reportProgress, makeSignal()).catch((e: Error) => e);
    await vi.runAllTimersAsync();
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('Generation failed');
  });

  it('reports progress at submission and completion', async () => {
    const fetchJson = makeFetchJson([
      { jobId: 'job-4' },
      { status: 'completed', data: 'done' },
    ]);
    const handler = createAiHandler({ fetchJson });

    const resultPromise = handler('generateMusic', {}, reportProgress, makeSignal());
    await vi.runAllTimersAsync();
    await resultPromise;

    expect(reportProgress).toHaveBeenCalledWith(0, 'Submitting request...');
    expect(reportProgress).toHaveBeenCalledWith(100, 'Done');
  });

  it('reports intermediate progress from status polling', async () => {
    const fetchJson = makeFetchJson([
      { jobId: 'job-5' },
      { status: 'processing', progress: 45, message: 'Rendering...' },
      { status: 'completed', data: 'result' },
    ]);
    const handler = createAiHandler({ fetchJson });

    const resultPromise = handler('generateVoice', {}, reportProgress, makeSignal());
    await vi.runAllTimersAsync();
    await resultPromise;

    expect(reportProgress).toHaveBeenCalledWith(45, 'Rendering...');
  });

  it('uses default progress values when progress/message are missing from status', async () => {
    const fetchJson = makeFetchJson([
      { jobId: 'job-6' },
      { status: 'processing' },
      { status: 'completed', data: null },
    ]);
    const handler = createAiHandler({ fetchJson });

    const resultPromise = handler('generateTexture', {}, reportProgress, makeSignal());
    await vi.runAllTimersAsync();
    await resultPromise;

    expect(reportProgress).toHaveBeenCalledWith(50, 'Processing...');
  });

  it('polls status endpoint with correct job ID', async () => {
    const fetchJson = makeFetchJson([
      { jobId: 'abc-123' },
      { status: 'completed', data: 'ok' },
    ]);
    const handler = createAiHandler({ fetchJson });

    const resultPromise = handler('generateTexture', {}, reportProgress, makeSignal());
    await vi.runAllTimersAsync();
    await resultPromise;

    expect(fetchJson.mock.calls[1][0]).toBe('/api/generate/status/abc-123');
  });

  it('forwards args as JSON body in submission request', async () => {
    const fetchJson = makeFetchJson([
      { jobId: 'job-7' },
      { status: 'completed', data: 'ok' },
    ]);
    const handler = createAiHandler({ fetchJson });

    const args = { prompt: 'sunset', style: 'photorealistic' };
    const resultPromise = handler('generateTexture', args, reportProgress, makeSignal());
    await vi.runAllTimersAsync();
    await resultPromise;

    const submitCall = fetchJson.mock.calls[0];
    const body = JSON.parse((submitCall[1] as RequestInit).body as string);
    expect(body).toEqual(args);
  });

  it('throws cancellation error when signal is already aborted before polling', async () => {
    const controller = new AbortController();
    let callCount = 0;
    const fetchJson = vi.fn((_url: string, _init?: RequestInit) => {
      callCount++;
      // After first call (submit), abort the signal
      if (callCount === 1) {
        controller.abort();
      }
      return Promise.resolve({ jobId: 'job-abort' });
    });
    const handler = createAiHandler({ fetchJson });

    const error = await handler('generateTexture', {}, reportProgress, controller.signal).catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    expect(error).toBeInstanceOf(Error);
  });
});
