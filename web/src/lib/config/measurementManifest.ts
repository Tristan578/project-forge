/**
 * Versioned performance-measurement manifest.
 *
 * Operation: `performance.FR-3.OP-01` (issue #9904, program #9773).
 *
 * A measurement is only trustworthy if you know the machine and build it was
 * taken on. This manifest pins that identity alongside every captured
 * performance report: build SHA, fixture checksum, OS, exact browser version,
 * GPU/driver, render backend, viewport, device memory, warm/cold cache state
 * and sample count.
 *
 * ## The `unknown` invariant
 *
 * Every field that the browser may fail to expose is typed to allow an explicit
 * {@link UNKNOWN} sentinel. A field the runtime cannot determine MUST resolve to
 * `'unknown'` — never to `0`, `false`, an empty string, or any other value that
 * would read as a real, comparable measurement. A `deviceMemory` of `0` or a
 * `backend` of `''` silently reads as "measured and it was zero"; `'unknown'`
 * reads as "we could not measure this", which is the honest and comparable
 * state. This is the single most important property of the schema and is the
 * subject of the negative-case acceptance scenario in #9904.
 */

/** Current manifest schema version. Bump on any breaking field change. */
export const MEASUREMENT_MANIFEST_SCHEMA_VERSION = 1;

/** Sentinel for any field the runtime cannot determine. Never substitute 0/false/''. */
export const UNKNOWN = 'unknown' as const;
export type Unknown = typeof UNKNOWN;

/** Render backend the engine actually runs on. */
export type RenderBackend = 'webgpu' | 'webgl2';

/** Whether the measured run started from a warm or cold asset cache. */
export type CacheState = 'warm' | 'cold';

/** Viewport the measurement was taken at. */
export interface ManifestViewport {
  width: number;
  height: number;
  devicePixelRatio: number;
}

/**
 * A versioned snapshot of the machine + build a performance measurement was
 * taken on. Attached to every captured report so two reports can be compared
 * only when their identity matches (see the boundary acceptance scenario).
 */
export interface MeasurementManifest {
  /** Schema version — always a concrete number, never unknown. */
  schemaVersion: number;
  /** Git commit SHA of the build under test, or `'unknown'`. */
  buildSha: string | Unknown;
  /** Stable digest of the exported fixture's serialized bytes, or `'unknown'`. */
  fixtureChecksum: string | Unknown;
  /** Operating system family (e.g. `'macOS'`, `'Windows'`), or `'unknown'`. */
  os: string | Unknown;
  /** Exact browser name + major version (e.g. `'Chrome 140'`), or `'unknown'`. */
  browserVersion: string | Unknown;
  /** GPU/driver string when the platform exposes it, else `'unknown'`. */
  gpuDriver: string | Unknown;
  /** Render backend actually selected, or `'unknown'` off-navigator. */
  backend: RenderBackend | Unknown;
  /** Viewport the run was captured at, or `'unknown'` off-window. */
  viewport: ManifestViewport | Unknown;
  /** `navigator.deviceMemory` in GiB when exposed (>0), else `'unknown'`. */
  deviceMemory: number | Unknown;
  /** Warm/cold cache state of the measured run, or `'unknown'` when not declared. */
  cacheState: CacheState | Unknown;
  /** Number of raw samples the report was aggregated from, or `'unknown'`. */
  sampleCount: number | Unknown;
}

/** Minimal navigator surface the manifest reads. Injectable for tests. */
export interface ManifestNavigator {
  userAgent?: string;
  deviceMemory?: number;
  gpu?: { requestAdapter: () => Promise<unknown> };
}

/** Minimal window surface the manifest reads. Injectable for tests. */
export interface ManifestWindow {
  innerWidth: number;
  innerHeight: number;
  devicePixelRatio: number;
}

/**
 * Parse an OS family out of a user-agent string.
 * Returns {@link UNKNOWN} when the string is absent or unrecognized — never a guess.
 */
export function parseOs(userAgent: string | undefined): string | Unknown {
  if (!userAgent) return UNKNOWN;
  if (/windows nt/i.test(userAgent)) return 'Windows';
  // iPadOS reports as Macintosh; check touch-bearing iPad UA before macOS.
  if (/iphone|ipad|ipod/i.test(userAgent)) return 'iOS';
  if (/android/i.test(userAgent)) return 'Android';
  if (/mac os x|macintosh/i.test(userAgent)) return 'macOS';
  if (/cros/i.test(userAgent)) return 'ChromeOS';
  if (/linux/i.test(userAgent)) return 'Linux';
  return UNKNOWN;
}

/**
 * Parse a browser name + major version out of a user-agent string.
 * Returns {@link UNKNOWN} when the string is absent or unrecognized.
 *
 * Order matters: Edge and Brave/Opera masquerade as Chrome, so the more
 * specific tokens are matched first.
 */
export function parseBrowserVersion(userAgent: string | undefined): string | Unknown {
  if (!userAgent) return UNKNOWN;
  const patterns: Array<[RegExp, string]> = [
    [/Edg\/(\d+)/, 'Edge'],
    [/OPR\/(\d+)/, 'Opera'],
    [/Firefox\/(\d+)/, 'Firefox'],
    [/Chrome\/(\d+)/, 'Chrome'],
    // Safari carries a Version/ token ahead of the Safari/ build token; other
    // UA parts (e.g. "Mobile/15E148") may sit between them, so match loosely.
    [/Version\/(\d+)[.\d]*.*Safari/, 'Safari'],
  ];
  for (const [re, name] of patterns) {
    const match = re.exec(userAgent);
    if (match && match[1]) return `${name} ${match[1]}`;
  }
  return UNKNOWN;
}

/**
 * Read `navigator.deviceMemory` as an approximate device-memory figure in GiB.
 * Returns {@link UNKNOWN} unless the value is a finite, positive number — a
 * missing API must not read as `0` GiB of RAM.
 */
export function readDeviceMemory(nav: ManifestNavigator | undefined): number | Unknown {
  const dm = nav?.deviceMemory;
  return typeof dm === 'number' && Number.isFinite(dm) && dm > 0 ? dm : UNKNOWN;
}

/**
 * Probe which backend the browser can support.
 *
 * This probe cannot report the initialized editor backend: user preferences
 * and engine loading failures can select WebGL2 even with an available adapter.
 * Captures must pass the engine's selected backend explicitly.
 * Off-navigator (SSR, tests without a DOM) it returns {@link UNKNOWN} because we
 * genuinely cannot know, rather than defaulting to a backend that may be wrong.
 *
 * `nav` is required (pass {@link defaultNavigator}'s result for the global):
 * an explicit `undefined` models "no navigator" and yields `'unknown'`, which a
 * default parameter could not distinguish from "argument omitted".
 */
export async function detectRenderBackend(
  nav: ManifestNavigator | undefined,
): Promise<RenderBackend | Unknown> {
  if (!nav) return UNKNOWN;
  if (!nav.gpu) return 'webgl2';
  try {
    const adapter = await nav.gpu.requestAdapter();
    return adapter ? 'webgpu' : 'webgl2';
  } catch {
    return 'webgl2';
  }
}

/**
 * Compute a stable checksum for an exported scene's serialized bytes.
 *
 * NOTE: the 2D/3D exported **fixture files** themselves are OUT OF SCOPE for
 * this slice — they are owned by the fixture-harness child issue. This helper
 * only defines the checksum contract so that harness can adopt it without a
 * schema change: given the raw serialized bytes of an exported scene it returns
 * a stable hex digest. Given no bytes it returns {@link UNKNOWN} rather than an
 * empty or zero digest that would read as a real, comparable fixture identity.
 *
 * Uses a synchronous djb2 variant (matching `promptCache.computeKey`'s
 * fallback) so the manifest builder stays pure and non-async.
 */
export function computeFixtureChecksum(
  bytes: string | Uint8Array | null | undefined,
): string | Unknown {
  if (bytes == null) return UNKNOWN;
  const source = typeof bytes === 'string' ? bytes : new TextDecoder().decode(bytes);
  if (source.length === 0) return UNKNOWN;
  let h = 5381;
  for (let i = 0; i < source.length; i++) {
    h = ((h << 5) + h) ^ source.charCodeAt(i);
    h = h >>> 0; // keep unsigned 32-bit
  }
  return h.toString(16).padStart(8, '0');
}

/** Inputs the caller resolves out-of-band (async or run-specific). */
export interface BuildManifestOptions {
  /** Resolved render backend (see {@link detectRenderBackend}). */
  backend?: RenderBackend | Unknown;
  /** Fixture checksum (see {@link computeFixtureChecksum}). */
  fixtureChecksum?: string | Unknown;
  /** Warm/cold cache state of the run, if the caller knows it. */
  cacheState?: CacheState | Unknown;
  /** Number of raw samples aggregated into the report. */
  sampleCount?: number | Unknown;
  /** Build SHA; defaults to the app's compiled-in commit. */
  buildSha?: string | Unknown;
  /** GPU/driver string when the caller can obtain one. */
  gpuDriver?: string | Unknown;
  /** Injectable navigator (defaults to the global). */
  nav?: ManifestNavigator;
  /** Injectable window (defaults to the global). */
  win?: ManifestWindow;
}

function defaultNavigator(): ManifestNavigator | undefined {
  return typeof navigator !== 'undefined' ? (navigator as ManifestNavigator) : undefined;
}

function defaultWindow(): ManifestWindow | undefined {
  return typeof window !== 'undefined'
    ? {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
      }
    : undefined;
}

function readViewport(win: ManifestWindow | undefined): ManifestViewport | Unknown {
  if (!win) return UNKNOWN;
  const { innerWidth, innerHeight, devicePixelRatio } = win;
  if (!Number.isFinite(innerWidth) || !Number.isFinite(innerHeight)) return UNKNOWN;
  return {
    width: innerWidth,
    height: innerHeight,
    devicePixelRatio: Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1,
  };
}

/**
 * Pure constructor: build a {@link MeasurementManifest} from the runtime
 * environment plus any caller-resolved inputs. Every field the browser does not
 * expose resolves to {@link UNKNOWN}; nothing is silently defaulted to zero.
 *
 * `backend`, `fixtureChecksum` and `cacheState` are resolved by the caller
 * (backend detection is async; the others are run-specific) — when omitted they
 * are recorded as `'unknown'` rather than assumed.
 */
export function buildMeasurementManifest(options: BuildManifestOptions = {}): MeasurementManifest {
  // `'nav' in options` (not `?? default`) lets a caller pass `undefined`
  // explicitly to model an SSR / no-DOM environment, distinct from "not provided".
  const nav = 'nav' in options ? options.nav : defaultNavigator();
  const win = 'win' in options ? options.win : defaultWindow();

  // Next.js only exposes public environment variables in browser bundles.
  // Keep local or unidentified builds explicit instead of reporting 'local' as a SHA.
  const rawBuildSha = options.buildSha ?? process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? UNKNOWN;
  const buildSha = rawBuildSha === '' ? UNKNOWN : rawBuildSha;

  return {
    schemaVersion: MEASUREMENT_MANIFEST_SCHEMA_VERSION,
    buildSha,
    fixtureChecksum: options.fixtureChecksum ?? UNKNOWN,
    os: parseOs(nav?.userAgent),
    browserVersion: parseBrowserVersion(nav?.userAgent),
    gpuDriver: options.gpuDriver ?? UNKNOWN,
    backend: options.backend ?? UNKNOWN,
    viewport: readViewport(win),
    deviceMemory: readDeviceMemory(nav),
    cacheState: options.cacheState ?? UNKNOWN,
    sampleCount:
      typeof options.sampleCount === 'number'
        ? Number.isFinite(options.sampleCount)
          ? options.sampleCount
          : UNKNOWN
        : (options.sampleCount ?? UNKNOWN),
  };
}

/**
 * Convenience async wrapper: resolve the render backend, then build the
 * manifest. Callers capturing a running engine must provide its actual backend
 * (or explicit 'unknown') to avoid substituting capability for observed state.
 */
export async function buildMeasurementManifestAsync(
  options: BuildManifestOptions = {},
): Promise<MeasurementManifest> {
  const nav = 'nav' in options ? options.nav : defaultNavigator();
  const backend = options.backend ?? (await detectRenderBackend(nav));
  return buildMeasurementManifest({ ...options, backend });
}
