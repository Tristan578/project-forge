/**
 * Audio waveform extraction utilities.
 *
 * Downsamples an AudioBuffer to a compact array of normalized amplitude
 * values suitable for rendering waveform visualizations or exposing to
 * the script API via forge.audio.getWaveform().
 */

const DEFAULT_SAMPLE_COUNT = 200;

/**
 * Extracts a downsampled waveform from an AudioBuffer.
 *
 * Handles both mono and stereo by averaging all channels. The returned
 * values are normalized to the range [0, 1] based on the peak amplitude
 * across the entire buffer. Returns an empty array for zero-length buffers.
 *
 * @param audioBuffer - Decoded AudioBuffer to analyze.
 * @param sampleCount - Number of output samples (default 200).
 * @returns Array of amplitude values in [0, 1].
 */
export function extractWaveform(audioBuffer: AudioBuffer, sampleCount = DEFAULT_SAMPLE_COUNT): number[] {
  const totalFrames = audioBuffer.length;
  const numChannels = audioBuffer.numberOfChannels;

  if (totalFrames === 0 || numChannels === 0 || sampleCount === 0) {
    return [];
  }

  // Read all channel data once to avoid repeated getChannelData calls
  const channelArrays: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) {
    channelArrays.push(audioBuffer.getChannelData(c));
  }

  // Downsample: for each output bucket, compute the RMS across the frames
  // that fall within that bucket, averaged across channels.
  const framesPerBucket = totalFrames / sampleCount;
  const raw: number[] = new Array(sampleCount);

  for (let i = 0; i < sampleCount; i++) {
    const startFrame = Math.floor(i * framesPerBucket);
    const endFrame = Math.min(Math.floor((i + 1) * framesPerBucket), totalFrames);
    const bucketLen = endFrame - startFrame;

    if (bucketLen === 0) {
      raw[i] = 0;
      continue;
    }

    // Sum of absolute values across channels and frames
    let sum = 0;
    for (let c = 0; c < numChannels; c++) {
      const ch = channelArrays[c];
      for (let f = startFrame; f < endFrame; f++) {
        sum += Math.abs(ch[f]);
      }
    }

    raw[i] = sum / (bucketLen * numChannels);
  }

  // Normalize to [0, 1] using peak amplitude
  let peak = 0;
  for (let i = 0; i < sampleCount; i++) {
    if (raw[i] > peak) peak = raw[i];
  }

  if (peak === 0) {
    // Silent buffer — return all zeros
    return raw;
  }

  const normalized: number[] = new Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    normalized[i] = raw[i] / peak;
  }

  return normalized;
}

/**
 * Fetches an audio file from a URL, decodes it, and extracts its waveform.
 *
 * @param url - URL of the audio file to fetch and decode.
 * @param ctx - AudioContext used for decoding.
 * @param sampleCount - Number of output samples (default 200).
 * @returns Array of normalized amplitude values in [0, 1].
 */
export async function extractWaveformFromUrl(
  url: string,
  ctx: AudioContext,
  sampleCount = DEFAULT_SAMPLE_COUNT,
): Promise<number[]> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch audio for waveform extraction: HTTP ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
  return extractWaveform(audioBuffer, sampleCount);
}
