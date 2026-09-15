import { describe, it, expect, vi, afterEach } from 'vitest';
import { assetGenerateExecutor } from '../assetGenerateExecutor';
import type { ExecutorContext } from '../../types';

/**
 * Coverage for operation `ai.FR-1.OP-04` (#9900 / parent #9808, program #9773):
 * the first vertical slice wires `type: 'sound'` to the real, authenticated
 * ElevenLabs SFX path (`POST /api/generate/sfx`) and validates that the returned
 * audio is non-empty and decodable before the step counts as successful. Every
 * other asset type stays explicitly unsupported/pending — no fabricated random
 * `asset_<id>` is ever returned as a real generated asset.
 *
 * `store` is a TEST-ONLY override key: it seeds what `ctx.getStore()` returns.
 * `ExecutorContext` itself has no `store` field — executors must read the live
 * store through `getStore()`, never a snapshot (PF-1118).
 */
type CtxOverrides = Partial<ExecutorContext> & { store?: unknown };

function makeCtx(overrides: CtxOverrides = {}): ExecutorContext {
  const { store = { sceneGraph: { nodes: {} } } as never, ...rest } = overrides;
  return {
    dispatchCommand: vi.fn(),
    getStore: () => store as ReturnType<ExecutorContext['getStore']>,
    projectType: '3d',
    userTier: 'creator',
    signal: new AbortController().signal,
    resolveStepOutput: vi.fn(),
    resolveStepOutputs: vi.fn(() => []),
    ...rest,
  };
}

/** Build base64 for a byte array whose first bytes are an ID3 (MP3) header. */
function base64FromBytes(bytes: number[]): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b & 0xff);
  return btoa(bin);
}

/** A minimal MP3 payload: an `ID3` tag header followed by filler bytes. */
const VALID_MP3_BASE64 = base64FromBytes([
  0x49, 0x44, 0x33, // "ID3"
  0x03, 0x00, 0x00, // version + flags
  0x00, 0x00, 0x00, 0x0a, // size
  0xff, 0xfb, 0x90, 0x64, // mp3 frame sync + header
  0x00, 0x00, 0x00, 0x00,
]);

/** Valid base64, but the decoded bytes carry no recognizable audio signature. */
const NON_AUDIO_BASE64 = btoa('this is plain text, not audio at all!!');

function mockFetchOnce(response: Partial<Response> & { jsonBody?: unknown; textBody?: string }) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: response.ok ?? true,
    status: response.status ?? 200,
    json: async () => response.jsonBody ?? {},
    text: async () => response.textBody ?? '',
  } as unknown as Response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('assetGenerateExecutor', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('has correct name and error message', () => {
    expect(assetGenerateExecutor.name).toBe('asset_generate');
    expect(assetGenerateExecutor.userFacingErrorMessage).toContain('placeholder');
  });

  describe('[ai.FR-1.OP-04] type=sound calls the real ElevenLabs SFX path', () => {
    it('succeeds with decodable audio and never fabricates a random asset id', async () => {
      const fetchMock = mockFetchOnce({
        ok: true,
        jsonBody: { audioBase64: VALID_MP3_BASE64, durationSeconds: 3, provider: 'elevenlabs' },
      });
      const ctx = makeCtx();

      const result = await assetGenerateExecutor.execute({
        type: 'sound',
        description: 'a crate breaking',
        styleDirective: '8-bit',
        priority: 'required',
        fallback: 'builtin:sfx-default',
        durationSeconds: 3,
      }, ctx);

      expect(result.success).toBe(true);
      expect(result.output?.usedFallback).toBe(false);
      // Real audio is carried back; NO random `asset_<id>` is minted.
      expect(result.output?.audioBase64).toBe(VALID_MP3_BASE64);
      expect(result.output?.durationSeconds).toBe(3);
      expect(result.output?.provider).toBe('elevenlabs');
      expect(result.output?.assetId ?? null).toBeNull();

      // It went through the authenticated route, not a bare client.
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/generate/sfx');
      expect(init?.method).toBe('POST');
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.durationSeconds).toBe(3);
      expect(typeof body.prompt).toBe('string');
      expect(body.prompt).toContain('a crate breaking');
    });

    it('never returns a fabricated asset_<id> on success', async () => {
      mockFetchOnce({ ok: true, jsonBody: { audioBase64: VALID_MP3_BASE64, durationSeconds: 5 } });
      const ctx = makeCtx();

      const result = await assetGenerateExecutor.execute({
        type: 'sound',
        description: 'laser zap',
        styleDirective: 'retro',
        priority: 'required',
        fallback: 'builtin:sfx-default',
      }, ctx);

      expect(result.success).toBe(true);
      const assetId = result.output?.assetId;
      expect(typeof assetId === 'string' && assetId.startsWith('asset_')).toBe(false);
    });
  });

  describe('[ai.FR-1.OP-04] negative cases fall back without fabricating an asset', () => {
    it('provider error (non-2xx) falls back to the deterministic fallback', async () => {
      const fetchMock = mockFetchOnce({ ok: false, status: 500, textBody: 'upstream boom' });
      const ctx = makeCtx();

      const result = await assetGenerateExecutor.execute({
        type: 'sound',
        description: 'explosion',
        styleDirective: 'cinematic',
        priority: 'required',
        fallback: 'builtin:sfx-default',
      }, ctx);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
      expect(result.output?.usedFallback).toBe(true);
      expect(result.output?.assetId).toBe('builtin:sfx-default');
      // No fabricated asset, no audio payload.
      expect(result.output?.audioBase64).toBeUndefined();
    });

    it('zero-byte / empty audio falls back and attaches nothing fabricated', async () => {
      mockFetchOnce({ ok: true, jsonBody: { audioBase64: '', durationSeconds: 5 } });
      const ctx = makeCtx();

      const result = await assetGenerateExecutor.execute({
        type: 'sound',
        description: 'footstep',
        styleDirective: 'realistic',
        priority: 'required',
        fallback: 'builtin:sfx-default',
      }, ctx);

      expect(result.success).toBe(true);
      expect(result.output?.usedFallback).toBe(true);
      expect(result.output?.assetId).toBe('builtin:sfx-default');
      expect(result.output?.audioBase64).toBeUndefined();
    });

    it('undecodable audio (no recognizable header) falls back', async () => {
      mockFetchOnce({ ok: true, jsonBody: { audioBase64: NON_AUDIO_BASE64, durationSeconds: 5 } });
      const ctx = makeCtx();

      const result = await assetGenerateExecutor.execute({
        type: 'sound',
        description: 'chime',
        styleDirective: 'bright',
        priority: 'required',
        fallback: 'builtin:sfx-default',
      }, ctx);

      expect(result.success).toBe(true);
      expect(result.output?.usedFallback).toBe(true);
      expect(result.output?.assetId).toBe('builtin:sfx-default');
    });
  });

  describe('[ai.FR-1.OP-04] unsupported asset types are explicitly pending', () => {
    const unsupported = ['3d-model', 'texture', 'sprite', 'music', 'voice'] as const;

    for (const type of unsupported) {
      it(`type=${type} returns pending/unsupported fallback, never a random id, no network call`, async () => {
        const fetchMock = mockFetchOnce({ ok: true, jsonBody: { audioBase64: VALID_MP3_BASE64 } });
        const ctx = makeCtx();

        const result = await assetGenerateExecutor.execute({
          type,
          description: `test ${type}`,
          styleDirective: 'default',
          priority: 'required',
          fallback: 'primitive:cube',
        }, ctx);

        expect(result.success).toBe(true);
        expect(result.output?.usedFallback).toBe(true);
        expect(result.output?.unsupported).toBe(true);
        expect(result.output?.pending).toBe(true);
        expect(result.output?.assetId).toBe('primitive:cube');
        const assetId = result.output?.assetId as string;
        expect(assetId.startsWith('asset_')).toBe(false);
        // No generator is called for a type with no adapter yet.
        expect(fetchMock).not.toHaveBeenCalled();
      });
    }
  });

  it('uses fallback when signal is already aborted (no network call)', async () => {
    const fetchMock = mockFetchOnce({ ok: true, jsonBody: { audioBase64: VALID_MP3_BASE64 } });
    const ac = new AbortController();
    ac.abort();
    const ctx = makeCtx({ signal: ac.signal });

    const result = await assetGenerateExecutor.execute({
      type: 'sound',
      description: 'footstep',
      styleDirective: 'realistic',
      priority: 'nice-to-have',
      fallback: 'builtin:sfx-default',
    }, ctx);

    expect(result.success).toBe(true);
    expect(result.output?.usedFallback).toBe(true);
    expect(result.output?.assetId).toBe('builtin:sfx-default');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects invalid asset type', async () => {
    const ctx = makeCtx();
    const result = await assetGenerateExecutor.execute({
      type: 'video',
      description: 'a cutscene',
      styleDirective: 'cinematic',
      priority: 'required',
      fallback: 'primitive:cube',
    }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
  });

  it('rejects empty description', async () => {
    const ctx = makeCtx();
    const result = await assetGenerateExecutor.execute({
      type: 'texture',
      description: '',
      styleDirective: 'pixel',
      priority: 'required',
      fallback: 'primitive:cube',
    }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
  });

  it('rejects description over 500 characters', async () => {
    const ctx = makeCtx();
    const result = await assetGenerateExecutor.execute({
      type: 'texture',
      description: 'x'.repeat(501),
      styleDirective: 'pixel',
      priority: 'required',
      fallback: 'primitive:cube',
    }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
  });

  it('rejects invalid priority', async () => {
    const ctx = makeCtx();
    const result = await assetGenerateExecutor.execute({
      type: 'sound',
      description: 'explosion',
      styleDirective: '8-bit',
      priority: 'critical',
      fallback: 'builtin:sfx-default',
    }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
  });

  it('rejects durationSeconds outside 0.5–22s', async () => {
    const ctx = makeCtx();
    const result = await assetGenerateExecutor.execute({
      type: 'sound',
      description: 'long drone',
      styleDirective: 'ambient',
      priority: 'required',
      fallback: 'builtin:sfx-default',
      durationSeconds: 60,
    }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
  });

  it('rejects invalid fallback format', async () => {
    const ctx = makeCtx();
    const result = await assetGenerateExecutor.execute({
      type: 'texture',
      description: 'stone',
      styleDirective: 'realistic',
      priority: 'required',
      fallback: 'invalid-fallback',
    }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_FALLBACK');
  });

  it('rejects fallback with uppercase letters', async () => {
    const ctx = makeCtx();
    const result = await assetGenerateExecutor.execute({
      type: 'texture',
      description: 'stone',
      styleDirective: 'realistic',
      priority: 'required',
      fallback: 'primitive:Stone',
    }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_FALLBACK');
  });

  it('accepts builtin: prefix in fallback', async () => {
    mockFetchOnce({ ok: true, jsonBody: { audioBase64: VALID_MP3_BASE64, durationSeconds: 5 } });
    const ctx = makeCtx();
    const result = await assetGenerateExecutor.execute({
      type: 'sound',
      description: 'footstep',
      styleDirective: 'realistic',
      priority: 'nice-to-have',
      fallback: 'builtin:footstep-default',
    }, ctx);

    expect(result.success).toBe(true);
  });

  it('rejects styleDirective over 500 characters', async () => {
    const ctx = makeCtx();
    const result = await assetGenerateExecutor.execute({
      type: 'texture',
      description: 'stone',
      styleDirective: 'x'.repeat(501),
      priority: 'required',
      fallback: 'primitive:cube',
    }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
  });
});
