import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { E2E_PERF_CAPTURE_SLACK_MS } from '../constants';
import { EDITOR_PACKAGES, RUNTIME_PACKAGES, startPerfCaptureServer, type PerfCaptureServer } from './perfCaptureServer';
import { generateGameHTML } from '@/lib/export/gameTemplate';
import { PERF_FIXTURES } from '@/lib/perf/perfFixtures';
import { PERF_FIXTURE_FILES } from '@/lib/perf/fixtures/fixtureScenes';
import { DEFAULT_DEVICE_PROFILE_KEY } from '@/lib/perf/deviceProfiles';
import { DEFAULT_CAPTURE_PROTOCOL } from '@/lib/perf/frameCapture';
import { buildExportedRunReport } from '@/lib/perf/exportedCapture';
import { serializeReport, type PerformanceReport } from '@/lib/perf/performanceReport';
import { UNKNOWN } from '@/lib/config/measurementManifest';

/**
 * #9904 / #10013 (operation performance.FR-3.OP-01) — the pinned 2D and 3D
 * fixtures, exported through the REAL single-HTML export template and run on
 * the REAL runtime engine in a GPU-backed browser, captured by the exported
 * runtime's own harness (10 s warm-up, 60 s capture), and reported with the
 * same code as the editor capture. This is the real-hardware evidence the
 * mocked unit suites cannot provide.
 *
 * LOCAL ONLY, and only under `playwright.perf.config.ts` (tag `@perf-gpu`):
 * it needs the runtime engine packages in `web/public/engine-pkg-*-runtime/`
 * (build them with build_wasm.ps1 / build_wasm.sh) and a real GPU. CI runners
 * have neither, so no CI job selects this tag. Every other config that matches
 * `**\/*.spec.ts` skips it with that reason stated.
 *
 *   cd web && npx playwright test --config=playwright.perf.config.ts
 *
 * Environment (all optional):
 *   PERF_RUNS=5            runs per fixture
 *   PERF_FIXTURES=perf-3d@1,perf-2d@1
 *   PERF_PROFILE=desktop@1
 *   PERF_CACHE=cold|warm   cold: fresh browser context per run; warm: primed first
 *   PERF_CPU_THROTTLE=20   CDP CPU throttling (the deliberately failing budget)
 *   PERF_EXPECT_VERDICT=fail|pass  assert the verdict of every run
 *   PERF_BACKEND=webgl2    hide navigator.gpu so the WebGL2 runtime loads
 *   PERF_ENGINE=editor     serve only the editor engine packages, so the export
 *                          template falls back to them (the binary /play loads)
 *   PERF_VSYNC=1           pace frames to the display (config flag; default uncapped)
 *   PERF_WARMUP_MS / PERF_CAPTURE_MS  shortened smoke runs (budgets then read unknown)
 *   PERF_OUT_DIR           where reports go (default test-results/perf-evidence/<stamp>)
 *   PERF_ALLOW_DIRTY=1     run from an uncommitted tree (build SHA recorded as unknown)
 */

const ARMED = process.env.FORGE_PERF_CAPTURE_CONFIG === '1';
const WEB_DIR = path.resolve(__dirname, '..', '..');
const REPO_DIR = path.resolve(WEB_DIR, '..');
const PUBLIC_DIR = path.join(WEB_DIR, 'public');
const FIXTURE_DIR = path.join(WEB_DIR, 'src', 'lib', 'perf', 'fixtures');

function envInt(name: string, fallback: number, min: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) throw new Error(`${name} must be an integer >= ${min}, got ${raw}`);
  return n;
}

const RUNS = envInt('PERF_RUNS', 5, 1);
const PROFILE = process.env.PERF_PROFILE || DEFAULT_DEVICE_PROFILE_KEY;
const CACHE: 'cold' | 'warm' = process.env.PERF_CACHE === 'warm' ? 'warm' : 'cold';
const CPU_THROTTLE = envInt('PERF_CPU_THROTTLE', 1, 1);
const EXPECT_VERDICT = process.env.PERF_EXPECT_VERDICT;
const FORCE_WEBGL2 = process.env.PERF_BACKEND === 'webgl2';
const ENGINE: 'runtime' | 'editor' = process.env.PERF_ENGINE === 'editor' ? 'editor' : 'runtime';
const PACKAGES: readonly string[] = ENGINE === 'editor' ? EDITOR_PACKAGES : RUNTIME_PACKAGES;
const PROTOCOL = {
  warmupMs: envInt('PERF_WARMUP_MS', DEFAULT_CAPTURE_PROTOCOL.warmupMs, 0),
  captureMs: envInt('PERF_CAPTURE_MS', DEFAULT_CAPTURE_PROTOCOL.captureMs, 1000),
};
const FIXTURE_IDS = (process.env.PERF_FIXTURES || PERF_FIXTURES.map((f) => f.id).join(','))
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const OUT_DIR = process.env.PERF_OUT_DIR
  ? path.resolve(process.env.PERF_OUT_DIR)
  : path.join(WEB_DIR, 'test-results', 'perf-evidence', STAMP);
const VIEWPORT = { width: 1280, height: 720 };
/** Rendered region checked for content: everything above the "Made with" badge. */
const RENDER_CLIP = { x: 0, y: 0, width: VIEWPORT.width, height: 600 };
/**
 * A rendered fixture shows many colours; the default scene an exporter falls
 * back to when the fixture is refused is a near-flat clear colour.
 */
const MIN_DISTINCT_COLOURS = 24;

interface SummaryRow {
  fixture: string;
  run: number;
  file: string;
  verdict: PerformanceReport['verdict'];
  cacheState: string;
  backend: string;
  sampleCount: number;
  p50Ms: number | string;
  p95Ms: number | string;
  p99Ms: number | string;
  firstInteractiveMs: number | string;
  distinctColours: number;
  budgets: Record<string, string>;
}

const rows: SummaryRow[] = [];

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: REPO_DIR, encoding: 'utf8' }).trim();
}

function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

/** Count distinct 4-bit-per-channel colours in a screenshot, decoded by the browser. */
async function distinctColours(page: Page): Promise<number> {
  const png = await page.screenshot({ type: 'png', clip: RENDER_CLIP });
  return page.evaluate(async (b64: string) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 75;
    const ctx = canvas.getContext('2d');
    if (!ctx) return 0;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const seen = new Set<number>();
    for (let i = 0; i < data.length; i += 4) seen.add(((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4));
    return seen.size;
  }, png.toString('base64'));
}

test.describe('Exported fixture performance capture @perf-gpu', () => {
  test.skip(!ARMED, 'Runs only under playwright.perf.config.ts: needs the local runtime engine build and a real GPU (#10013).');
  test.describe.configure({ timeout: PROTOCOL.warmupMs + PROTOCOL.captureMs + E2E_PERF_CAPTURE_SLACK_MS * (CACHE === 'warm' ? 2 : 1) });

  let server: PerfCaptureServer;
  let buildSha: string;

  test.beforeAll(async ({ browser }, testInfo) => {
    const pkg = PACKAGES[FORCE_WEBGL2 ? 1 : 0];
    const wasm = path.join(PUBLIC_DIR, pkg, 'forge_engine_bg.wasm');
    // Not a skip: without the engine there is nothing to measure, and a green
    // "skipped" would read as evidence (lessons-learned #9).
    if (!existsSync(wasm)) throw new Error(`Missing ${wasm}. Build the runtime engine first (build_wasm.ps1 / build_wasm.sh).`);
    for (const id of FIXTURE_IDS) {
      if (!PERF_FIXTURES.some((f) => f.id === id)) throw new Error(`Unknown fixture ${id}`);
    }

    const head = git(['rev-parse', 'HEAD']);
    const dirty = git(['status', '--porcelain', '--untracked-files=no', '--', 'web/src', 'web/e2e', 'engine']);
    if (dirty && process.env.PERF_ALLOW_DIRTY !== '1') {
      throw new Error(`Evidence must come from a committed tree; uncommitted changes:\n${dirty}`);
    }
    buildSha = dirty ? UNKNOWN : head;

    mkdirSync(OUT_DIR, { recursive: true });
    const gpuFromOs = (() => {
      if (process.platform !== 'win32') return null;
      try {
        return execFileSync('powershell', ['-NoProfile', '-Command', 'Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion | ConvertTo-Json -Compress'], { encoding: 'utf8' }).trim();
      } catch {
        return null;
      }
    })();
    writeFileSync(
      path.join(OUT_DIR, 'run-environment.json'),
      `${JSON.stringify(
        {
          operationId: 'performance.FR-3.OP-01',
          capturedAt: new Date().toISOString(),
          gitHead: head,
          buildSha,
          engineTree: git(['rev-parse', 'HEAD:engine']),
          enginePackage: { name: pkg, variant: ENGINE, wasmBytes: readFileSync(wasm).length, wasmSha256: sha256(wasm) },
          browser: {
            name: browser.browserType().name(),
            version: browser.version(),
            channel: testInfo.project.use.channel ?? null,
            headless: testInfo.project.use.headless ?? null,
            launchArgs: testInfo.project.use.launchOptions?.args ?? [],
            vsync: process.env.PERF_VSYNC === '1' ? 'on (display-paced)' : 'off (uncapped: --disable-gpu-vsync --disable-frame-rate-limit)',
          },
          os: { platform: process.platform, release: os.release(), cpus: os.cpus()[0]?.model, cpuCount: os.cpus().length, totalMemGb: Math.round(os.totalmem() / 2 ** 30) },
          gpuFromOs,
          protocol: PROTOCOL,
          profile: PROFILE,
          cache: CACHE,
          cpuThrottle: CPU_THROTTLE,
          forcedBackend: FORCE_WEBGL2 ? 'webgl2' : null,
          viewport: VIEWPORT,
          deltaFromProduction: [
            'engine served over loopback, not the CDN: no network latency or bandwidth limit in the cold first-interactive time',
            'engine binary served uncompressed; production negotiates brotli',
            'Chrome launched by Playwright with GPU flags (see playwright.perf.config.ts), not a user profile',
          ],
        },
        null,
        2,
      )}\n`,
    );
    server = await startPerfCaptureServer(PUBLIC_DIR, PACKAGES);
  });

  test.afterAll(async () => {
    await server?.close();
    if (rows.length > 0) writeFileSync(path.join(OUT_DIR, 'summary.json'), `${JSON.stringify(rows, null, 2)}\n`);
  });

  for (const fixtureId of FIXTURE_IDS) {
    for (let run = 1; run <= RUNS; run++) {
      test(`${fixtureId} run ${run}/${RUNS} (${CACHE}${CPU_THROTTLE > 1 ? `, CPU x${CPU_THROTTLE}` : ''})`, async ({ browser }) => {
        const fixture = PERF_FIXTURES.find((f) => f.id === fixtureId)!;
        const scene = JSON.parse(readFileSync(path.join(FIXTURE_DIR, PERF_FIXTURE_FILES[fixtureId]), 'utf8')) as unknown;
        server.setPage(
          generateGameHTML({
            title: `Perf fixture ${fixtureId}`,
            bgColor: '#101014',
            resolution: 'responsive',
            sceneData: JSON.stringify(scene),
            scriptBundle: '',
            includeDebug: false,
            // What exportGame passes from the editor's project type.
            projectType: fixture.dimension,
          }),
        );

        const context = await browser.newContext({ viewport: VIEWPORT });
        if (FORCE_WEBGL2) {
          await context.addInitScript(() => {
            Object.defineProperty(Navigator.prototype, 'gpu', { get: () => undefined, configurable: true });
          });
        }
        const page = await context.newPage();
        const pageErrors: string[] = [];
        page.on('pageerror', (e) => pageErrors.push(e.message));
        const query = `forgePerf=1&forgePerfWarmupMs=${PROTOCOL.warmupMs}&forgePerfCaptureMs=${PROTOCOL.captureMs}`;
        const waitFor = PROTOCOL.warmupMs + PROTOCOL.captureMs + E2E_PERF_CAPTURE_SLACK_MS;

        try {
          if (CACHE === 'warm') {
            // Prime the HTTP cache with one full load in this context, then measure a reload.
            await page.goto(`${server.origin}/index.html?${query}`);
            await page.mouse.click(VIEWPORT.width / 2, VIEWPORT.height / 2);
            await page.waitForFunction(() => {
              const s = (window as unknown as { __forgePerf?: { sceneLoad: unknown; status: string } }).__forgePerf;
              return !!s && (s.sceneLoad !== null || s.status === 'failed');
            }, null, { timeout: waitFor });
          }
          if (CPU_THROTTLE > 1) {
            const cdp = await context.newCDPSession(page);
            await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });
          }

          await page.goto(`${server.origin}/index.html?${query}`);
          await page.mouse.click(VIEWPORT.width / 2, VIEWPORT.height / 2);
          await page.waitForFunction(
            () => {
              const s = (window as unknown as { __forgePerf?: { status: string } }).__forgePerf;
              return !!s && (s.status === 'complete' || s.status === 'failed');
            },
            null,
            { timeout: waitFor, polling: 1000 },
          );

          const harness = await page.evaluate(() => (window as unknown as { __forgePerf?: unknown }).__forgePerf);
          const colours = await distinctColours(page);
          if (run === 1) await page.screenshot({ path: path.join(OUT_DIR, `${fixtureId.replace('@', '-v')}-${CACHE}.png`) });

          const result = await buildExportedRunReport({
            harness,
            fixtureScene: scene,
            profileKey: PROFILE,
            buildSha,
            // A fresh browser context has an empty HTTP cache: cold by construction.
            declaredCacheState: CACHE === 'cold' ? 'cold' : undefined,
          });
          expect(result.ok, result.ok ? '' : `${result.error}\npage errors: ${pageErrors.join(' | ')}`).toBe(true);
          if (!result.ok) return;
          const report = result.report;
          const file = `${fixtureId.replace('@', '-v')}-${CACHE}${CPU_THROTTLE > 1 ? `-cpu${CPU_THROTTLE}x` : ''}-run${run}.json`;
          writeFileSync(path.join(OUT_DIR, file), serializeReport(report));

          const f = report.aggregates.frameTime;
          rows.push({
            fixture: fixtureId,
            run,
            file,
            verdict: report.verdict,
            cacheState: String(report.manifest.cacheState),
            backend: String(report.manifest.backend),
            sampleCount: f.sampleCount,
            p50Ms: f.p50Ms,
            p95Ms: f.p95Ms,
            p99Ms: f.p99Ms,
            firstInteractiveMs: report.aggregates.firstInteractiveMs,
            distinctColours: colours,
            budgets: Object.fromEntries(report.budgets.map((b) => [b.id, `${b.status} (observed ${b.observed}, limit ${b.limit})`])),
          });

          // The run measured THIS fixture, on the backend it was meant to, with a real window of frames.
          expect(report.fixture).toEqual({ id: fixture.id, checksum: fixture.checksum });
          expect(report.manifest.backend).toBe(FORCE_WEBGL2 ? 'webgl2' : 'webgpu');
          expect(report.aggregates.frameTime.status).toBe('measured');
          expect(report.capture.hiddenDuringCapture).toBe(false);
          // And the fixture is on screen, not the default scene.
          expect(colours).toBeGreaterThanOrEqual(MIN_DISTINCT_COLOURS);
          if (EXPECT_VERDICT) expect(report.verdict).toBe(EXPECT_VERDICT);
        } finally {
          await context.close();
        }
      });
    }
  }
});
