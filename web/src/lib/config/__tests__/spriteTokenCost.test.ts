/**
 * @vitest-environment node
 *
 * The single-sprite price the user is quoted, the balance the dialog gates on,
 * and the amount the route charges must all be the same number (#9741).
 *
 * They were not. `GenerateSpriteDialog` hard-coded `15` for both the quote and
 * its `canSubmit` threshold while `/api/generate/sprite` resolved `auto` by
 * style and charged `SPRITE_TOKEN_COST` — 10 for SDXL, 20 for DALL-E. 15 is
 * neither, so the tab was wrong for every single-sprite generation in one
 * direction or the other: a 10-14 balance was refused on a pixel-art request
 * the server would have charged 10 for, and a 15-19 balance submitted a
 * request the server then rejected for 20, after the user had committed to it.
 *
 * Reported by Devin on #9727. These assertions are the reason the dialog and
 * the route now share one resolver instead of each carrying a copy.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveSpriteProvider,
  spriteTokenCost,
  SPRITE_TOKEN_COST,
  SPRITE_STYLES,
} from '../providers';
import { TOKEN_COSTS } from '@/lib/tokens/pricing';

describe('resolveSpriteProvider', () => {
  // The rule the route applies to `auto`, pinned here so the dialog and the
  // route cannot drift apart again.
  it('routes pixel-art to SDXL and every other style to DALL-E', () => {
    expect(resolveSpriteProvider('pixel-art')).toBe('sdxl');
    for (const style of SPRITE_STYLES.filter((s) => s !== 'pixel-art')) {
      expect(resolveSpriteProvider(style), style).toBe('dalle3');
    }
  });

  it('honours an explicit provider over the style', () => {
    expect(resolveSpriteProvider('pixel-art', 'dalle3')).toBe('dalle3');
    expect(resolveSpriteProvider('realistic', 'sdxl')).toBe('sdxl');
  });

  it('treats a missing style as the default (non-pixel) route', () => {
    expect(resolveSpriteProvider(undefined)).toBe('dalle3');
  });
});

describe('spriteTokenCost', () => {
  it('quotes each provider its own price, and 15 is neither', () => {
    expect(spriteTokenCost('pixel-art')).toBe(10);
    expect(spriteTokenCost('realistic')).toBe(20);
    // The value that shipped. Named so a reader sees why this file exists.
    expect(spriteTokenCost('pixel-art')).not.toBe(15);
    expect(spriteTokenCost('realistic')).not.toBe(15);
  });

  it('agrees with the constants the route charges from', () => {
    expect(spriteTokenCost('pixel-art')).toBe(TOKEN_COSTS.sprite_generation_replicate);
    expect(spriteTokenCost('realistic')).toBe(TOKEN_COSTS.sprite_generation_dalle3);
    expect(SPRITE_TOKEN_COST.sdxl).toBe(TOKEN_COSTS.sprite_generation_replicate);
    expect(SPRITE_TOKEN_COST.dalle3).toBe(TOKEN_COSTS.sprite_generation_dalle3);
  });

  // The two windows the flat 15 got wrong, stated as balances so a regression
  // reads as the user-visible symptom rather than as an arithmetic diff.
  it.each([
    ['pixel-art' as const, 10, [10, 11, 14], [9]],
    ['realistic' as const, 20, [20, 21], [15, 19]],
  ])(
    '%s costs %i, so those balances submit and the lower ones do not',
    (style, cost, affordable, tooLow) => {
      expect(spriteTokenCost(style)).toBe(cost);
      for (const balance of affordable) {
        expect(balance >= spriteTokenCost(style), `balance ${balance}`).toBe(true);
      }
      for (const balance of tooLow) {
        expect(balance >= spriteTokenCost(style), `balance ${balance}`).toBe(false);
      }
    },
  );

  it('covers every offered style, so a new one cannot default to nothing', () => {
    for (const style of SPRITE_STYLES) {
      expect(Number.isFinite(spriteTokenCost(style)), style).toBe(true);
      expect(spriteTokenCost(style), style).toBeGreaterThan(0);
    }
  });
});
