/**
 * Capability availability declarations (#9117 / #9522).
 *
 * A capability whose provider cannot issue a key must be declared unavailable
 * in code, so every entry point — `/api/capabilities`, the generation dialogs,
 * and the generation handler — refuses it BEFORE any token is spent. Music is
 * the first: Suno has no public API, so `PLATFORM_SUNO_KEY` can never exist.
 */
import { describe, it, expect } from 'vitest';
import {
  UNAVAILABLE_CAPABILITIES,
  getCapabilityUnavailability,
  PLATFORM_KEY_CONSOLE_URL,
  PLATFORM_KEY_ENV,
  PROVIDER_CAPABILITIES,
  DIRECT_CAPABILITY_PROVIDER,
  type PlatformKeyProvider,
} from '../providers';

describe('UNAVAILABLE_CAPABILITIES', () => {
  it('declares music unavailable and points at the ElevenLabs migration issue', () => {
    const music = getCapabilityUnavailability('music');
    expect(music).not.toBeNull();
    expect(music?.issue).toBe(9522);
    expect(music?.reason).toMatch(/not available yet/i);
    // Plain product copy: no vendor names, env vars or issue numbers.
    expect(music?.reason).not.toMatch(/Suno|ElevenLabs|PLATFORM_|#\d+/);
  });

  it('returns null for a capability that is not declared unavailable', () => {
    expect(getCapabilityUnavailability('model3d')).toBeNull();
    expect(getCapabilityUnavailability('chat')).toBeNull();
  });

  it('every declared entry names a real issue number and a non-empty reason', () => {
    const entries = Object.entries(UNAVAILABLE_CAPABILITIES);
    expect(entries.length).toBeGreaterThan(0);
    for (const [cap, entry] of entries) {
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

  // #9522 acceptance: "A test asserts every PLATFORM_KEY_ENV entry maps to a
  // provider with a real, reachable key-issuing console — so the next
  // unobtainable provider fails CI instead of shipping." A provider with no
  // console is tolerated ONLY while every capability it serves is declared
  // unavailable; otherwise the product offers something nobody can provision.
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
