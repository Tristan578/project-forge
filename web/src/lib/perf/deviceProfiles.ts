/**
 * Versioned device profiles: the budget class a performance report is judged
 * against (#9904 subtask 1, operation performance.FR-3.OP-01).
 *
 * A profile does NOT describe the machine a run happened on — that is the
 * {@link MeasurementManifest} (OS, browser, GPU, backend, viewport) recorded
 * with every report. A profile is the promise: "on this class of device, the
 * pinned fixture must meet these numbers under this capture protocol".
 *
 * Profiles are keyed `id@version` and frozen. Changing a limit or the protocol
 * means adding `desktop@2`, never editing `desktop@1`, so a report that names
 * `desktop@1` keeps meaning what it meant when it was captured.
 *
 * The native target profiles (#9913–#9920) reuse this shape with their own
 * hardware and numbers; this module only pins the first web desktop profile.
 */
import { DEFAULT_CAPTURE_PROTOCOL, type CaptureProtocol } from './frameCapture';

/** Metrics a budget can constrain. */
export type BudgetMetric = 'frameTimeP95Ms' | 'firstInteractiveMs';

/** One numeric budget inside a profile. */
export interface BudgetDefinition {
  /** Stable id used in reports and comparisons. */
  id: string;
  metric: BudgetMetric;
  /** Only "less than or equal" budgets exist today. */
  comparison: 'lte';
  limit: number;
  unit: 'ms';
  /**
   * Which runs the budget applies to. `'cold'` budgets are only evaluated on a
   * run whose cache state is established as cold; `'any'` applies to all.
   */
  cacheState: 'any' | 'cold';
}

/** A versioned budget class. */
export interface DeviceProfile {
  id: string;
  version: number;
  label: string;
  deviceClass: 'desktop';
  description: string;
  /** The capture protocol a budget verdict requires. */
  protocol: CaptureProtocol;
  budgets: readonly BudgetDefinition[];
}

function freezeProfile(profile: DeviceProfile): Readonly<DeviceProfile> {
  return Object.freeze({
    ...profile,
    protocol: Object.freeze({ ...profile.protocol }),
    budgets: Object.freeze(profile.budgets.map((b) => Object.freeze({ ...b }))),
  });
}

/** `id@version` key for a profile. */
export function deviceProfileKey(profile: Pick<DeviceProfile, 'id' | 'version'>): string {
  return `${profile.id}@${profile.version}`;
}

/**
 * The initial desktop profile. Limits come from the issue: p95 frame time at
 * most 16.7 ms (60 fps), and a cold-cache first-interactive time at most 5 s
 * for the selected fixture.
 */
const DESKTOP_V1 = freezeProfile({
  id: 'desktop',
  version: 1,
  label: 'Desktop (v1)',
  deviceClass: 'desktop',
  description:
    'Initial web desktop budget class: p95 frame time <= 16.7 ms over a 60 s capture after a 10 s warm-up, and cold-cache first interactive <= 5 s.',
  protocol: { ...DEFAULT_CAPTURE_PROTOCOL },
  budgets: [
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
  ],
});

/** Every registered profile, keyed `id@version`. */
export const DEVICE_PROFILES: Readonly<Record<string, Readonly<DeviceProfile>>> = Object.freeze({
  [deviceProfileKey(DESKTOP_V1)]: DESKTOP_V1,
});

/** Registered profile keys, for schema enums and UI selectors. */
export const DEVICE_PROFILE_KEYS = Object.freeze(Object.keys(DEVICE_PROFILES)) as readonly string[];

/** Profile used when a capture does not name one. */
export const DEFAULT_DEVICE_PROFILE_KEY = 'desktop@1';

/**
 * Look up a profile without walking the prototype chain, so a model-supplied
 * `'toString'` cannot resolve to a function.
 * @param key `id@version`.
 * @returns The frozen profile, or null when the key is not registered.
 */
export function getDeviceProfile(key: string): Readonly<DeviceProfile> | null {
  return Object.prototype.hasOwnProperty.call(DEVICE_PROFILES, key) ? DEVICE_PROFILES[key] : null;
}
