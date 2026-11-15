/**
 * Versioned device profiles and their initial desktop budgets (#9904 subtask 1,
 * operation performance.FR-3.OP-01).
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_DEVICE_PROFILE_KEY,
  DEVICE_PROFILES,
  DEVICE_PROFILE_KEYS,
  getDeviceProfile,
  deviceProfileKey,
} from '../deviceProfiles';
import { DEFAULT_CAPTURE_PROTOCOL } from '../frameCapture';

describe('device profiles', () => {
  it('ships the desktop profile at version 1 with the issue budgets', () => {
    const desktop = getDeviceProfile('desktop@1');
    expect(desktop).not.toBeNull();
    expect(desktop?.id).toBe('desktop');
    expect(desktop?.version).toBe(1);
    expect(desktop?.budgets).toEqual([
      {
        id: 'frame-time-p95',
        metric: 'frameTimeP95Ms',
        comparison: 'lte',
        limit: 16.7,
        unit: 'ms',
        cacheState: 'any',
      },
      {
        id: 'first-interactive-cold',
        metric: 'firstInteractiveMs',
        comparison: 'lte',
        limit: 5000,
        unit: 'ms',
        cacheState: 'cold',
      },
    ]);
  });

  it('pins the 10 s warm-up / 60 s capture protocol a budget verdict requires', () => {
    expect(getDeviceProfile('desktop@1')?.protocol).toEqual(DEFAULT_CAPTURE_PROTOCOL);
  });

  it('keys every profile as id@version, so a budget change must mint a new version', () => {
    expect(DEVICE_PROFILE_KEYS.length).toBeGreaterThan(0);
    for (const key of DEVICE_PROFILE_KEYS) {
      const profile = DEVICE_PROFILES[key];
      expect(deviceProfileKey(profile)).toBe(key);
      expect(key).toMatch(/^[a-z][a-z0-9-]*@\d+$/);
    }
  });

  it('defaults to a registered profile', () => {
    expect(DEVICE_PROFILE_KEYS).toContain(DEFAULT_DEVICE_PROFILE_KEY);
  });

  it('returns null for an unregistered or inherited key instead of a prototype member', () => {
    expect(getDeviceProfile('desktop@2')).toBeNull();
    expect(getDeviceProfile('toString')).toBeNull();
    expect(getDeviceProfile('__proto__')).toBeNull();
  });

  it('freezes the registry so a caller cannot loosen a budget in place', () => {
    const desktop = getDeviceProfile('desktop@1');
    expect(Object.isFrozen(desktop)).toBe(true);
    expect(Object.isFrozen(desktop?.budgets)).toBe(true);
    expect(Object.isFrozen(desktop?.budgets[0])).toBe(true);
  });
});
