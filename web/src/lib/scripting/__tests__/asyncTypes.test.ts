import { describe, it, expect } from 'vitest';
import {
  ASYNC_CHANNELS,
  CHANNEL_CONFIGS,
  CHANNEL_ALLOWED_METHODS,
  type AsyncChannel,
  type AsyncRequest,
  type AsyncResponse,
} from '../asyncTypes';

describe('asyncTypes', () => {
  it('defines all 6 channels', () => {
    expect(ASYNC_CHANNELS).toHaveLength(6);
    expect(ASYNC_CHANNELS).toContain('physics');
    expect(ASYNC_CHANNELS).toContain('audio');
    expect(ASYNC_CHANNELS).toContain('ai');
    expect(ASYNC_CHANNELS).toContain('asset');
    expect(ASYNC_CHANNELS).toContain('animation');
    expect(ASYNC_CHANNELS).toContain('multiplayer');
  });

  it('has config for every channel', () => {
    for (const ch of ASYNC_CHANNELS) {
      const config = CHANNEL_CONFIGS[ch];
      expect(config).toBeDefined();
      expect(typeof config.maxConcurrent).toBe('number');
      expect(typeof config.timeoutMs).toBe('number');
      expect(typeof config.supportsProgress).toBe('boolean');
      expect(typeof config.playModeOnly).toBe('boolean');
    }
  });

  it('has allowed methods for every channel', () => {
    for (const ch of ASYNC_CHANNELS) {
      expect(CHANNEL_ALLOWED_METHODS[ch]).toBeInstanceOf(Set);
    }
  });

  it('physics has expected timeout and concurrency', () => {
    const config = CHANNEL_CONFIGS.physics;
    expect(config.timeoutMs).toBe(1_000);
    expect(config.maxConcurrent).toBe(32);
    expect(config.supportsProgress).toBe(false);
    expect(config.playModeOnly).toBe(true);
  });

  it('ai supports progress and has long timeout', () => {
    const config = CHANNEL_CONFIGS.ai;
    expect(config.timeoutMs).toBe(120_000);
    expect(config.supportsProgress).toBe(true);
    expect(config.maxConcurrent).toBe(3);
  });

  it('multiplayer has stub methods defined', () => {
    expect(CHANNEL_ALLOWED_METHODS.multiplayer.size).toBeGreaterThan(0);
    expect(CHANNEL_ALLOWED_METHODS.multiplayer.has('connect')).toBe(true);
    expect(CHANNEL_ALLOWED_METHODS.multiplayer.has('send')).toBe(true);
  });

  it('physics allowed methods include raycast', () => {
    expect(CHANNEL_ALLOWED_METHODS.physics.has('raycast')).toBe(true);
    expect(CHANNEL_ALLOWED_METHODS.physics.has('raycast2d')).toBe(true);
    expect(CHANNEL_ALLOWED_METHODS.physics.has('isGrounded')).toBe(true);
  });

  it('AsyncRequest type can be constructed', () => {
    const req: AsyncRequest = {
      type: 'async_request',
      requestId: 'req_1',
      channel: 'physics' as AsyncChannel,
      method: 'raycast',
      args: { origin: [0, 0, 0] },
    };
    expect(req.type).toBe('async_request');
    expect(req.channel).toBe('physics');
  });

  it('AsyncResponse type can be constructed with ok status', () => {
    const resp: AsyncResponse = {
      requestId: 'req_1',
      status: 'ok',
      data: { hit: true },
    };
    expect(resp.status).toBe('ok');
    expect(resp.data).toEqual({ hit: true });
  });

  it('AsyncResponse type can be constructed with progress status', () => {
    const resp: AsyncResponse = {
      requestId: 'req_1',
      status: 'progress',
      progress: { percent: 50, message: 'Loading...' },
    };
    expect(resp.status).toBe('progress');
    expect(resp.progress?.percent).toBe(50);
  });
});
