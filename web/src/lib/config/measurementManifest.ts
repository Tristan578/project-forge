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
/** Literal type for metadata the runtime cannot determine. */
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
  /**
   * Digest of the measured scene's canonical serialization
   * ({@link computeSceneFixtureChecksum}), or `'unknown'`.
   */
  fixtureChecksum: string | Unknown;
  /** Operating system family (e.g. `'macOS'`, `'Windows'`), or `'unknown'`. */
  os: string | Unknown;
  /**
   * Browser name and version: exact (`'Chrome 153.0.8010.53'`) when the caller
   * resolved it via {@link readExactBrowserVersion}, else as precise as the
   * user-agent string (`'Chrome 140'`), or `'unknown'`.
   */
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

/** One `{ brand, version }` entry of a client-hints brand list. */
export interface UaBrandVersion {
  brand: string;
  version: string;
}

/** Minimal `navigator.userAgentData` surface (Chromium client hints). */
export interface ManifestUserAgentData {
  getHighEntropyValues?: (hints: string[]) => Promise<{ fullVersionList?: UaBrandVersion[] }>;
}

/** Minimal navigator surface the manifest reads. Injectable for tests. */
export interface ManifestNavigator {
  userAgent?: string;
  deviceMemory?: number;
  gpu?: { requestAdapter: () => Promise<unknown> };
  userAgentData?: ManifestUserAgentData;
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
 * @param userAgent Browser user-agent string, if available.
 * @returns Recognized OS family or the unknown sentinel.
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
 * Order matters: Edge and Opera include Chrome tokens, so the more
 * specific tokens are matched first.
 * @param userAgent Browser user-agent string, if available.
 * @returns Recognized browser name and major version, or unknown.
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
 * @param nav Navigator surface exposing optional device memory.
 * @returns Finite positive memory estimate in GiB, or unknown.
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
 * @param nav Navigator surface to probe, or undefined when unavailable.
 * @returns WebGPU when an adapter is available, WebGL2 otherwise, or unknown without a navigator.
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
 * Chromium brand names, most specific first. Edge and Opera also report the
 * `Chromium` brand, so they must win over it; `Not;A=Brand`-style GREASE
 * entries match nothing and are skipped.
 */
const CLIENT_HINT_BRANDS: Array<[string, string]> = [
  ['Microsoft Edge', 'Edge'],
  ['Opera', 'Opera'],
  ['Google Chrome', 'Chrome'],
  ['Chromium', 'Chromium'],
];

/**
 * Resolve the browser's EXACT version where the platform exposes it.
 *
 * Chromium's reduced user-agent string freezes everything after the major
 * version (`Chrome/153.0.0.0`), so the exact build only comes from the
 * high-entropy client hint `fullVersionList`. Other browsers (and a refused
 * hint request) fall back to {@link parseBrowserVersion}, whose precision is
 * whatever the user-agent string carries. Two reports only compare as the same
 * browser when these strings are identical, so a fallback that is less precise
 * than the other side reads as a different browser — the safe direction.
 * @param nav Navigator surface, or undefined when unavailable.
 * @returns e.g. `'Chrome 153.0.8010.53'`, `'Firefox 130'`, or unknown.
 */
export async function readExactBrowserVersion(nav: ManifestNavigator | undefined): Promise<string | Unknown> {
  if (!nav) return UNKNOWN;
  try {
    const hints = await nav.userAgentData?.getHighEntropyValues?.(['fullVersionList']);
    const list = hints?.fullVersionList ?? [];
    for (const [brand, name] of CLIENT_HINT_BRANDS) {
      const entry = list.find((b) => b.brand === brand);
      if (entry && /^\d+(\.\d+)*$/.test(entry.version)) return `${name} ${entry.version}`;
    }
  } catch {
    // Client hints refused or unsupported: fall through to the UA string.
  }
  return parseBrowserVersion(nav.userAgent);
}

/** Minimal WebGL context surface {@link readGpuDriver} probes. */
export interface WebGlProbeContext {
  RENDERER: number;
  getExtension: (name: string) => unknown;
  getParameter: (param: number) => unknown;
}

function defaultWebGlProbe(): WebGlProbeContext | null {
  if (typeof document === 'undefined') return null;
  try {
    return document.createElement('canvas').getContext('webgl2') as unknown as WebGlProbeContext | null;
  } catch {
    return null;
  }
}

/**
 * Describe the GPU the measured backend runs on, as far as the browser exposes
 * it. For WebGPU this is the adapter's `GPUAdapterInfo` (description, else
 * vendor + architecture + device); for WebGL2 the unmasked renderer string.
 * Browsers do not expose a driver version, so none is claimed here: a run's
 * driver version has to be declared from the OS alongside the report.
 * @param nav Navigator surface (for `navigator.gpu`).
 * @param backend The backend the measured engine actually runs.
 * @param createWebGlContext Injectable WebGL2 probe; defaults to a throwaway canvas.
 * @returns The adapter/renderer description, or unknown.
 */
export async function readGpuDriver(
  nav: ManifestNavigator | undefined,
  backend: RenderBackend | Unknown,
  createWebGlContext: () => WebGlProbeContext | null = defaultWebGlProbe,
): Promise<string | Unknown> {
  try {
    if (backend === 'webgpu') {
      const adapter = (await nav?.gpu?.requestAdapter()) as
        | { info?: { vendor?: string; architecture?: string; device?: string; description?: string } }
        | null
        | undefined;
      const info = adapter?.info;
      if (!info) return UNKNOWN;
      const description = (info.description ?? '').trim();
      if (description) return description;
      const composed = [info.vendor, info.architecture, info.device]
        .map((part) => (part ?? '').trim())
        .filter(Boolean)
        .join(' ');
      return composed || UNKNOWN;
    }
    if (backend === 'webgl2') {
      const gl = createWebGlContext();
      if (!gl) return UNKNOWN;
      const debug = gl.getExtension('WEBGL_debug_renderer_info') as { UNMASKED_RENDERER_WEBGL: number } | null;
      const renderer = gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
      (gl.getExtension('WEBGL_lose_context') as { loseContext?: () => void } | null)?.loseContext?.();
      return typeof renderer === 'string' && renderer.trim() ? renderer.trim() : UNKNOWN;
    }
  } catch {
    // A lost device or blocked probe is "could not determine", not a GPU name.
  }
  return UNKNOWN;
}

/**
 * Compute a stable checksum for an exported scene's serialized bytes.
 *
 * Given the raw serialized bytes of an exported scene it returns a stable hex
 * digest. Given no bytes it returns {@link UNKNOWN} rather than an empty or
 * zero digest that would read as a real, comparable fixture identity. Pinned
 * fixtures and live scenes are identified through
 * {@link computeSceneFixtureChecksum}, which canonicalizes before hashing.
 *
 * Uses a synchronous djb2 variant (matching `promptCache.computeKey`'s
 * fallback) so the manifest builder stays pure and non-async.
 * @param bytes Serialized scene text or UTF-8 bytes; null/undefined means absent.
 * @returns An eight-digit noncryptographic checksum, or unknown for empty input.
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

/** Save timestamps the engine rewrites on every export of an unchanged scene. */
const VOLATILE_METADATA_KEYS = new Set(['createdAt', 'modifiedAt']);

function canonicalValue(value: unknown, path: string): unknown {
  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalValue(item, `${path}[]`));
    // Entity order follows ECS query order, which is not stable between
    // sessions; identity must not depend on it.
    if (path === 'entities') {
      const id = (item: unknown) =>
        item && typeof item === 'object' ? String((item as Record<string, unknown>).entityId ?? '') : '';
      return [...items].sort((a, b) => (id(a) < id(b) ? -1 : id(a) > id(b) ? 1 : 0));
    }
    return items;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      if (path === 'metadata' && VOLATILE_METADATA_KEYS.has(key)) continue;
      out[key] = canonicalValue((value as Record<string, unknown>)[key], path ? `${path}.${key}` : key);
    }
    return out;
  }
  return value;
}

/**
 * Canonical text of a scene for fixture identity: object keys sorted at every
 * depth, top-level `entities` ordered by `entityId`, and the volatile
 * `metadata.createdAt` / `metadata.modifiedAt` dropped.
 *
 * Hashing the file bytes directly would make identity depend on line endings
 * (a CRLF checkout), indentation, key order (the engine serializes `assets` from
 * a HashMap) and ECS iteration order — none of which change what is measured.
 * @param scene A parsed scene object.
 * @returns Minified canonical JSON.
 */
export function canonicalSceneJson(scene: unknown): string {
  return JSON.stringify(canonicalValue(scene, ''));
}

/**
 * Fixture identity of a parsed scene: {@link computeFixtureChecksum} over
 * {@link canonicalSceneJson}. The pinned 2D/3D fixtures (`lib/perf/perfFixtures.ts`)
 * and a live editor scene are identified the same way, so a capture of the
 * pinned fixture and a capture of an edited copy never share a checksum.
 * @param scene Parsed scene object; anything else is unknown.
 * @returns Eight hex digits, or unknown for a missing / non-object scene.
 */
export function computeSceneFixtureChecksum(scene: unknown): string | Unknown {
  if (!scene || typeof scene !== 'object' || Array.isArray(scene)) return UNKNOWN;
  return computeFixtureChecksum(canonicalSceneJson(scene));
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
  /**
   * Exact browser version when the caller resolved one (see
   * {@link readExactBrowserVersion}); defaults to the user-agent parse.
   */
  browserVersion?: string | Unknown;
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
 * @param options Caller-supplied metadata and optional navigator/window surfaces.
 * @returns A complete versioned manifest with explicit unknown metadata.
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
    browserVersion: options.browserVersion || parseBrowserVersion(nav?.userAgent),
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
 * @param options Manifest inputs, including an actual backend for engine captures.
 * @returns A complete manifest, probing backend capability only if no backend was supplied.
 */
export async function buildMeasurementManifestAsync(
  options: BuildManifestOptions = {},
): Promise<MeasurementManifest> {
  const nav = 'nav' in options ? options.nav : defaultNavigator();
  const backend = options.backend ?? (await detectRenderBackend(nav));
  return buildMeasurementManifest({ ...options, backend });
}
