/**
 * Audio loop point detection via waveform analysis.
 *
 * Finds natural loop boundaries in audio buffers by analyzing zero crossings
 * and comparing waveform similarity at candidate start/end points.
 */

import type { LoopPoint } from './audioTypes';

/**
 * Detect natural loop points in an audio buffer by analyzing waveform boundaries.
 */
export function detectLoopPoints(
  buffer: AudioBuffer,
  options?: { maxResults?: number; minLoopDuration?: number }
): LoopPoint[] {
  const maxResults = options?.maxResults ?? 5;
  const minLoopDurationSec = options?.minLoopDuration ?? 0.5;
  const sampleRate = buffer.sampleRate;
  const minLoopSamples = Math.floor(minLoopDurationSec * sampleRate);
  const data = buffer.getChannelData(0); // Analyze first channel
  const totalSamples = data.length;

  if (totalSamples < minLoopSamples) {
    return [{
      startSample: 0,
      endSample: totalSamples - 1,
      startTime: 0,
      endTime: (totalSamples - 1) / sampleRate,
      score: 0.5,
    }];
  }

  // Find zero crossings (where sign changes)
  const zeroCrossings: number[] = [];
  for (let i = 1; i < totalSamples; i++) {
    if ((data[i - 1] >= 0 && data[i] < 0) || (data[i - 1] < 0 && data[i] >= 0)) {
      zeroCrossings.push(i);
    }
  }

  // If no zero crossings found (e.g., silent buffer), return full loop
  if (zeroCrossings.length < 2) {
    return [{
      startSample: 0,
      endSample: totalSamples - 1,
      startTime: 0,
      endTime: (totalSamples - 1) / sampleRate,
      score: 0.5,
    }];
  }

  // Score candidate loop points: compare waveform at start and end regions
  const candidates: LoopPoint[] = [];
  const windowSize = Math.min(256, Math.floor(totalSamples / 10));

  // Take early zero crossings as potential start points
  const startCandidates = zeroCrossings.filter(z => z < totalSamples / 3).slice(0, 10);
  // Take late zero crossings as potential end points
  const endCandidates = zeroCrossings.filter(z => z > totalSamples * 2 / 3).slice(-10);

  for (const startSample of startCandidates) {
    for (const endSample of endCandidates) {
      if (endSample - startSample < minLoopSamples) continue;

      const score = scoreLoopPoint(data, startSample, endSample, windowSize);
      candidates.push({
        startSample,
        endSample,
        startTime: startSample / sampleRate,
        endTime: endSample / sampleRate,
        score,
      });
    }
  }

  // Fallback: if no valid candidates found, return a full-length loop
  if (candidates.length === 0) {
    return [{
      startSample: 0,
      endSample: totalSamples - 1,
      startTime: 0,
      endTime: (totalSamples - 1) / sampleRate,
      score: 0.3,
    }];
  }

  // Sort by score (highest first) and return top N
  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, maxResults);
}

/**
 * Score a loop point by comparing waveform similarity at the boundary.
 * Returns 0-1 where 1 = perfect match.
 */
function scoreLoopPoint(
  data: Float32Array,
  startSample: number,
  endSample: number,
  windowSize: number
): number {
  let sumDiff = 0;
  let sumEnergy = 0;
  const safeWindow = Math.min(windowSize, endSample - startSample);

  for (let i = 0; i < safeWindow; i++) {
    const startIdx = startSample + i;
    const endIdx = endSample - safeWindow + i;
    if (startIdx >= data.length || endIdx >= data.length) break;

    const diff = data[startIdx] - data[endIdx];
    sumDiff += diff * diff;
    sumEnergy += data[startIdx] * data[startIdx] + data[endIdx] * data[endIdx];
  }

  if (sumEnergy < 1e-10) return 1.0; // Silent — perfect match
  return Math.max(0, 1.0 - (sumDiff / (sumEnergy + 1e-10)));
}
