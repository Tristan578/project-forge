// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ClipEditor } from '../ClipEditor';
import type { AssetMetadata } from '@/stores/slices/types';

const asset: AssetMetadata = {
  id: 'url-clip', name: 'Recorded sound', kind: 'audio', fileSize: 100,
  source: { type: 'url', url: 'https://example.com/sound.wav' },
};

function mockDeferredDecode() {
  let resolveDecode!: (buffer: AudioBuffer) => void;
  let rejectDecode!: (error: Error) => void;
  const decoded = new Promise<AudioBuffer>((resolve, reject) => {
    resolveDecode = resolve;
    rejectDecode = reject;
  });
  const decode = vi.fn(() => decoded);
  const close = vi.fn(async () => {});
  vi.stubGlobal('AudioContext', class {
    decodeAudioData = decode;
    close = close;
  });
  const fetchMock = vi.fn(async (_url: string, _options?: RequestInit) => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
  vi.stubGlobal('fetch', fetchMock);
  const channel = new Float32Array([0, 0.5, -1, 0.25, 0, 0.5, 1, 0]);
  const buffer: AudioBuffer = { duration: 4, sampleRate: 8, length: 32, numberOfChannels: 1,
    getChannelData: () => new Float32Array([...channel, ...channel, ...channel, ...channel]),
    copyFromChannel: vi.fn(),
    copyToChannel: vi.fn(),
  };
  return { resolveDecode: () => resolveDecode(buffer), rejectDecode, decode, close, fetchMock };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ClipEditor decoded source bounds', () => {
  it('disables unknown bounds, then uses decoded duration and sample grid for edits', async () => {
    const source = mockDeferredDecode();
    render(<ClipEditor assetId={asset.id} asset={asset} />);
    const end = screen.getByLabelText('Trim end');
    expect(end).toBeDisabled();
    expect(end).toHaveValue(null);
    expect(screen.getByRole('status')).toHaveTextContent('Loading audio source');
    expect(screen.getByRole('img')).toHaveAccessibleName('Waveform unavailable: source duration unknown');
    await waitFor(() => expect(source.decode).toHaveBeenCalledOnce());
    await act(async () => source.resolveDecode());
    expect(end).toBeEnabled();
    expect(end).toHaveValue(4);
    expect(end).toHaveAttribute('max', '4');
    // Edits commit on blur, not per keystroke: the typed value shows as-is, and
    // sample-snapping only happens once the edit is committed.
    fireEvent.change(end, { target: { value: '2.31' } });
    expect(end).toHaveValue(2.31);
    fireEvent.blur(end);
    expect(end).toHaveValue(2.25); // 18 samples at the decoded 8 Hz rate.
    fireEvent.change(end, { target: { value: '4.5' } });
    fireEvent.blur(end);
    expect(screen.getByRole('alert')).toHaveTextContent('cannot exceed the clip length');
    expect(end).toHaveValue(2.25);
    expect(source.fetchMock).toHaveBeenCalledOnce();
    expect(source.close).toHaveBeenCalledOnce();
  });

  it('preserves edits made with supplied decoded bounds when URL decoding arrives late', async () => {
    const source = mockDeferredDecode();
    render(<ClipEditor assetId={asset.id} asset={asset} sourceBounds={{ durationSec: 1, sampleRate: 8 }} />);
    const end = screen.getByLabelText('Trim end');
    const gain = screen.getByLabelText('Gain');
    fireEvent.change(end, { target: { value: '0.5' } });
    fireEvent.blur(end);
    fireEvent.change(gain, { target: { value: '-6' } });
    fireEvent.blur(gain);
    await waitFor(() => expect(source.decode).toHaveBeenCalledOnce());
    await act(async () => source.resolveDecode());
    expect(end).toHaveValue(0.5);
    expect(gain).toHaveValue(-6);
    expect(end).toHaveAttribute('max', '4');
    fireEvent.change(end, { target: { value: '3' } });
    fireEvent.blur(end);
    expect(end).toHaveValue(3);
  });

  it('keeps unavailable URL sources disabled after decoding fails', async () => {
    const source = mockDeferredDecode();
    render(<ClipEditor assetId={asset.id} asset={asset} />);
    await waitFor(() => expect(source.decode).toHaveBeenCalledOnce());
    await act(async () => source.rejectDecode(new Error('Invalid audio')));
    expect(screen.getByRole('status')).toHaveTextContent('Audio source unavailable');
    expect(screen.getByLabelText('Trim end')).toBeDisabled();
    expect(screen.getByLabelText('Trim end')).toHaveValue(null);
    expect(source.close).toHaveBeenCalledOnce();
  });

  it('aborts the source request and closes the context once if unmounted during decode', async () => {
    const source = mockDeferredDecode();
    const { unmount } = render(<ClipEditor assetId={asset.id} asset={asset} />);
    await waitFor(() => expect(source.decode).toHaveBeenCalledOnce());
    const options = source.fetchMock.mock.calls[0][1] as RequestInit;
    unmount();
    expect(options.signal?.aborted).toBe(true);
    expect(source.close).toHaveBeenCalledOnce();
    await act(async () => source.resolveDecode());
    expect(source.close).toHaveBeenCalledOnce();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('does not invent bounds for an uploaded source that has no decoded metadata', () => {
    render(<ClipEditor assetId={asset.id} asset={{ ...asset, source: { type: 'upload', filename: 'sound.wav' } }} />);
    expect(screen.getByRole('status')).toHaveTextContent('requires a decoded source');
    expect(screen.getByLabelText('Trim end')).toBeDisabled();
    expect(screen.getByLabelText('Trim end')).toHaveValue(null);
  });
});
