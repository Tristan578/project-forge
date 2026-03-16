/**
 * Unit tests for useFeatureGating and useCapabilities hooks.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import {
  useFeatureGating,
  useCapabilities,
  _resetCapabilitiesCache,
} from '../useFeatureGating';
import type { CapabilitiesResponse } from '@/app/api/capabilities/route';

/** Build a mock capabilities response */
function mockCapabilitiesResponse(
  overrides: Partial<CapabilitiesResponse> = {}
): CapabilitiesResponse {
  return {
    capabilities: [
      { capability: 'chat', available: true, label: 'AI Chat' },
      { capability: 'embedding', available: true, label: 'Semantic Search' },
      { capability: 'image', available: false, label: 'Image Generation', requiredProviders: ['OpenAI'], hint: 'Configure OpenAI API key in Settings to enable Image Generation.' },
      { capability: 'model3d', available: false, label: '3D Model Generation', requiredProviders: ['Meshy'], hint: 'Configure Meshy API key in Settings to enable 3D Model Generation.' },
      { capability: 'texture', available: false, label: 'Texture Generation', requiredProviders: ['Meshy'], hint: 'Configure Meshy API key in Settings to enable Texture Generation.' },
      { capability: 'sfx', available: false, label: 'Sound Effect Generation', requiredProviders: ['ElevenLabs'], hint: 'Configure ElevenLabs API key in Settings to enable Sound Effect Generation.' },
      { capability: 'voice', available: false, label: 'Voice Generation', requiredProviders: ['ElevenLabs'], hint: 'Configure ElevenLabs API key in Settings to enable Voice Generation.' },
      { capability: 'music', available: false, label: 'Music Generation', requiredProviders: ['Suno'], hint: 'Configure Suno API key in Settings to enable Music Generation.' },
      { capability: 'sprite', available: false, label: 'Sprite Generation', requiredProviders: ['Replicate'], hint: 'Configure Replicate API key in Settings to enable Sprite Generation.' },
      { capability: 'bg_removal', available: false, label: 'Background Removal', requiredProviders: ['remove.bg'], hint: 'Configure remove.bg API key in Settings to enable Background Removal.' },
    ],
    available: ['chat', 'embedding'],
    unavailable: ['image', 'model3d', 'texture', 'sfx', 'voice', 'music', 'sprite', 'bg_removal'],
    ...overrides,
  };
}

describe('useFeatureGating', () => {
  beforeEach(() => {
    _resetCapabilitiesCache();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    _resetCapabilitiesCache();
  });

  it('returns loading=true initially', () => {
    // Never resolve the fetch
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      () => new Promise(() => {})
    );

    const { result } = renderHook(() => useFeatureGating('ai-chat'));
    expect(result.current.loading).toBe(true);
    expect(result.current.isAvailable).toBe(false);
    expect(result.current.reason).toBeUndefined();
  });

  it('returns isAvailable=true for configured capabilities', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(mockCapabilitiesResponse()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const { result } = renderHook(() => useFeatureGating('ai-chat'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.isAvailable).toBe(true);
    expect(result.current.reason).toBeUndefined();
  });

  it('returns isAvailable=false with reason for unconfigured capabilities', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(mockCapabilitiesResponse()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const { result } = renderHook(() => useFeatureGating('model-generation'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.isAvailable).toBe(false);
    expect(result.current.reason).toBe(
      'Configure Meshy API key in Settings to enable 3D Model Generation.'
    );
  });

  it('returns hint from sfx capability when sfx-generation is checked', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(mockCapabilitiesResponse()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const { result } = renderHook(() => useFeatureGating('sfx-generation'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.isAvailable).toBe(false);
    expect(result.current.reason).toContain('ElevenLabs');
  });

  it('returns isAvailable=true when all capabilities are available', async () => {
    const allAvailable = mockCapabilitiesResponse({
      available: ['chat', 'embedding', 'image', 'model3d', 'texture', 'sfx', 'voice', 'music', 'sprite', 'bg_removal'],
      unavailable: [],
      capabilities: mockCapabilitiesResponse().capabilities.map((c) => ({
        ...c,
        available: true,
      })),
    });

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(allAvailable), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const { result } = renderHook(() => useFeatureGating('model-generation'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.isAvailable).toBe(true);
  });

  it('handles fetch errors gracefully', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useFeatureGating('ai-chat'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.isAvailable).toBe(false);
    expect(result.current.reason).toContain('API key');
  });

  it('handles HTTP error responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Internal Server Error', { status: 500 })
    );

    const { result } = renderHook(() => useFeatureGating('ai-chat'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.isAvailable).toBe(false);
  });

  it('shares cached data across multiple hook instances', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(mockCapabilitiesResponse()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const { result: r1 } = renderHook(() => useFeatureGating('ai-chat'));
    const { result: r2 } = renderHook(() => useFeatureGating('model-generation'));

    await waitFor(() => {
      expect(r1.current.loading).toBe(false);
    });

    await waitFor(() => {
      expect(r2.current.loading).toBe(false);
    });

    // Only one fetch should have been made
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(r1.current.isAvailable).toBe(true);
    expect(r2.current.isAvailable).toBe(false);
  });

  it('returns semantic-search availability based on embedding capability', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(mockCapabilitiesResponse()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const { result } = renderHook(() => useFeatureGating('semantic-search'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Embedding is available in the mock response
    expect(result.current.isAvailable).toBe(true);
  });
});

describe('useCapabilities', () => {
  beforeEach(() => {
    _resetCapabilitiesCache();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    _resetCapabilitiesCache();
  });

  it('returns loading state initially', () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      () => new Promise(() => {})
    );

    const { result } = renderHook(() => useCapabilities());
    expect(result.current.loading).toBe(true);
    expect(result.current.capabilities).toEqual([]);
  });

  it('returns all capabilities after fetch', async () => {
    const mockResponse = mockCapabilitiesResponse();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(mockResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const { result } = renderHook(() => useCapabilities());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.capabilities).toHaveLength(10);
    expect(result.current.available.has('chat')).toBe(true);
    expect(result.current.available.has('model3d')).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('sets error on fetch failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Offline'));

    const { result } = renderHook(() => useCapabilities());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Offline');
  });

  it('refresh re-fetches capabilities', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(mockCapabilitiesResponse()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const { result } = renderHook(() => useCapabilities());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Refresh should trigger another fetch
    act(() => {
      result.current.refresh();
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
