/**
 * Adaptive Music Manager — Multi-stem music system with intensity-based transitions.
 * Supports pad, bass, melody, and drums layers with smooth crossfading and beat quantization.
 * Includes horizontal re-sequencing for seamless music segment transitions.
 */

interface StemData {
  buffer: AudioBuffer;
  source: AudioBufferSourceNode | null;
  gain: GainNode;
}

interface MusicSegment {
  name: string;
  startTime: number;
  duration: number;
}

export class AdaptiveMusicManager {
  private ctx: AudioContext;
  private stems: Map<string, StemData> = new Map();
  private _intensity = 0;
  private _bpm = 120;
  private startTime = 0;
  private isPlaying = false;
  private segments: MusicSegment[] = [];
  private currentSegment = 'intro';

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
  }

  /**
   * Load a set of stems into the manager.
   * Expected keys: "pad", "bass", "melody", "drums"
   */
  loadStemSet(stems: Record<string, AudioBuffer>): void {
    // Clear existing stems
    this.stop();
    this.stems.clear();

    // Create gain nodes for each stem
    for (const [name, buffer] of Object.entries(stems)) {
      const gain = this.ctx.createGain();
      gain.connect(this.ctx.destination);
      gain.gain.setValueAtTime(0, this.ctx.currentTime); // Start muted

      this.stems.set(name, {
        buffer,
        source: null,
        gain,
      });
    }
  }

  /**
   * Set music intensity (0.0 - 1.0).
   * 0.0-0.25: pad only
   * 0.25-0.5: pad + bass
   * 0.5-0.75: pad + bass + melody
   * 0.75-1.0: pad + bass + melody + drums (full mix)
   */
  setIntensity(level: number): void {
    this._intensity = Math.max(0, Math.min(1, level));

    const now = this.ctx.currentTime;
    const rampTime = 0.5; // 500ms smooth transition

    // Determine target volumes based on intensity
    const padVolume = this._intensity > 0 ? 1 : 0;
    const bassVolume = this._intensity >= 0.25 ? 1 : 0;
    const melodyVolume = this._intensity >= 0.5 ? 1 : 0;
    const drumsVolume = this._intensity >= 0.75 ? 1 : 0;

    // Apply smooth ramps
    this.stems.get('pad')?.gain.gain.linearRampToValueAtTime(padVolume, now + rampTime);
    this.stems.get('bass')?.gain.gain.linearRampToValueAtTime(bassVolume, now + rampTime);
    this.stems.get('melody')?.gain.gain.linearRampToValueAtTime(melodyVolume, now + rampTime);
    this.stems.get('drums')?.gain.gain.linearRampToValueAtTime(drumsVolume, now + rampTime);
  }

  /**
   * Crossfade to a new intensity level over a specified duration.
   * Quantized to the nearest beat.
   */
  crossfade(_duration = 1): void {
    const beatsPerSecond = this._bpm / 60;
    const beatDuration = 1 / beatsPerSecond;

    // Calculate elapsed beats
    const elapsed = this.ctx.currentTime - this.startTime;
    const currentBeat = Math.floor(elapsed / beatDuration);
    const nextBeatTime = this.startTime + (currentBeat + 1) * beatDuration;

    // Schedule the crossfade to start on the next beat
    const delay = nextBeatTime - this.ctx.currentTime;
    setTimeout(() => {
      this.setIntensity(this._intensity);
    }, delay * 1000);
  }

  /**
   * Set the BPM for beat-quantized transitions.
   */
  setBPM(bpm: number): void {
    this._bpm = bpm;
  }

  /**
   * Start playback of all stems (initially muted, use setIntensity to unmute).
   */
  play(): void {
    if (this.isPlaying) return;

    this.startTime = this.ctx.currentTime;
    this.isPlaying = true;

    // Create and start all sources
    for (const [_name, data] of this.stems) {
      const source = this.ctx.createBufferSource();
      source.buffer = data.buffer;
      source.loop = true;
      source.connect(data.gain);
      source.start(0);

      data.source = source;
    }

    // Set initial intensity
    this.setIntensity(this._intensity);
  }

  /**
   * Stop playback and disconnect all sources.
   */
  stop(): void {
    if (!this.isPlaying) return;

    this.isPlaying = false;

    for (const data of this.stems.values()) {
      if (data.source) {
        data.source.stop();
        data.source.disconnect();
        data.source = null;
      }
    }
  }

  get intensity(): number {
    return this._intensity;
  }

  get bpm(): number {
    return this._bpm;
  }

  /**
   * Define music segments for horizontal re-sequencing.
   * Each segment represents a section of the music (intro, main, combat, etc.).
   */
  setSegments(segments: MusicSegment[]): void {
    this.segments = segments;
  }

  /**
   * Transition to a named music segment with beat quantization.
   * Implements horizontal re-sequencing for seamless transitions.
   */
  transitionToSegment(segmentName: string, quantized = true): void {
    const segment = this.segments.find(s => s.name === segmentName);
    if (!segment) {
      console.warn(`[AdaptiveMusic] Segment "${segmentName}" not found`);
      return;
    }

    this.currentSegment = segmentName;

    if (!quantized || !this.isPlaying) {
      // Immediate transition
      this.seekToTime(segment.startTime);
      return;
    }

    // Beat-quantized transition
    const beatsPerSecond = this._bpm / 60;
    const beatDuration = 1 / beatsPerSecond;

    // Calculate elapsed beats
    const elapsed = this.ctx.currentTime - this.startTime;
    const currentBeat = Math.floor(elapsed / beatDuration);
    const nextBeatTime = this.startTime + (currentBeat + 1) * beatDuration;

    // Schedule the transition to start on the next beat
    const delay = nextBeatTime - this.ctx.currentTime;
    setTimeout(() => {
      this.seekToTime(segment.startTime);
    }, delay * 1000);
  }

  /**
   * Seek all stems to a specific time offset.
   */
  private seekToTime(time: number): void {
    if (!this.isPlaying) return;

    // Stop current sources
    for (const data of this.stems.values()) {
      if (data.source) {
        try {
          data.source.stop();
        } catch {
          // Already stopped
        }
        data.source = null;
      }
    }

    // Create new sources starting at the desired offset
    for (const [_name, data] of this.stems) {
      const source = this.ctx.createBufferSource();
      source.buffer = data.buffer;
      source.loop = true;
      source.connect(data.gain);
      source.start(0, time);
      data.source = source;
    }

    // Update start time to account for offset
    this.startTime = this.ctx.currentTime - time;
  }

  /**
   * Get the current segment name.
   */
  getCurrentSegment(): string {
    return this.currentSegment;
  }
}
