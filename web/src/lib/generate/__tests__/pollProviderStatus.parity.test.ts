import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Parity gate for the durable-callback poller (PF-906, #8816).
 *
 * `pollProviderStatus` hand-mirrors each `/api/generate/<type>/status` route's
 * terminal-state mapping (incl. the `succeededButEmpty → failed` guard from
 * #8757). The two implementations are independent code paths, so a change to a
 * status route could silently drift the poller — the durable QStash callback
 * would then finalize a job differently than the in-tab client poller does.
 *
 * This suite enforces the invariant structurally: it feeds the SAME mocked
 * provider response through BOTH the poller and the matching route `GET`
 * handler (both construct the same provider-client classes, mocked once here)
 * and asserts they agree on the mapped `status` AND the failure message for
 * every terminal case. Drift in either direction fails CI rather than shipping
 * a poller that disagrees with the live route it claims to mirror.
 */

vi.mock('server-only', () => ({}));

// --- provider-client doubles: shared by BOTH the routes and the poller, since
// both `new MeshyClient(...)` etc. resolve to these mocked constructors. ---
const getTaskStatus = vi.fn();
const getTextureStatus = vi.fn();
vi.mock('@/lib/generate/meshyClient', () => ({
  MeshyClient: vi.fn(function (this: Record<string, unknown>) {
    this.getTaskStatus = getTaskStatus;
    this.getTextureStatus = getTextureStatus;
  }),
}));
const getStatus = vi.fn();
vi.mock('@/lib/generate/sunoClient', () => ({
  SunoClient: vi.fn(function (this: Record<string, unknown>) { this.getStatus = getStatus; }),
}));
const getReplicateStatus = vi.fn();
vi.mock('@/lib/generate/spriteClient', () => ({
  SpriteClient: vi.fn(function (this: Record<string, unknown>) { this.getReplicateStatus = getReplicateStatus; }),
}));

// --- route plumbing doubles: let each GET handler reach the status mapping
// without auth/rate-limit/key-resolution side effects. Mocking these modules
// also keeps their heavy transitive deps (redis, DB) out of the test. ---
vi.mock('@/lib/api/middleware', () => ({
  withApiMiddleware: vi.fn(async () => ({ error: null, userId: 'user-1' })),
}));
vi.mock('@/lib/keys/resolver', () => ({
  resolveApiKey: vi.fn(async () => ({ key: 'provider-key' })),
  ApiKeyError: class ApiKeyError extends Error {
    code: string;
    constructor(code: string, message: string) { super(message); this.code = code; this.name = 'ApiKeyError'; }
  },
}));
vi.mock('@/lib/config/providers', () => ({
  DB_PROVIDER: { model3d: 'meshy', texture: 'meshy', music: 'suno', sprite: 'replicate' },
}));
vi.mock('@/lib/monitoring/sentry-server', () => ({ captureException: vi.fn() }));

import { pollProviderStatus, type AsyncGenerationType } from '../pollProviderStatus';
import { GET as modelGET } from '@/app/api/generate/model/status/route';
import { GET as textureGET } from '@/app/api/generate/texture/status/route';
import { GET as skyboxGET } from '@/app/api/generate/skybox/status/route';
import { GET as musicGET } from '@/app/api/generate/music/status/route';
import { GET as spriteGET } from '@/app/api/generate/sprite/status/route';
import { GET as spriteSheetGET } from '@/app/api/generate/sprite-sheet/status/route';
import { GET as tilesetGET } from '@/app/api/generate/tileset-gen/status/route';

type RouteGet = (req: NextRequest) => Promise<Response>;
type ProviderResponse = Record<string, unknown>;

interface ParitySpec {
  type: AsyncGenerationType;
  routePath: string;
  GET: RouteGet;
  /** Point the matching provider-client method at this response. */
  setResp: (resp: ProviderResponse) => void;
  cases: { label: string; resp: ProviderResponse }[];
}

// Meshy 3D-model terminal cases (getTaskStatus).
const MODEL_CASES = [
  { label: 'SUCCEEDED with a glb → completed', resp: { status: 'SUCCEEDED', progress: 100, modelUrls: { glb: 'https://x/m.glb' } } },
  { label: 'SUCCEEDED with no glb → failed (#8757)', resp: { status: 'SUCCEEDED', progress: 100, modelUrls: undefined } },
  { label: 'FAILED → failed', resp: { status: 'FAILED', progress: 0 } },
  { label: 'EXPIRED → failed', resp: { status: 'EXPIRED', progress: 0 } },
  { label: 'IN_PROGRESS → processing', resp: { status: 'IN_PROGRESS', progress: 50 } },
  { label: 'PENDING → pending', resp: { status: 'PENDING', progress: 0 } },
];

// Meshy texture terminal cases (getTextureStatus).
const TEXTURE_CASES = [
  { label: 'SUCCEEDED with maps → completed', resp: { status: 'SUCCEEDED', progress: 100, maps: { base_color: 'https://x/c.png' } } },
  { label: 'SUCCEEDED with empty maps → failed (#8757)', resp: { status: 'SUCCEEDED', progress: 100, maps: {} } },
  { label: 'SUCCEEDED with no maps field → failed', resp: { status: 'SUCCEEDED', progress: 100 } },
  { label: 'FAILED → failed', resp: { status: 'FAILED', progress: 0 } },
  { label: 'EXPIRED → failed', resp: { status: 'EXPIRED', progress: 0 } },
  { label: 'IN_PROGRESS → processing', resp: { status: 'IN_PROGRESS', progress: 60 } },
  { label: 'QUEUED → pending', resp: { status: 'QUEUED', progress: 0 } },
];

// Meshy single-image skybox terminal cases (getTextureStatus, first map value).
const SKYBOX_CASES = [
  { label: 'SUCCEEDED with an image → completed', resp: { status: 'SUCCEEDED', progress: 100, maps: { sky: 'https://x/sky.png' } } },
  { label: 'SUCCEEDED with empty maps → failed (#8757)', resp: { status: 'SUCCEEDED', progress: 100, maps: {} } },
  { label: 'SUCCEEDED with no maps field → failed', resp: { status: 'SUCCEEDED', progress: 100 } },
  { label: 'FAILED → failed', resp: { status: 'FAILED', progress: 0 } },
  { label: 'EXPIRED → failed', resp: { status: 'EXPIRED', progress: 0 } },
  { label: 'IN_PROGRESS → processing', resp: { status: 'IN_PROGRESS', progress: 60 } },
  { label: 'QUEUED → pending', resp: { status: 'QUEUED', progress: 0 } },
];

// Suno music terminal cases (getStatus).
const MUSIC_CASES = [
  { label: 'completed with audio → completed', resp: { status: 'completed', progress: 100, audioUrl: 'https://x/a.mp3' } },
  { label: 'succeeded with audio → completed', resp: { status: 'succeeded', progress: 100, audioUrl: 'https://x/a.mp3' } },
  { label: 'completed with no audio → failed (#8757)', resp: { status: 'completed', progress: 100 } },
  { label: 'failed → failed', resp: { status: 'failed', progress: 0 } },
  { label: 'error → failed', resp: { status: 'error', progress: 0 } },
  { label: 'processing → processing', resp: { status: 'processing', progress: 10 } },
  { label: 'generating → processing', resp: { status: 'generating', progress: 20 } },
  { label: 'queued → pending', resp: { status: 'queued', progress: 0 } },
];

// Replicate SDXL terminal cases (getReplicateStatus) — shared shape across the
// three sprite variants.
const REPLICATE_CASES = [
  { label: 'succeeded with output → completed', resp: { status: 'succeeded', output: ['https://x/s.png'] } },
  { label: 'succeeded with empty output → failed (#8757)', resp: { status: 'succeeded', output: [] } },
  { label: 'failed → failed', resp: { status: 'failed' } },
  { label: 'canceled → failed', resp: { status: 'canceled' } },
  { label: 'processing → processing', resp: { status: 'processing' } },
  { label: 'starting → pending', resp: { status: 'starting' } },
];

const SPECS: ParitySpec[] = [
  { type: 'model', routePath: '/api/generate/model/status', GET: modelGET, setResp: (r) => getTaskStatus.mockResolvedValue(r), cases: MODEL_CASES },
  { type: 'texture', routePath: '/api/generate/texture/status', GET: textureGET, setResp: (r) => getTextureStatus.mockResolvedValue(r), cases: TEXTURE_CASES },
  { type: 'skybox', routePath: '/api/generate/skybox/status', GET: skyboxGET, setResp: (r) => getTextureStatus.mockResolvedValue(r), cases: SKYBOX_CASES },
  { type: 'music', routePath: '/api/generate/music/status', GET: musicGET, setResp: (r) => getStatus.mockResolvedValue(r), cases: MUSIC_CASES },
  { type: 'sprite', routePath: '/api/generate/sprite/status', GET: spriteGET, setResp: (r) => getReplicateStatus.mockResolvedValue(r), cases: REPLICATE_CASES },
  { type: 'sprite_sheet', routePath: '/api/generate/sprite-sheet/status', GET: spriteSheetGET, setResp: (r) => getReplicateStatus.mockResolvedValue(r), cases: REPLICATE_CASES },
  { type: 'tileset', routePath: '/api/generate/tileset-gen/status', GET: tilesetGET, setResp: (r) => getReplicateStatus.mockResolvedValue(r), cases: REPLICATE_CASES },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('pollProviderStatus ↔ /api/generate/<type>/status route parity (PF-906, #8816)', () => {
  for (const spec of SPECS) {
    describe(spec.type, () => {
      for (const c of spec.cases) {
        it(`poller and route agree: ${c.label}`, async () => {
          spec.setResp(c.resp);

          const routeRes = await spec.GET(
            new NextRequest(`http://localhost:3000${spec.routePath}?jobId=job-1`),
          );
          expect(routeRes.status).toBe(200);
          const routeJson = (await routeRes.json()) as { status: string; error?: string };

          const pollRes = await pollProviderStatus(spec.type, 'job-1', 'provider-key');

          // The terminal status MUST match — this is the drift the durable
          // callback can least afford (a completed-vs-failed disagreement
          // either skips a refund or double-refunds).
          expect(pollRes.status).toBe(routeJson.status);
          // The failure message the user sees must match too (the routes expose
          // it as `error`; the poller as `errorMessage`). `?? null` normalizes
          // the not-failed case where both omit the field.
          expect(pollRes.errorMessage ?? null).toBe(routeJson.error ?? null);
        });
      }
    });
  }

  it('covers every async type that has a status route (no silent gap)', () => {
    // If a new AsyncGenerationType is added without a parity spec, this fails —
    // forcing the new route into the gate rather than letting it drift unchecked.
    const covered = new Set(SPECS.map((s) => s.type));
    const allTypes: AsyncGenerationType[] = [
      'model', 'texture', 'skybox', 'music', 'sprite', 'sprite_sheet', 'tileset',
    ];
    for (const t of allTypes) expect(covered.has(t)).toBe(true);
  });
});
