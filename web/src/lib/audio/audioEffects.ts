/**
 * Audio effect chain creation for the bus effects system.
 *
 * Each effect is a pair of AudioNodes (input/output) that can be wired
 * in series on a bus chain. Supports reverb, lowpass, highpass, compressor,
 * and delay effects.
 */

import type { EffectDefinition, EffectInstance } from './audioTypes';

/**
 * Create an effect instance from a definition.
 */
export function createEffectInstance(
  ctx: AudioContext,
  def: EffectDefinition,
  getIRBuffer: (presetIndex: number) => AudioBuffer
): EffectInstance {
  switch (def.effectType) {
    case 'reverb':
      return createReverbEffect(ctx, def.params, getIRBuffer);
    case 'lowpass':
      return createFilterEffect(ctx, 'lowpass', def.params);
    case 'highpass':
      return createFilterEffect(ctx, 'highpass', def.params);
    case 'compressor':
      return createCompressorEffect(ctx, def.params);
    case 'delay':
      return createDelayEffect(ctx, def.params);
    default: {
      // Passthrough: gain node with gain 1
      const passthrough = ctx.createGain();
      return {
        type: def.effectType,
        inputNode: passthrough,
        outputNode: passthrough,
        params: def.params,
        enabled: true,
      };
    }
  }
}

function createReverbEffect(
  ctx: AudioContext,
  params: Record<string, number>,
  getIRBuffer: (presetIndex: number) => AudioBuffer
): EffectInstance {
  const preset = params.preset ?? 0;
  const wet = params.wet ?? 0.5;

  const convolver = ctx.createConvolver();
  convolver.buffer = getIRBuffer(preset);

  const dryGain = ctx.createGain();
  const wetGain = ctx.createGain();
  const output = ctx.createGain();

  dryGain.gain.value = 1 - wet;
  wetGain.gain.value = wet;

  // Split input into dry and wet paths
  const input = ctx.createGain();
  input.connect(dryGain).connect(output);
  input.connect(convolver).connect(wetGain).connect(output);

  return {
    type: 'reverb',
    inputNode: input,
    outputNode: output,
    params: { preset, wet },
    enabled: true,
  };
}

function createFilterEffect(
  ctx: AudioContext,
  type: 'lowpass' | 'highpass',
  params: Record<string, number>
): EffectInstance {
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = params.frequency ?? (type === 'lowpass' ? 1000 : 500);
  filter.Q.value = params.q ?? 1.0;

  return {
    type,
    inputNode: filter,
    outputNode: filter,
    params: { frequency: filter.frequency.value, q: filter.Q.value },
    enabled: true,
  };
}

function createCompressorEffect(
  ctx: AudioContext,
  params: Record<string, number>
): EffectInstance {
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = params.threshold ?? -24;
  compressor.knee.value = params.knee ?? 30;
  compressor.ratio.value = params.ratio ?? 12;
  compressor.attack.value = params.attack ?? 0.003;
  compressor.release.value = params.release ?? 0.25;

  return {
    type: 'compressor',
    inputNode: compressor,
    outputNode: compressor,
    params: {
      threshold: compressor.threshold.value,
      knee: compressor.knee.value,
      ratio: compressor.ratio.value,
      attack: compressor.attack.value,
      release: compressor.release.value,
    },
    enabled: true,
  };
}

function createDelayEffect(
  ctx: AudioContext,
  params: Record<string, number>
): EffectInstance {
  const time = params.time ?? 0.5;
  const feedback = Math.min(params.feedback ?? 0.3, 0.95);
  const wet = params.wet ?? 0.5;

  const delay = ctx.createDelay(2.0);
  delay.delayTime.value = time;

  const feedbackGain = ctx.createGain();
  feedbackGain.gain.value = feedback;

  const dryGain = ctx.createGain();
  const wetGain = ctx.createGain();
  const input = ctx.createGain();
  const output = ctx.createGain();

  dryGain.gain.value = 1 - wet;
  wetGain.gain.value = wet;

  // Routing: input -> dryGain -> output
  //          input -> delay -> feedbackGain -> delay (loop)
  //                         -> wetGain -> output
  input.connect(dryGain).connect(output);
  input.connect(delay);
  delay.connect(feedbackGain);
  feedbackGain.connect(delay);
  delay.connect(wetGain).connect(output);

  return {
    type: 'delay',
    inputNode: input,
    outputNode: output,
    params: { time, feedback, wet },
    enabled: true,
  };
}

/**
 * Generate a synthetic impulse response buffer for reverb presets.
 */
export function generateIRBuffer(ctx: AudioContext, presetIndex: number): AudioBuffer {
  const presets = [
    { duration: 3.0, density: 0.8, name: 'Hall' },
    { duration: 1.0, density: 0.5, name: 'Room' },
    { duration: 2.0, density: 0.9, name: 'Plate' },
    { duration: 5.0, density: 0.95, name: 'Cathedral' },
  ];

  const preset = presets[presetIndex] ?? presets[0];
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(preset.duration * sampleRate);
  const buffer = ctx.createBuffer(2, length, sampleRate);

  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const decay = Math.exp(-t / (preset.duration * 0.3));
      const noise = (Math.random() * 2 - 1) * preset.density;
      data[i] = noise * decay;
    }
  }

  return buffer;
}
