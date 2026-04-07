import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MAX_TOKENS,
  THINKING_MAX_TOKENS,
  RETRY_DEFAULT_MAX_ATTEMPTS,
  RETRY_DEFAULT_BASE_DELAY_MS,
  RETRY_DEFAULT_MAX_DELAY_MS,
  TOKEN_DEDUCT_MAX_RETRIES,
  BILLING_CYCLE_DAYS,
  BILLING_CYCLE_MS,
  SPRITE_SHEET_MIN_FRAMES,
  SPRITE_SHEET_MAX_FRAMES,
  SPRITE_SHEET_COST_PER_FRAME,
  VOICE_BATCH_MAX_ITEMS,
  VOICE_BATCH_COST_PER_ITEM,
  MARKETPLACE_MAX_PREVIEW_BYTES,
  MARKETPLACE_MAX_ASSET_BYTES,
  CHAT_BODY_MAX_BYTES,
  AI_QUEUE_DEFAULT_MAX_CONCURRENT,
  AI_QUEUE_DEFAULT_MAX_DEPTH,
  ENGINE_INIT_MAX_RETRIES,
} from '../constants';

describe('constants', () => {
  it('AI model token limits are positive integers', () => {
    expect(DEFAULT_MAX_TOKENS).toBeGreaterThan(0);
    expect(Number.isInteger(DEFAULT_MAX_TOKENS)).toBe(true);
    expect(THINKING_MAX_TOKENS).toBeGreaterThan(DEFAULT_MAX_TOKENS);
  });

  it('retry defaults are sensible', () => {
    expect(RETRY_DEFAULT_MAX_ATTEMPTS).toBeGreaterThanOrEqual(1);
    expect(RETRY_DEFAULT_BASE_DELAY_MS).toBeGreaterThan(0);
    expect(RETRY_DEFAULT_MAX_DELAY_MS).toBeGreaterThan(RETRY_DEFAULT_BASE_DELAY_MS);
    expect(TOKEN_DEDUCT_MAX_RETRIES).toBeGreaterThanOrEqual(1);
  });

  it('billing cycle is internally consistent', () => {
    expect(BILLING_CYCLE_DAYS).toBe(30);
    expect(BILLING_CYCLE_MS).toBe(BILLING_CYCLE_DAYS * 24 * 60 * 60 * 1000);
  });

  it('sprite sheet frame range is valid', () => {
    expect(SPRITE_SHEET_MIN_FRAMES).toBeLessThan(SPRITE_SHEET_MAX_FRAMES);
    expect(SPRITE_SHEET_MIN_FRAMES).toBeGreaterThanOrEqual(1);
    expect(SPRITE_SHEET_COST_PER_FRAME).toBeGreaterThan(0);
  });

  it('voice batch limits are sensible', () => {
    expect(VOICE_BATCH_MAX_ITEMS).toBeGreaterThan(0);
    expect(VOICE_BATCH_COST_PER_ITEM).toBeGreaterThan(0);
  });

  it('asset size limits are in expected ranges', () => {
    expect(MARKETPLACE_MAX_PREVIEW_BYTES).toBe(5 * 1024 * 1024);
    expect(MARKETPLACE_MAX_ASSET_BYTES).toBe(100 * 1024 * 1024);
    expect(CHAT_BODY_MAX_BYTES).toBe(1024 * 1024);
  });

  it('AI queue defaults are reasonable', () => {
    expect(AI_QUEUE_DEFAULT_MAX_CONCURRENT).toBeGreaterThan(0);
    expect(AI_QUEUE_DEFAULT_MAX_DEPTH).toBeGreaterThan(AI_QUEUE_DEFAULT_MAX_CONCURRENT);
  });

  it('engine init retries is positive', () => {
    expect(ENGINE_INIT_MAX_RETRIES).toBeGreaterThanOrEqual(1);
  });
});
