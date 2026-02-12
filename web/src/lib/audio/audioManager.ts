/**
 * Web Audio API singleton manager for game audio playback.
 *
 * Manages audio instances per entity, handles spatial audio, and provides
 * playback controls (play/stop/pause/resume). Works with the Rust engine's
 * AudioData component.
 */

interface AudioInstance {
  entityId: string;
  assetId: string;
  source: AudioBufferSourceNode | null;
  gainNode: GainNode;
  pannerNode: PannerNode | null;
  isPlaying: boolean;
  isPaused: boolean;
  startTime: number;
  pauseOffset: number;
  loop: boolean;
  bus: string;
}

interface BusState {
  name: string;
  gainNode: GainNode;
  volume: number;
  muted: boolean;
  soloed: boolean;
  effectiveMuted: boolean;
  effects: EffectInstance[];
}

interface EffectInstance {
  type: string;
  inputNode: AudioNode;
  outputNode: AudioNode;
  params: Record<string, number>;
  enabled: boolean;
}

class AudioManager {
  private ctx: AudioContext | null = null;
  private instances: Map<string, AudioInstance> = new Map();
  private buffers: Map<string, AudioBuffer> = new Map();
  private buses: Map<string, BusState> = new Map();
  private irBuffers: Map<number, AudioBuffer> = new Map();

  /**
   * Lazily initialize AudioContext (handles browser autoplay policy).
   */
  ensureContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      // Resume context on first user interaction if suspended
      if (this.ctx.state === 'suspended') {
        const resumeOnInteraction = () => {
          if (this.ctx?.state === 'suspended') {
            this.ctx.resume();
          }
          document.removeEventListener('click', resumeOnInteraction);
          document.removeEventListener('keydown', resumeOnInteraction);
        };
        document.addEventListener('click', resumeOnInteraction);
        document.addEventListener('keydown', resumeOnInteraction);
      }
      // Initialize default buses
      this.initializeBuses();
    }
    return this.ctx;
  }

  /**
   * Initialize the default 5 audio buses.
   */
  private initializeBuses(): void {
    if (!this.ctx) return;

    const defaultBuses = [
      { name: 'master', volume: 1.0, muted: false, soloed: false },
      { name: 'sfx', volume: 1.0, muted: false, soloed: false },
      { name: 'music', volume: 0.8, muted: false, soloed: false },
      { name: 'ambient', volume: 0.7, muted: false, soloed: false },
      { name: 'voice', volume: 1.0, muted: false, soloed: false },
    ];

    for (const busConfig of defaultBuses) {
      const gainNode = this.ctx.createGain();
      gainNode.gain.value = busConfig.volume;

      // Master bus connects to destination, others connect to master
      if (busConfig.name === 'master') {
        gainNode.connect(this.ctx.destination);
      }

      const bus: BusState = {
        name: busConfig.name,
        gainNode,
        volume: busConfig.volume,
        muted: busConfig.muted,
        soloed: busConfig.soloed,
        effectiveMuted: false,
        effects: [],
      };

      this.buses.set(busConfig.name, bus);
    }

    // Connect non-master buses to master
    const masterBus = this.buses.get('master')!;
    for (const bus of this.buses.values()) {
      if (bus.name !== 'master') {
        bus.gainNode.connect(masterBus.gainNode);
      }
    }
  }

  /**
   * Load an audio buffer from ArrayBuffer data.
   */
  async loadBuffer(assetId: string, data: ArrayBuffer): Promise<void> {
    const ctx = this.ensureContext();
    try {
      const buffer = await ctx.decodeAudioData(data);
      this.buffers.set(assetId, buffer);
    } catch (err) {
      console.error(`[AudioManager] Failed to decode audio ${assetId}:`, err);
      throw err;
    }
  }

  /**
   * Create an audio instance for an entity.
   */
  createInstance(
    entityId: string,
    assetId: string,
    audioData: {
      volume: number;
      pitch: number;
      loopAudio: boolean;
      spatial: boolean;
      maxDistance: number;
      refDistance: number;
      rolloffFactor: number;
      bus?: string;
    }
  ): void {
    const ctx = this.ensureContext();
    const buffer = this.buffers.get(assetId);

    if (!buffer) {
      console.warn(`[AudioManager] Buffer ${assetId} not loaded for entity ${entityId}`);
      return;
    }

    // Destroy existing instance if any
    this.destroyInstance(entityId);

    // Create gain node for volume control
    const gainNode = ctx.createGain();
    gainNode.gain.value = audioData.volume;

    // Create panner node if spatial
    let pannerNode: PannerNode | null = null;
    if (audioData.spatial) {
      pannerNode = ctx.createPanner();
      pannerNode.distanceModel = 'inverse';
      pannerNode.refDistance = audioData.refDistance;
      pannerNode.maxDistance = audioData.maxDistance;
      pannerNode.rolloffFactor = audioData.rolloffFactor;
    }

    // Create instance
    const instance: AudioInstance = {
      entityId,
      assetId,
      source: null,
      gainNode,
      pannerNode,
      isPlaying: false,
      isPaused: false,
      startTime: 0,
      pauseOffset: 0,
      loop: audioData.loopAudio,
      bus: audioData.bus ?? 'sfx',
    };

    this.instances.set(entityId, instance);
  }

  /**
   * Start playback for an entity.
   */
  play(entityId: string): void {
    const instance = this.instances.get(entityId);
    if (!instance) {
      console.warn(`[AudioManager] Instance ${entityId} not found`);
      return;
    }

    if (instance.isPlaying) {
      return; // Already playing
    }

    const ctx = this.ensureContext();
    const buffer = this.buffers.get(instance.assetId);
    if (!buffer) {
      console.warn(`[AudioManager] Buffer ${instance.assetId} missing`);
      return;
    }

    // Create source node
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = instance.loop;

    // Route through bus
    const busName = instance.bus ?? 'sfx';
    const bus = this.buses.get(busName) ?? this.buses.get('sfx')!;

    // Connect: source → gain → panner (if spatial) → busGainNode
    if (instance.pannerNode) {
      source.connect(instance.gainNode).connect(instance.pannerNode).connect(bus.gainNode);
    } else {
      source.connect(instance.gainNode).connect(bus.gainNode);
    }

    // Start from offset (for resume support)
    const offset = instance.pauseOffset;
    source.start(0, offset);
    instance.source = source;
    instance.isPlaying = true;
    instance.isPaused = false;
    instance.startTime = ctx.currentTime - offset;
  }

  /**
   * Stop playback and reset offset.
   */
  stop(entityId: string): void {
    const instance = this.instances.get(entityId);
    if (!instance) return;

    if (instance.source) {
      try {
        instance.source.stop();
      } catch {
        // Already stopped
      }
      instance.source = null;
    }

    instance.isPlaying = false;
    instance.isPaused = false;
    instance.pauseOffset = 0;
    instance.startTime = 0;
  }

  /**
   * Pause playback (records offset for resume).
   */
  pause(entityId: string): void {
    const instance = this.instances.get(entityId);
    if (!instance || !instance.isPlaying) return;

    const ctx = this.ensureContext();
    const elapsed = ctx.currentTime - instance.startTime;
    instance.pauseOffset = elapsed;

    if (instance.source) {
      try {
        instance.source.stop();
      } catch {
        // Already stopped
      }
      instance.source = null;
    }

    instance.isPlaying = false;
    instance.isPaused = true;
  }

  /**
   * Resume playback from paused offset.
   */
  resume(entityId: string): void {
    const instance = this.instances.get(entityId);
    if (!instance || !instance.isPaused) return;

    this.play(entityId);
  }

  /**
   * Set volume for an entity's audio.
   */
  setVolume(entityId: string, volume: number): void {
    const instance = this.instances.get(entityId);
    if (!instance) return;
    instance.gainNode.gain.value = Math.max(0, Math.min(1, volume));
  }

  /**
   * Set pitch (playback rate) for an entity's audio.
   */
  setPitch(entityId: string, rate: number): void {
    const instance = this.instances.get(entityId);
    if (!instance?.source) return;
    instance.source.playbackRate.value = Math.max(0.25, Math.min(4, rate));
  }

  /**
   * Update spatial position for an entity's audio.
   */
  updatePosition(entityId: string, x: number, y: number, z: number): void {
    const instance = this.instances.get(entityId);
    if (!instance?.pannerNode) return;
    instance.pannerNode.positionX.value = x;
    instance.pannerNode.positionY.value = y;
    instance.pannerNode.positionZ.value = z;
  }

  /**
   * Update listener (camera) position and orientation.
   */
  updateListener(
    x: number,
    y: number,
    z: number,
    fx: number,
    fy: number,
    fz: number
  ): void {
    const ctx = this.ensureContext();
    const listener = ctx.listener;

    if (listener.positionX) {
      listener.positionX.value = x;
      listener.positionY.value = y;
      listener.positionZ.value = z;
      listener.forwardX.value = fx;
      listener.forwardY.value = fy;
      listener.forwardZ.value = fz;
      listener.upX.value = 0;
      listener.upY.value = 1;
      listener.upZ.value = 0;
    } else {
      // Fallback for older browsers
      listener.setPosition(x, y, z);
      listener.setOrientation(fx, fy, fz, 0, 1, 0);
    }
  }

  /**
   * Destroy an audio instance for an entity.
   */
  destroyInstance(entityId: string): void {
    const instance = this.instances.get(entityId);
    if (!instance) return;

    this.stop(entityId);

    // Disconnect nodes
    instance.gainNode.disconnect();
    instance.pannerNode?.disconnect();

    this.instances.delete(entityId);
  }

  /**
   * Destroy all audio instances (used on Stop mode).
   */
  destroyAll(): void {
    for (const entityId of Array.from(this.instances.keys())) {
      this.destroyInstance(entityId);
    }
  }

  /**
   * Check if an entity's audio is currently playing.
   */
  isPlaying(entityId: string): boolean {
    const instance = this.instances.get(entityId);
    return instance?.isPlaying ?? false;
  }

  /**
   * Set the volume of a bus.
   */
  setBusVolume(busName: string, volume: number): void {
    const bus = this.buses.get(busName);
    if (!bus) return;
    bus.volume = Math.max(0, Math.min(1, volume));
    this.recomputeEffectiveGains();
  }

  /**
   * Set the mute state of a bus.
   */
  muteBus(busName: string, muted: boolean): void {
    const bus = this.buses.get(busName);
    if (!bus) return;
    bus.muted = muted;
    this.recomputeEffectiveGains();
  }

  /**
   * Set the solo state of a bus.
   */
  soloBus(busName: string, soloed: boolean): void {
    const bus = this.buses.get(busName);
    if (!bus) return;
    bus.soloed = soloed;
    this.recomputeEffectiveGains();
  }

  /**
   * Get the current volume of a bus.
   */
  getBusVolume(busName: string): number {
    const bus = this.buses.get(busName);
    return bus?.volume ?? 1.0;
  }

  /**
   * Check if a bus is muted.
   */
  isBusMuted(busName: string): boolean {
    const bus = this.buses.get(busName);
    return bus?.effectiveMuted ?? false;
  }

  /**
   * Recompute effective gains for all buses based on solo/mute state.
   *
   * Rules:
   * - If ANY bus is soloed, all non-soloed buses are effectively muted.
   * - A bus that is both soloed and muted is still muted.
   * - Master bus is never affected by solo (it sums everything).
   */
  private recomputeEffectiveGains(): void {
    const anySoloed = Array.from(this.buses.values()).some(
      (b) => b.name !== 'master' && b.soloed
    );

    for (const bus of this.buses.values()) {
      if (bus.name === 'master') {
        bus.effectiveMuted = bus.muted;
      } else {
        bus.effectiveMuted = bus.muted || (anySoloed && !bus.soloed);
      }
      bus.gainNode.gain.value = bus.effectiveMuted ? 0 : bus.volume;
    }
  }

  /**
   * Create a new audio bus.
   */
  createBus(name: string, volume: number = 1.0): void {
    if (!this.ctx || this.buses.has(name)) return;

    const gainNode = this.ctx.createGain();
    gainNode.gain.value = volume;

    const bus: BusState = {
      name,
      gainNode,
      volume,
      muted: false,
      soloed: false,
      effectiveMuted: false,
      effects: [],
    };

    this.buses.set(name, bus);

    // Connect to master
    const masterBus = this.buses.get('master');
    if (masterBus) {
      gainNode.connect(masterBus.gainNode);
    }
  }

  /**
   * Delete an audio bus (reassign entities to 'sfx').
   */
  deleteBus(name: string): void {
    if (name === 'master' || !this.buses.has(name)) return;

    const bus = this.buses.get(name)!;

    // Reassign all entities using this bus to 'sfx'
    for (const instance of this.instances.values()) {
      if (instance.bus === name) {
        instance.bus = 'sfx';
        // If currently playing, need to reconnect
        if (instance.isPlaying) {
          const lastNode = instance.pannerNode ?? instance.gainNode;
          lastNode.disconnect();
          const sfxBus = this.buses.get('sfx')!;
          lastNode.connect(sfxBus.gainNode);
        }
      }
    }

    // Disconnect and remove bus
    bus.gainNode.disconnect();
    for (const fx of bus.effects) {
      fx.outputNode.disconnect();
    }
    this.buses.delete(name);
  }

  /**
   * Apply full bus configuration from Rust (bulk sync).
   */
  applyBusConfig(config: { buses: Array<{ name: string; volume: number; muted: boolean; soloed: boolean; effects: Array<{ effectType: string; params: Record<string, number>; enabled: boolean }> }> }): void {
    if (!this.ctx) {
      this.ensureContext();
    }

    // Remove buses not in config (except default ones)
    const configNames = new Set(config.buses.map((b) => b.name));
    for (const busName of this.buses.keys()) {
      if (!configNames.has(busName)) {
        this.deleteBus(busName);
      }
    }

    // Create or update buses
    for (const busConfig of config.buses) {
      if (!this.buses.has(busConfig.name)) {
        this.createBus(busConfig.name, busConfig.volume);
      }

      const bus = this.buses.get(busConfig.name);
      if (bus) {
        bus.volume = busConfig.volume;
        bus.muted = busConfig.muted;
        bus.soloed = busConfig.soloed;
        // Apply effects
        this.setBusEffects(busConfig.name, busConfig.effects);
      }
    }

    this.recomputeEffectiveGains();
  }

  /**
   * Set the full effects chain for a bus.
   */
  setBusEffects(busName: string, effectDefs: Array<{ effectType: string; params: Record<string, number>; enabled: boolean }>): void {
    const bus = this.buses.get(busName);
    if (!bus) return;

    // Disconnect current chain
    this.disconnectBusChain(bus);

    // Create new effect instances
    bus.effects = effectDefs
      .filter((def) => def.enabled)
      .map((def) => this.createEffectInstance(def));

    // Reconnect chain
    this.connectBusChain(bus);
  }

  /**
   * Disconnect a bus from its current chain and master.
   */
  private disconnectBusChain(bus: BusState): void {
    bus.gainNode.disconnect();
    for (const fx of bus.effects) {
      fx.outputNode.disconnect();
    }
  }

  /**
   * Connect bus -> effects -> master (or destination for master bus).
   */
  private connectBusChain(bus: BusState): void {
    if (!this.ctx) return;

    const target =
      bus.name === 'master'
        ? this.ctx.destination
        : this.buses.get('master')!.gainNode;

    if (bus.effects.length === 0) {
      bus.gainNode.connect(target);
      return;
    }

    // Chain: busGain -> fx0.input -> fx0.output -> fx1.input -> ... -> target
    bus.gainNode.connect(bus.effects[0].inputNode);
    for (let i = 0; i < bus.effects.length - 1; i++) {
      bus.effects[i].outputNode.connect(bus.effects[i + 1].inputNode);
    }
    bus.effects[bus.effects.length - 1].outputNode.connect(target);
  }

  /**
   * Create an EffectInstance from a definition.
   */
  private createEffectInstance(def: { effectType: string; params: Record<string, number>; enabled: boolean }): EffectInstance {
    if (!this.ctx) throw new Error('AudioContext not initialized');

    switch (def.effectType) {
      case 'reverb':
        return this.createReverbEffect(this.ctx, def.params);
      case 'lowpass':
        return this.createFilterEffect(this.ctx, 'lowpass', def.params);
      case 'highpass':
        return this.createFilterEffect(this.ctx, 'highpass', def.params);
      case 'compressor':
        return this.createCompressorEffect(this.ctx, def.params);
      case 'delay':
        return this.createDelayEffect(this.ctx, def.params);
      default:
        // Passthrough: gain node with gain 1
        const passthrough = this.ctx.createGain();
        return {
          type: def.effectType,
          inputNode: passthrough,
          outputNode: passthrough,
          params: def.params,
          enabled: true,
        };
    }
  }

  /**
   * Create a reverb effect with procedural impulse response.
   */
  private createReverbEffect(ctx: AudioContext, params: Record<string, number>): EffectInstance {
    const preset = params.preset ?? 0;
    const wet = params.wet ?? 0.5;

    const convolver = ctx.createConvolver();
    convolver.buffer = this.getIRBuffer(preset);

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

  /**
   * Create a filter effect (lowpass or highpass).
   */
  private createFilterEffect(ctx: AudioContext, type: 'lowpass' | 'highpass', params: Record<string, number>): EffectInstance {
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

  /**
   * Create a compressor effect.
   */
  private createCompressorEffect(ctx: AudioContext, params: Record<string, number>): EffectInstance {
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

  /**
   * Create a delay effect with feedback.
   */
  private createDelayEffect(ctx: AudioContext, params: Record<string, number>): EffectInstance {
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
   * Generate a synthetic impulse response buffer.
   */
  private getIRBuffer(presetIndex: number): AudioBuffer {
    if (this.irBuffers.has(presetIndex)) return this.irBuffers.get(presetIndex)!;

    const ctx = this.ctx!;
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

    this.irBuffers.set(presetIndex, buffer);
    return buffer;
  }
}

export const audioManager = new AudioManager();
