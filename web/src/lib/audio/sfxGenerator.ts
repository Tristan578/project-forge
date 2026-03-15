/**
 * Retro SFX generator powered by jsfxr.
 *
 * All synthesis runs synchronously in the calling context (no AudioContext
 * required for generation). An AudioContext is only needed when converting the
 * raw PCM buffer to an AudioBuffer via `sfxToAudioBuffer`.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Params: JsfxrParams, sfxr } = require("jsfxr") as {
  Params: new () => JsfxrParamsInstance;
  sfxr: {
    toBuffer: (p: JsfxrParamsInstance) => number[];
    toWave: (p: JsfxrParamsInstance) => { buffer: number[]; dataURI: string };
  };
};

/** Internal jsfxr Params instance shape (subset of fields we use). */
interface JsfxrParamsInstance {
  wave_type: number;
  p_env_attack: number;
  p_env_sustain: number;
  p_env_punch: number;
  p_env_decay: number;
  p_base_freq: number;
  p_freq_limit: number;
  p_freq_ramp: number;
  p_freq_dramp: number;
  p_vib_strength: number;
  p_vib_speed: number;
  p_arp_mod: number;
  p_arp_speed: number;
  p_duty: number;
  p_duty_ramp: number;
  p_repeat_speed: number;
  p_pha_offset: number;
  p_pha_ramp: number;
  p_lpf_freq: number;
  p_lpf_ramp: number;
  p_lpf_resonance: number;
  p_hpf_freq: number;
  p_hpf_ramp: number;
  p_sound_vol: number;
  // Preset methods
  pickupCoin(): void;
  laserShoot(): void;
  explosion(): void;
  powerUp(): void;
  hitHurt(): void;
  jump(): void;
  blipSelect(): void;
  random(): void;
}

/** Named SFX presets available for generation. */
export type SfxPreset =
  | "laser"
  | "explosion"
  | "powerup"
  | "hit"
  | "jump"
  | "blip"
  | "coin"
  | "random";

/** Raw synthesiser parameters mirroring jsfxr's internal Params. */
export interface SfxParams {
  waveType: number;
  envAttack: number;
  envSustain: number;
  envPunch: number;
  envDecay: number;
  baseFreq: number;
  freqLimit: number;
  freqRamp: number;
  freqDramp: number;
  vibStrength: number;
  vibSpeed: number;
  arpMod: number;
  arpSpeed: number;
  duty: number;
  dutyRamp: number;
  repeatSpeed: number;
  phaOffset: number;
  phaRamp: number;
  lpfFreq: number;
  lpfRamp: number;
  lpfResonance: number;
  hpfFreq: number;
  hpfRamp: number;
  soundVol: number;
}

/**
 * Result of SFX generation: the raw PCM samples (44 100 Hz, mono, f32) and a
 * data URI that can be assigned directly to an `<audio>` element.
 */
export interface SfxResult {
  /** Raw PCM float32 samples at 44 100 Hz mono. */
  samples: Float32Array<ArrayBuffer>;
  /** WAV data URI — assign to `new Audio(dataURI)` to play immediately. */
  dataURI: string;
  /** Parameters used to produce this sound. */
  params: SfxParams;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildParams(preset: SfxPreset): JsfxrParamsInstance {
  const p = new JsfxrParams();
  switch (preset) {
    case "laser":
      p.laserShoot();
      break;
    case "explosion":
      p.explosion();
      break;
    case "powerup":
      p.powerUp();
      break;
    case "hit":
      p.hitHurt();
      break;
    case "jump":
      p.jump();
      break;
    case "blip":
      p.blipSelect();
      break;
    case "coin":
      p.pickupCoin();
      break;
    case "random":
      p.random();
      break;
  }
  return p;
}

function paramsToSfxParams(p: JsfxrParamsInstance): SfxParams {
  return {
    waveType: p.wave_type,
    envAttack: p.p_env_attack,
    envSustain: p.p_env_sustain,
    envPunch: p.p_env_punch,
    envDecay: p.p_env_decay,
    baseFreq: p.p_base_freq,
    freqLimit: p.p_freq_limit,
    freqRamp: p.p_freq_ramp,
    freqDramp: p.p_freq_dramp,
    vibStrength: p.p_vib_strength,
    vibSpeed: p.p_vib_speed,
    arpMod: p.p_arp_mod,
    arpSpeed: p.p_arp_speed,
    duty: p.p_duty,
    dutyRamp: p.p_duty_ramp,
    repeatSpeed: p.p_repeat_speed,
    phaOffset: p.p_pha_offset,
    phaRamp: p.p_pha_ramp,
    lpfFreq: p.p_lpf_freq,
    lpfRamp: p.p_lpf_ramp,
    lpfResonance: p.p_lpf_resonance,
    hpfFreq: p.p_hpf_freq,
    hpfRamp: p.p_hpf_ramp,
    soundVol: p.p_sound_vol,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a retro SFX sound from one of the built-in presets.
 *
 * @param preset - The style of sound to generate.
 * @returns SfxResult with samples, WAV data URI, and the raw params used.
 */
export function generateRetroSfx(preset: SfxPreset): SfxResult {
  const p = buildParams(preset);
  const rawBuffer: number[] = sfxr.toBuffer(p);
  const wave = sfxr.toWave(p);

  // jsfxr.toBuffer returns 16-bit signed PCM samples as integers in [-32768, 32767].
  // Normalise to Float32 in [-1, 1].
  const samples = new Float32Array(rawBuffer.length);
  for (let i = 0; i < rawBuffer.length; i++) {
    samples[i] = rawBuffer[i] / 32768;
  }

  return {
    samples,
    dataURI: wave.dataURI,
    params: paramsToSfxParams(p),
  };
}

/**
 * Return random synthesiser parameters without applying any preset.
 * Useful for fully randomised sound design.
 */
export function randomizeSfx(): SfxParams {
  const p = new JsfxrParams();
  p.random();
  return paramsToSfxParams(p);
}

/**
 * Convert an SfxResult to a downloadable WAV Blob.
 *
 * The data URI produced by jsfxr is already a WAV file, so this function
 * simply decodes the base64 payload into a Uint8Array and wraps it in a Blob.
 *
 * @param result - An SfxResult returned by `generateRetroSfx`.
 * @returns A `Blob` with MIME type `audio/wav`.
 */
export function sfxToWav(result: SfxResult): Blob {
  // data:audio/wav;base64,<payload>
  const base64 = result.dataURI.split(",")[1];
  if (!base64) {
    throw new Error("sfxToWav: dataURI does not contain a base64 payload");
  }

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new Blob([bytes], { type: "audio/wav" });
}

/**
 * Convert an SfxResult to a Web Audio API `AudioBuffer` using the provided
 * `AudioContext`. This is the entry-point for playing sounds in-editor.
 *
 * @param result - An SfxResult returned by `generateRetroSfx`.
 * @param ctx - An AudioContext (or OfflineAudioContext for tests).
 * @returns An AudioBuffer ready for scheduling via `createBufferSource`.
 */
export function sfxToAudioBuffer(
  result: SfxResult,
  ctx: AudioContext | OfflineAudioContext,
): AudioBuffer {
  const sampleRate = 44100;
  const buffer = ctx.createBuffer(1, result.samples.length, sampleRate);
  buffer.copyToChannel(new Float32Array(result.samples.buffer as ArrayBuffer), 0);
  return buffer;
}
