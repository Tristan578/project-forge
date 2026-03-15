import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  generateRetroSfx,
  randomizeSfx,
  sfxToWav,
  sfxToAudioBuffer,
  type SfxPreset,
  type SfxResult,
} from "../sfxGenerator";

// ---------------------------------------------------------------------------
// AudioContext / OfflineAudioContext stubs
// ---------------------------------------------------------------------------

function makeMockAudioContext(sampleRate = 44100) {
  const channelData: Float32Array[] = [];
  return {
    sampleRate,
    createBuffer: vi.fn(
      (_channels: number, length: number, _rate: number) => {
        const data = new Float32Array(length);
        channelData.push(data);
        return {
          length,
          sampleRate: _rate,
          numberOfChannels: _channels,
          copyToChannel: vi.fn((src: Float32Array, channel: number) => {
            if (channel === 0 && channelData.length > 0) {
              data.set(src);
            }
          }),
        };
      },
    ),
    _channelData: channelData,
  } as unknown as AudioContext;
}

// atob stub for Node environment
if (typeof globalThis.atob === "undefined") {
  globalThis.atob = (b64: string) =>
    Buffer.from(b64, "base64").toString("binary");
}

// ---------------------------------------------------------------------------
// generateRetroSfx
// ---------------------------------------------------------------------------

describe("generateRetroSfx", () => {
  const allPresets: SfxPreset[] = [
    "laser",
    "explosion",
    "powerup",
    "hit",
    "jump",
    "blip",
    "coin",
    "random",
  ];

  it.each(allPresets)('preset "%s" produces a non-empty samples array', (preset) => {
    const result = generateRetroSfx(preset);
    expect(result.samples).toBeInstanceOf(Float32Array);
    expect(result.samples.length).toBeGreaterThan(0);
  });

  it.each(allPresets)('preset "%s" produces a WAV data URI', (preset) => {
    const result = generateRetroSfx(preset);
    expect(result.dataURI).toMatch(/^data:audio\/wav;base64,/);
  });

  it.each(allPresets)('preset "%s" returns params with a numeric waveType', (preset) => {
    const result = generateRetroSfx(preset);
    expect(typeof result.params.waveType).toBe("number");
  });

  it("samples are normalised to [-1, 1]", () => {
    const result = generateRetroSfx("laser");
    for (const sample of result.samples) {
      expect(sample).toBeGreaterThanOrEqual(-1);
      expect(sample).toBeLessThanOrEqual(1);
    }
  });

  it("different preset calls produce different data URIs", () => {
    const laser = generateRetroSfx("laser");
    const explosion = generateRetroSfx("explosion");
    expect(laser.dataURI).not.toBe(explosion.dataURI);
  });

  it("params object contains all expected keys", () => {
    const result = generateRetroSfx("coin");
    const expectedKeys: (keyof SfxResult["params"])[] = [
      "waveType",
      "envAttack",
      "envSustain",
      "envPunch",
      "envDecay",
      "baseFreq",
      "freqLimit",
      "freqRamp",
      "freqDramp",
      "vibStrength",
      "vibSpeed",
      "arpMod",
      "arpSpeed",
      "duty",
      "dutyRamp",
      "repeatSpeed",
      "phaOffset",
      "phaRamp",
      "lpfFreq",
      "lpfRamp",
      "lpfResonance",
      "hpfFreq",
      "hpfRamp",
      "soundVol",
    ];
    for (const key of expectedKeys) {
      expect(result.params).toHaveProperty(key);
    }
  });
});

// ---------------------------------------------------------------------------
// randomizeSfx
// ---------------------------------------------------------------------------

describe("randomizeSfx", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns an object with numeric waveType", () => {
    const params = randomizeSfx();
    expect(typeof params.waveType).toBe("number");
  });

  it("returns different results on successive calls", () => {
    // jsfxr random() uses Math.random() internally so two calls should differ
    const a = JSON.stringify(randomizeSfx());
    const b = JSON.stringify(randomizeSfx());
    // NOTE: extremely unlikely to collide but not guaranteed — run 3 times to
    // reduce flakiness probability below 1e-9
    const c = JSON.stringify(randomizeSfx());
    const allSame = a === b && b === c;
    expect(allSame).toBe(false);
  });

  it("contains all expected parameter keys", () => {
    const params = randomizeSfx();
    expect(params).toHaveProperty("baseFreq");
    expect(params).toHaveProperty("envDecay");
    expect(params).toHaveProperty("soundVol");
  });
});

// ---------------------------------------------------------------------------
// sfxToWav
// ---------------------------------------------------------------------------

describe("sfxToWav", () => {
  it("returns a Blob with type audio/wav", () => {
    const result = generateRetroSfx("blip");
    const blob = sfxToWav(result);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("audio/wav");
  });

  it("produces a non-empty blob", () => {
    const result = generateRetroSfx("jump");
    const blob = sfxToWav(result);
    expect(blob.size).toBeGreaterThan(0);
  });

  it("blob starts with RIFF header bytes", async () => {
    const result = generateRetroSfx("coin");
    const blob = sfxToWav(result);
    const arrayBuffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    // WAV files start with 'RIFF'
    expect(bytes[0]).toBe(0x52); // R
    expect(bytes[1]).toBe(0x49); // I
    expect(bytes[2]).toBe(0x46); // F
    expect(bytes[3]).toBe(0x46); // F
  });

  it("throws when dataURI has no base64 payload", () => {
    const badResult: SfxResult = {
      samples: new Float32Array(0),
      dataURI: "data:audio/wav",
      params: randomizeSfx(),
    };
    expect(() => sfxToWav(badResult)).toThrow(
      "sfxToWav: dataURI does not contain a base64 payload",
    );
  });
});

// ---------------------------------------------------------------------------
// sfxToAudioBuffer
// ---------------------------------------------------------------------------

describe("sfxToAudioBuffer", () => {
  it("returns an AudioBuffer with correct length", () => {
    const result = generateRetroSfx("hit");
    const ctx = makeMockAudioContext();
    const audioBuffer = sfxToAudioBuffer(result, ctx);
    expect(audioBuffer.length).toBe(result.samples.length);
  });

  it("calls createBuffer with 44100 sample rate", () => {
    const result = generateRetroSfx("powerup");
    const ctx = makeMockAudioContext();
    sfxToAudioBuffer(result, ctx);
    expect(ctx.createBuffer).toHaveBeenCalledWith(
      1,
      result.samples.length,
      44100,
    );
  });

  it("copies samples into channel 0", () => {
    const result = generateRetroSfx("laser");
    const ctx = makeMockAudioContext();
    const audioBuffer = sfxToAudioBuffer(result, ctx);
    expect(audioBuffer.copyToChannel).toHaveBeenCalledWith(result.samples, 0);
  });
});
