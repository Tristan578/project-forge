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
  duckGainNode: GainNode;
}

interface EffectInstance {
  type: string;
  inputNode: AudioNode;
  outputNode: AudioNode;
  params: Record<string, number>;
  enabled: boolean;
}

interface DuckingRule {
  triggerBus: string;
  targetBus: string;
  duckLevel: number;
  attackMs: number;
  releaseMs: number;
}

class AudioManager {
  private ctx: AudioContext | null = null;
  private instances: Map<string, AudioInstance> = new Map();
  private buffers: Map<string, AudioBuffer> = new Map();
  private buses: Map<string, BusState> = new Map();
  private irBuffers: Map<number, AudioBuffer> = new Map();
  private oneShotInstances: Map<string, { source: AudioBufferSourceNode; gainNode: GainNode }> = new Map();
  private oneShotCount = 0;
  private duckingRules: DuckingRule[] = [];
  private activeDuckTriggers: Map<string, number> = new Map();
  private occlusionEnabled: Set<string> = new Set();
  private occlusionFilters: Map<string, BiquadFilterNode> = new Map();

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

      const duckGainNode = this.ctx.createGain();
      duckGainNode.gain.value = 1.0;

      // Master bus: gainNode -> duckGainNode -> destination
      // Other buses: gainNode -> duckGainNode -> (will connect to master later)
      if (busConfig.name === 'master') {
        gainNode.connect(duckGainNode).connect(this.ctx.destination);
      }

      const bus: BusState = {
        name: busConfig.name,
        gainNode,
        volume: busConfig.volume,
        muted: busConfig.muted,
        soloed: busConfig.soloed,
        effectiveMuted: false,
        effects: [],
        duckGainNode,
      };

      this.buses.set(busConfig.name, bus);
    }

    // Connect non-master buses to master via duckGainNode
    const masterBus = this.buses.get('master')!;
    for (const bus of this.buses.values()) {
      if (bus.name !== 'master') {
        bus.gainNode.connect(bus.duckGainNode).connect(masterBus.gainNode);
      }
    }

    // Add default ducking rule: voice -> music
    this.addDuckingRule({
      triggerBus: 'voice',
      targetBus: 'music',
      duckLevel: 0.3,
      attackMs: 200,
      releaseMs: 500,
    });
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
    },
    slot?: string
  ): void {
    const ctx = this.ensureContext();
    const buffer = this.buffers.get(assetId);

    if (!buffer) {
      console.warn(`[AudioManager] Buffer ${assetId} not loaded for entity ${entityId}`);
      return;
    }

    const key = this.instanceKey(entityId, slot);

    // Destroy existing instance if any
    this.destroyInstance(entityId, slot);

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

    this.instances.set(key, instance);
  }

  private instanceKey(entityId: string, slot?: string): string {
    return slot ? `${entityId}:${slot}` : entityId;
  }

  /**
   * Start playback for an entity.
   */
  play(entityId: string, slot?: string): void {
    const key = this.instanceKey(entityId, slot);
    const instance = this.instances.get(key);
    if (!instance) {
      console.warn(`[AudioManager] Instance ${key} not found`);
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

    this.checkDuckingOnPlay(busName);
  }

  /**
   * Stop playback and reset offset.
   */
  stop(entityId: string, slot?: string): void {
    const key = this.instanceKey(entityId, slot);
    const instance = this.instances.get(key);
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

    this.checkDuckingOnStop(instance.bus);
  }

  /**
   * Pause playback (records offset for resume).
   */
  pause(entityId: string, slot?: string): void {
    const key = this.instanceKey(entityId, slot);
    const instance = this.instances.get(key);
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
  resume(entityId: string, slot?: string): void {
    const key = this.instanceKey(entityId, slot);
    const instance = this.instances.get(key);
    if (!instance || !instance.isPaused) return;

    this.play(entityId, slot);
  }

  /**
   * Set volume for an entity's audio.
   */
  setVolume(entityId: string, volume: number, slot?: string): void {
    const key = this.instanceKey(entityId, slot);
    const instance = this.instances.get(key);
    if (!instance) return;
    instance.gainNode.gain.value = Math.max(0, Math.min(1, volume));
  }

  /**
   * Set pitch (playback rate) for an entity's audio.
   */
  setPitch(entityId: string, rate: number, slot?: string): void {
    const key = this.instanceKey(entityId, slot);
    const instance = this.instances.get(key);
    if (!instance?.source) return;
    instance.source.playbackRate.value = Math.max(0.25, Math.min(4, rate));
  }

  /**
   * Update spatial position for an entity's audio.
   */
  updatePosition(entityId: string, x: number, y: number, z: number, slot?: string): void {
    const key = this.instanceKey(entityId, slot);
    const instance = this.instances.get(key);
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
  destroyInstance(entityId: string, slot?: string): void {
    const key = this.instanceKey(entityId, slot);
    const instance = this.instances.get(key);
    if (!instance) return;

    this.stop(entityId, slot);

    // Disconnect nodes
    instance.gainNode.disconnect();
    instance.pannerNode?.disconnect();

    this.instances.delete(key);

    // If called without slot, also destroy all layers
    if (!slot) {
      this.removeAllLayers(entityId);
    }
  }

  /**
   * Destroy all audio instances (used on Stop mode).
   */
  destroyAll(): void {
    for (const entityId of Array.from(this.instances.keys())) {
      this.destroyInstance(entityId);
    }
    this.cancelAllOneShots();
  }

  /**
   * Check if an entity's audio is currently playing.
   */
  isPlaying(entityId: string, slot?: string): boolean {
    const key = this.instanceKey(entityId, slot);
    const instance = this.instances.get(key);
    return instance?.isPlaying ?? false;
  }

  // --- Audio Layers ---
  addLayer(entityId: string, slotName: string, assetId: string, options?: {
    volume?: number; pitch?: number; loop?: boolean; spatial?: boolean; bus?: string;
  }): void {
    const ctx = this.ensureContext();
    const buffer = this.buffers.get(assetId);
    if (!buffer) {
      console.warn(`[AudioManager] Buffer ${assetId} not loaded for layer ${slotName}`);
      return;
    }
    // Cap layers per entity at 8
    const layerCount = Array.from(this.instances.keys()).filter(k => k.startsWith(`${entityId}:`)).length;
    if (layerCount >= 8) {
      console.warn(`[AudioManager] Max 8 layers per entity reached for ${entityId}`);
      return;
    }
    const key = this.instanceKey(entityId, slotName);
    // Destroy existing layer with same name
    if (this.instances.has(key)) {
      this.destroyInstance(entityId, slotName);
    }
    const gainNode = ctx.createGain();
    gainNode.gain.value = options?.volume ?? 1.0;
    let pannerNode: PannerNode | null = null;
    if (options?.spatial) {
      pannerNode = ctx.createPanner();
      pannerNode.distanceModel = 'inverse';
      pannerNode.refDistance = 1;
      pannerNode.maxDistance = 50;
      pannerNode.rolloffFactor = 1;
      // Copy spatial position from primary instance
      const primary = this.instances.get(entityId);
      if (primary?.pannerNode) {
        pannerNode.positionX.value = primary.pannerNode.positionX.value;
        pannerNode.positionY.value = primary.pannerNode.positionY.value;
        pannerNode.positionZ.value = primary.pannerNode.positionZ.value;
      }
    }
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
      loop: options?.loop ?? false,
      bus: options?.bus ?? 'sfx',
    };
    this.instances.set(key, instance);
    // Auto-play the layer
    this.play(entityId, slotName);
  }

  removeLayer(entityId: string, slotName: string): void {
    this.destroyInstance(entityId, slotName);
  }

  removeAllLayers(entityId: string): void {
    const layerKeys = Array.from(this.instances.keys()).filter(k => k.startsWith(`${entityId}:`));
    for (const key of layerKeys) {
      const parts = key.split(':');
      this.destroyInstance(entityId, parts.slice(1).join(':'));
    }
  }

  getEntitySlots(entityId: string): string[] {
    const slots: string[] = [];
    for (const key of this.instances.keys()) {
      if (key === entityId) {
        slots.push('');
      } else if (key.startsWith(`${entityId}:`)) {
        slots.push(key.substring(entityId.length + 1));
      }
    }
    return slots;
  }

  crossfade(fromEntityId: string, toEntityId: string, durationMs: number, fromSlot?: string, toSlot?: string): void {
    if (fromEntityId === toEntityId && fromSlot === toSlot) {
      console.warn('[AudioManager] Cannot crossfade to same source');
      return;
    }
    const ctx = this.ensureContext();
    const now = ctx.currentTime;
    const duration = durationMs / 1000;
    const fromKey = this.instanceKey(fromEntityId, fromSlot);
    const toKey = this.instanceKey(toEntityId, toSlot);
    const fromInstance = this.instances.get(fromKey);
    const toInstance = this.instances.get(toKey);
    if (fromInstance) {
      fromInstance.gainNode.gain.cancelScheduledValues(now);
      fromInstance.gainNode.gain.setValueAtTime(fromInstance.gainNode.gain.value, now);
      fromInstance.gainNode.gain.linearRampToValueAtTime(0, now + duration);
      setTimeout(() => this.stop(fromEntityId, fromSlot), durationMs);
    }
    if (toInstance) {
      const targetVolume = toInstance.gainNode.gain.value || 1.0;
      toInstance.gainNode.gain.cancelScheduledValues(now);
      toInstance.gainNode.gain.setValueAtTime(0, now);
      toInstance.gainNode.gain.linearRampToValueAtTime(targetVolume, now + duration);
      if (!toInstance.isPlaying) {
        this.play(toEntityId, toSlot);
      }
    }
  }

  fadeIn(entityId: string, durationMs: number, slot?: string): void {
    const ctx = this.ensureContext();
    const now = ctx.currentTime;
    const key = this.instanceKey(entityId, slot);
    const instance = this.instances.get(key);
    if (!instance) return;
    const targetVolume = instance.gainNode.gain.value || 1.0;
    instance.gainNode.gain.cancelScheduledValues(now);
    instance.gainNode.gain.setValueAtTime(0, now);
    instance.gainNode.gain.linearRampToValueAtTime(targetVolume, now + durationMs / 1000);
    if (!instance.isPlaying) {
      this.play(entityId, slot);
    }
  }

  fadeOut(entityId: string, durationMs: number, stopAfter: boolean = true, slot?: string): void {
    const ctx = this.ensureContext();
    const now = ctx.currentTime;
    const key = this.instanceKey(entityId, slot);
    const instance = this.instances.get(key);
    if (!instance) return;
    instance.gainNode.gain.cancelScheduledValues(now);
    instance.gainNode.gain.setValueAtTime(instance.gainNode.gain.value, now);
    instance.gainNode.gain.linearRampToValueAtTime(0, now + durationMs / 1000);
    if (stopAfter) {
      setTimeout(() => this.stop(entityId, slot), durationMs);
    }
  }

  playOneShot(assetId: string, options?: {
    position?: [number, number, number]; bus?: string; volume?: number; pitch?: number;
  }): string {
    const ctx = this.ensureContext();
    const buffer = this.buffers.get(assetId);
    if (!buffer) {
      console.warn(`[AudioManager] Buffer ${assetId} not loaded for one-shot`);
      return '';
    }
    // Cap one-shots at 32
    if (this.oneShotInstances.size >= 32) {
      const oldest = this.oneShotInstances.keys().next().value;
      if (oldest) this.cancelOneShot(oldest);
    }
    const id = `__oneshot_${++this.oneShotCount}`;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = false;
    if (options?.pitch) {
      source.playbackRate.value = Math.max(0.25, Math.min(4, options.pitch));
    }
    const gainNode = ctx.createGain();
    gainNode.gain.value = Math.max(0, Math.min(1, options?.volume ?? 1.0));
    let pannerNode: PannerNode | null = null;
    if (options?.position) {
      pannerNode = ctx.createPanner();
      pannerNode.distanceModel = 'inverse';
      pannerNode.refDistance = 1;
      pannerNode.maxDistance = 50;
      pannerNode.rolloffFactor = 1;
      pannerNode.positionX.value = options.position[0];
      pannerNode.positionY.value = options.position[1];
      pannerNode.positionZ.value = options.position[2];
    }
    const busName = options?.bus ?? 'sfx';
    const bus = this.buses.get(busName) ?? this.buses.get('sfx')!;
    if (pannerNode) {
      source.connect(gainNode).connect(pannerNode).connect(bus.gainNode);
    } else {
      source.connect(gainNode).connect(bus.gainNode);
    }
    source.onended = () => {
      source.disconnect();
      gainNode.disconnect();
      pannerNode?.disconnect();
      this.oneShotInstances.delete(id);
    };
    source.start();
    this.oneShotInstances.set(id, { source, gainNode });
    // Check ducking after one-shot plays
    this.checkDuckingOnPlay(busName);
    return id;
  }

  cancelOneShot(id: string): void {
    const oneshot = this.oneShotInstances.get(id);
    if (oneshot) {
      try { oneshot.source.stop(); } catch { /* already stopped */ }
      oneshot.source.disconnect();
      oneshot.gainNode.disconnect();
      this.oneShotInstances.delete(id);
    }
  }

  cancelAllOneShots(): void {
    for (const id of Array.from(this.oneShotInstances.keys())) {
      this.cancelOneShot(id);
    }
  }

  addDuckingRule(rule: DuckingRule): void {
    this.duckingRules = this.duckingRules.filter(
      r => !(r.triggerBus === rule.triggerBus && r.targetBus === rule.targetBus)
    );
    this.duckingRules.push(rule);
  }

  removeDuckingRule(triggerBus: string, targetBus: string): void {
    this.duckingRules = this.duckingRules.filter(
      r => !(r.triggerBus === triggerBus && r.targetBus === targetBus)
    );
  }

  getDuckingRules(): DuckingRule[] {
    return [...this.duckingRules];
  }

  private checkDuckingOnPlay(busName: string): void {
    const count = (this.activeDuckTriggers.get(busName) ?? 0) + 1;
    this.activeDuckTriggers.set(busName, count);
    if (count === 1) {
      for (const rule of this.duckingRules) {
        if (rule.triggerBus === busName) {
          this.applyDuck(rule);
        }
      }
    }
  }

  private checkDuckingOnStop(busName: string): void {
    const count = Math.max(0, (this.activeDuckTriggers.get(busName) ?? 0) - 1);
    this.activeDuckTriggers.set(busName, count);
    if (count === 0) {
      for (const rule of this.duckingRules) {
        if (rule.triggerBus === busName) {
          this.releaseDuck(rule);
        }
      }
    }
  }

  private applyDuck(rule: DuckingRule): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const targetBus = this.buses.get(rule.targetBus);
    if (!targetBus) return;
    const now = ctx.currentTime;
    targetBus.duckGainNode.gain.cancelScheduledValues(now);
    targetBus.duckGainNode.gain.setValueAtTime(targetBus.duckGainNode.gain.value, now);
    targetBus.duckGainNode.gain.linearRampToValueAtTime(rule.duckLevel, now + rule.attackMs / 1000);
  }

  private releaseDuck(rule: DuckingRule): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const targetBus = this.buses.get(rule.targetBus);
    if (!targetBus) return;
    const now = ctx.currentTime;
    targetBus.duckGainNode.gain.cancelScheduledValues(now);
    targetBus.duckGainNode.gain.setValueAtTime(targetBus.duckGainNode.gain.value, now);
    targetBus.duckGainNode.gain.linearRampToValueAtTime(1.0, now + rule.releaseMs / 1000);
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

    const duckGainNode = this.ctx.createGain();
    duckGainNode.gain.value = 1.0;

    const bus: BusState = {
      name,
      gainNode,
      volume,
      muted: false,
      soloed: false,
      effectiveMuted: false,
      effects: [],
      duckGainNode,
    };

    this.buses.set(name, bus);

    // Connect to master: gainNode → duckGainNode → masterBus.gainNode
    const masterBus = this.buses.get('master');
    if (masterBus) {
      gainNode.connect(duckGainNode).connect(masterBus.gainNode);
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
    bus.duckGainNode.disconnect();
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
    bus.duckGainNode.disconnect();
    for (const fx of bus.effects) {
      fx.outputNode.disconnect();
    }
  }

  /**
   * Connect bus → effects → duckGainNode → master (or destination for master bus).
   */
  private connectBusChain(bus: BusState): void {
    if (!this.ctx) return;

    const target =
      bus.name === 'master'
        ? this.ctx.destination
        : this.buses.get('master')!.gainNode;

    if (bus.effects.length === 0) {
      bus.gainNode.connect(bus.duckGainNode).connect(target);
      return;
    }

    // Chain: busGain → fx0.input → fx0.output → fx1.input → ... → duckGainNode → target
    bus.gainNode.connect(bus.effects[0].inputNode);
    for (let i = 0; i < bus.effects.length - 1; i++) {
      bus.effects[i].outputNode.connect(bus.effects[i + 1].inputNode);
    }
    bus.effects[bus.effects.length - 1].outputNode.connect(bus.duckGainNode).connect(target);
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

  /**
   * Enable or disable audio occlusion for an entity.
   * When enabled, low-pass filtering is applied when geometry blocks listener-source line.
   */
  setOcclusion(entityId: string, enabled: boolean): void {
    if (enabled) {
      this.occlusionEnabled.add(entityId);
      // Create low-pass filter if needed
      if (!this.occlusionFilters.has(entityId)) {
        const ctx = this.ensureContext();
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 5000; // Default occluded frequency
        filter.Q.value = 1.0;
        this.occlusionFilters.set(entityId, filter);
      }
    } else {
      this.occlusionEnabled.delete(entityId);
      const filter = this.occlusionFilters.get(entityId);
      if (filter) {
        filter.disconnect();
        this.occlusionFilters.delete(entityId);
      }
    }
  }

  /**
   * Update occlusion state based on raycasting result.
   * In production, this would be called from the physics raycasting system.
   */
  updateOcclusionState(entityId: string, occluded: boolean): void {
    if (!this.occlusionEnabled.has(entityId)) return;

    const filter = this.occlusionFilters.get(entityId);
    if (!filter || !this.ctx) return;

    const now = this.ctx.currentTime;
    const targetFreq = occluded ? 500 : 5000; // Muffled vs clear
    filter.frequency.linearRampToValueAtTime(targetFreq, now + 0.1);
  }

  /**
   * Check if occlusion is enabled for an entity.
   */
  isOcclusionEnabled(entityId: string): boolean {
    return this.occlusionEnabled.has(entityId);
  }
}

export const audioManager = new AudioManager();
