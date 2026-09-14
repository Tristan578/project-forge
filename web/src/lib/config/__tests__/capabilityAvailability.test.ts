/**
 * Capability availability declarations (#9117 / #9522).
 *
 * A capability whose provider cannot issue a key must be declared unavailable
 * in code, so every entry point — `/api/capabilities`, the generation dialogs,
 * and the generation handler — refuses it BEFORE any token is spent. Music was
 * the first such case (Suno had no public API); #9522 moved it to ElevenLabs,
 * so it is now offered like the sibling sfx/voice capabilities and the
 * declaration table is empty. The guard machinery stays wired so the next
 * unprovisionable capability can be declared in one line.
 */
import { describe, it, expect } from 'vitest';
import {
  UNAVAILABLE_CAPABILITIES,
  getCapabilityUnavailability,
  PLATFORM_KEY_CONSOLE_URL,
  PLATFORM_KEY_ENV,
  PROVIDER_CAPABILITIES,
  DIRECT_CAPABILITY_PROVIDER,
  DB_PROVIDER,
  type PlatformKeyProvider,
} from '../providers';

describe('UNAVAILABLE_CAPABILITIES', () => {
  it('no longer declares music unavailable — it resolves to ElevenLabs (#9522)', () => {
    expect(getCapabilityUnavailability('music')).toBeNull();
    expect(DIRECT_CAPABILITY_PROVIDER.music).toBe('elevenlabs');
    expect(DB_PROVIDER.music).toBe('elevenlabs');
  });

  it('returns null for a capability that is not declared unavailable', () => {
    expect(getCapabilityUnavailability('model3d')).toBeNull();
    expect(getCapabilityUnavailability('chat')).toBeNull();
  });

  it('every declared entry (if any) names a real issue number and a non-empty reason', () => {
    // The table is empty today; this pins the SHAPE so a future entry cannot be
    // added malformed. It never reads as coverage — the count may legitimately
    // be zero — so it asserts per-entry rather than requiring entries to exist.
    for (const [cap, entry] of Object.entries(UNAVAILABLE_CAPABILITIES)) {
      expect(PROVIDER_CAPABILITIES).toContain(cap);
      expect(entry?.issue).toBeGreaterThan(0);
      expect(entry?.reason.trim().length).toBeGreaterThan(20);
    }
  });
});

describe('PLATFORM_KEY_CONSOLE_URL', () => {
  it('has one row per PLATFORM_KEY_ENV provider', () => {
    expect(Object.keys(PLATFORM_KEY_CONSOLE_URL).sort()).toEqual(
      Object.keys(PLATFORM_KEY_ENV).sort(),
    );
  });

  it('every console URL is https on the vendor domain', () => {
    for (const [provider, url] of Object.entries(PLATFORM_KEY_CONSOLE_URL)) {
      if (url === null) continue;
      expect(url, provider).toMatch(/^https:\/\/[a-z0-9.-]+\//);
    }
  });

  it('no PLATFORM_KEY_ENV provider maps to Suno (its key env was removed, #9522)', () => {
    expect(Object.keys(PLATFORM_KEY_ENV)).not.toContain('suno');
    expect(Object.keys(PLATFORM_KEY_CONSOLE_URL)).not.toContain('suno');
  });

  // #9522 acceptance: "A test asserts every PLATFORM_KEY_ENV entry maps to a
  // provider with a real, reachable key-issuing console — so the next
  // unobtainable provider fails CI instead of shipping." A provider with no
  // console is tolerated ONLY while every capability it serves is declared
  // unavailable; otherwise the product offers something nobody can provision.
  // With Suno gone there is no console-less provider today, so this guard
  // passes vacuously — but it must still fire if one is reintroduced.
  it('a provider with no key console cannot serve an offered capability', () => {
    const consoleless = (Object.keys(PLATFORM_KEY_CONSOLE_URL) as PlatformKeyProvider[]).filter(
      (p) => PLATFORM_KEY_CONSOLE_URL[p] === null,
    );
    for (const provider of consoleless) {
      const served = PROVIDER_CAPABILITIES.filter(
        (cap) => (DIRECT_CAPABILITY_PROVIDER[cap] as string) === provider,
      );
      for (const cap of served) {
        expect(
          getCapabilityUnavailability(cap),
          `${cap} is served by ${provider}, which has no key console, but is not declared unavailable`,
        ).not.toBeNull();
      }
    }
  });
});
