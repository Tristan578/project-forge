vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db/client';

const mockWithApiMiddleware = vi.fn();
vi.mock('@/lib/api/middleware', () => ({
  withApiMiddleware: (...args: unknown[]) => mockWithApiMiddleware(...args),
}));
vi.mock('@/lib/db/client');
const mockCaptureMessage = vi.fn();
vi.mock('@/lib/monitoring/sentry-server', () => ({
  captureException: vi.fn(),
  captureMessage: (...args: unknown[]) => mockCaptureMessage(...args),
}));
vi.mock('@/lib/db/schema', () => ({
  marketplaceAssets: { id: 'id', sellerId: 'sellerId' },
}));
vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
  and: vi.fn(),
}));

const mockUploadToR2 = vi.fn();
const mockDeleteManyFromR2 = vi.fn();
// resolveOwnedAssetKey stays REAL so the superseded-key assertions below prove
// the actual key derivation, not a stub of it.
vi.mock('@/lib/storage/r2', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/storage/r2')>();
  return {
    resolveOwnedAssetKey: actual.resolveOwnedAssetKey,
    // Real too — the sidecar assertions below prove the exact derived keys.
    withStatusSidecars: actual.withStatusSidecars,
    uploadToR2: (...args: unknown[]) => mockUploadToR2(...args),
    deleteManyFromR2: (...args: unknown[]) => mockDeleteManyFromR2(...args),
    buildAssetKey: vi.fn(
      (sellerId: string, assetId: string, filename: string, type: string) =>
        `assets/${sellerId}/${assetId}/${type}/${filename}`
    ),
  };
});

function authSuccess() {
  mockWithApiMiddleware.mockResolvedValue({
    authContext: { user: { id: 'user_1', tier: 'creator' } },
  });
}

function authFailure() {
  mockWithApiMiddleware.mockResolvedValue({
    error: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
  });
}

describe('POST /api/marketplace/seller/assets/[id]/upload', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    authSuccess();
    process.env.CDN_URL = 'cdn.spawnforge.ai';
    mockDeleteManyFromR2.mockResolvedValue({
      requested: 0,
      deleted: 0,
      failedKeys: [],
      errors: [],
      truncated: false,
    });
  });

  /** Wire getDb() for a happy-path upload against an existing asset row. */
  function stubDb(assetRow: Record<string, unknown>) {
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([assetRow]),
    };
    const updateChain = {
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'a1' }]),
        }),
      }),
    };
    vi.mocked(getDb).mockReturnValue({
      select: vi.fn().mockReturnValue(selectChain),
      update: vi.fn().mockReturnValue(updateChain),
    } as never);
  }

  async function postFile(field: 'preview' | 'asset', file: File) {
    const { POST } = await import('./route');
    const formData = new FormData();
    formData.append(field, file);
    const req = new NextRequest('http://localhost:3000/api/marketplace/seller/assets/a1/upload', {
      method: 'POST',
    });
    vi.spyOn(req, 'formData').mockResolvedValue(formData);
    return POST(req, { params: Promise.resolve({ id: 'a1' }) });
  }

  /** Same as postFile, but for a request carrying both file fields. */
  async function postForm(formData: FormData) {
    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/marketplace/seller/assets/a1/upload', {
      method: 'POST',
    });
    vi.spyOn(req, 'formData').mockResolvedValue(formData);
    return POST(req, { params: Promise.resolve({ id: 'a1' }) });
  }

  it('should return 401 when not authenticated', async () => {
    authFailure();

    const { POST } = await import('./route');
    const formData = new FormData();
    const req = new NextRequest('http://localhost:3000/api/marketplace/seller/assets/a1/upload', {
      method: 'POST',
      body: formData,
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'a1' }) });

    expect(res.status).toBe(401);
  });

  it('should return 404 when asset not found or not owned', async () => {
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(getDb).mockReturnValue({ select: vi.fn().mockReturnValue(selectChain) } as never);

    const { POST } = await import('./route');
    const formData = new FormData();
    formData.append('preview', new File(['data'], 'preview.png', { type: 'image/png' }));
    const req = new NextRequest('http://localhost:3000/api/marketplace/seller/assets/missing/upload', {
      method: 'POST',
      body: formData,
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'missing' }) });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toContain('Asset not found');
  });

  it('should return 400 when no files provided', async () => {
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: 'a1', sellerId: 'user_1' }]),
    };
    vi.mocked(getDb).mockReturnValue({ select: vi.fn().mockReturnValue(selectChain) } as never);

    const { POST } = await import('./route');
    const formData = new FormData();
    const req = new NextRequest('http://localhost:3000/api/marketplace/seller/assets/a1/upload', {
      method: 'POST',
      body: formData,
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'a1' }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('No files provided');
  });

  it('should return 400 for invalid file types', async () => {
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: 'a1', sellerId: 'user_1' }]),
    };
    vi.mocked(getDb).mockReturnValue({ select: vi.fn().mockReturnValue(selectChain) } as never);

    const { POST } = await import('./route');
    const formData = new FormData();
    formData.append('preview', new File(['data'], 'evil.exe', { type: 'application/x-executable' }));
    const req = new NextRequest('http://localhost:3000/api/marketplace/seller/assets/a1/upload', {
      method: 'POST',
    });
    vi.spyOn(req, 'formData').mockResolvedValue(formData);
    const res = await POST(req, { params: Promise.resolve({ id: 'a1' }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('Validation failed');
    expect(body.details[0]).toContain('not allowed');
  });

  it('should upload to R2 and return CDN URLs', async () => {
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: 'a1', sellerId: 'user_1' }]),
    };
    const updateChain = {
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{
            id: 'a1',
            previewUrl: 'https://cdn.spawnforge.ai/assets/user_1/a1/preview/thumb.png',
          }]),
        }),
      }),
    };
    vi.mocked(getDb).mockReturnValue({
      select: vi.fn().mockReturnValue(selectChain),
      update: vi.fn().mockReturnValue(updateChain),
    } as never);

    mockUploadToR2.mockResolvedValue({
      url: 'https://cdn.spawnforge.ai/assets/user_1/a1/preview/thumb.png',
      key: 'assets/user_1/a1/preview/thumb.png',
    });

    const { POST } = await import('./route');
    const formData = new FormData();
    formData.append('preview', new File(['imgdata'], 'thumb.png', { type: 'image/png' }));
    const req = new NextRequest('http://localhost:3000/api/marketplace/seller/assets/a1/upload', {
      method: 'POST',
    });
    vi.spyOn(req, 'formData').mockResolvedValue(formData);
    const res = await POST(req, { params: Promise.resolve({ id: 'a1' }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.uploaded.preview).toContain('cdn.spawnforge.ai');
    expect(mockUploadToR2).toHaveBeenCalled();
  });

  it('should pass file body to R2 as stream or buffer (#8219)', async () => {
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: 'a1', sellerId: 'user_1' }]),
    };
    const updateChain = {
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'a1' }]),
        }),
      }),
    };
    vi.mocked(getDb).mockReturnValue({
      select: vi.fn().mockReturnValue(selectChain),
      update: vi.fn().mockReturnValue(updateChain),
    } as never);

    mockUploadToR2.mockResolvedValue({
      url: 'https://cdn.spawnforge.ai/assets/user_1/a1/file/model.glb',
      key: 'assets/user_1/a1/file/model.glb',
    });

    const { POST } = await import('./route');
    const formData = new FormData();
    formData.append('asset', new File(['modeldata'], 'model.glb', { type: 'model/gltf-binary' }));
    const req = new NextRequest('http://localhost:3000/api/marketplace/seller/assets/a1/upload', {
      method: 'POST',
    });
    vi.spyOn(req, 'formData').mockResolvedValue(formData);
    await POST(req, { params: Promise.resolve({ id: 'a1' }) });

    // Body is streamed when File.stream() is available, buffered otherwise.
    // Both are valid — the key invariant is that we don't pre-buffer unnecessarily.
    const bodyArg = mockUploadToR2.mock.calls[0][1];
    const isStreamOrBuffer =
      bodyArg instanceof ReadableStream || Buffer.isBuffer(bodyArg);
    expect(isStreamOrBuffer).toBe(true);
  });

  it('should return 500 when R2 upload fails', async () => {
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: 'a1', sellerId: 'user_1' }]),
    };
    vi.mocked(getDb).mockReturnValue({ select: vi.fn().mockReturnValue(selectChain) } as never);

    mockUploadToR2.mockRejectedValue(new Error('R2 connection failed'));

    const { POST } = await import('./route');
    const formData = new FormData();
    formData.append('preview', new File(['imgdata'], 'thumb.png', { type: 'image/png' }));
    const req = new NextRequest('http://localhost:3000/api/marketplace/seller/assets/a1/upload', {
      method: 'POST',
    });
    vi.spyOn(req, 'formData').mockResolvedValue(formData);
    const res = await POST(req, { params: Promise.resolve({ id: 'a1' }) });

    expect(res.status).toBe(500);
  });

  // -------------------------------------------------------------------------
  // Superseded-object cleanup (PF-9457)
  // -------------------------------------------------------------------------

  describe('superseded R2 objects', () => {
    it('deletes the previous object when a re-upload changes the key', async () => {
      stubDb({
        id: 'a1',
        sellerId: 'user_1',
        assetFileUrl: 'https://cdn.spawnforge.ai/assets/user_1/a1/file/old-model.glb',
      });
      mockUploadToR2.mockResolvedValue({
        url: 'https://cdn.spawnforge.ai/assets/user_1/a1/file/new-model.glb',
        key: 'assets/user_1/a1/file/new-model.glb',
      });

      const res = await postFile(
        'asset',
        new File(['modeldata'], 'new-model.glb', { type: 'model/gltf-binary' })
      );

      expect(res.status).toBe(200);
      expect(mockDeleteManyFromR2).toHaveBeenCalledTimes(1);
      expect(mockDeleteManyFromR2).toHaveBeenCalledWith([
        'assets/user_1/a1/file/old-model.glb',
        'assets/user_1/a1/file/old-model.glb.status.json',
      ]);
    });

    it("sweeps the superseded object's status sidecar alongside it", async () => {
      // infra/asset-postprocess/worker.mjs PUTs `<key>.status.json` next to every
      // created object in the same bucket. It is recorded in no DB row, so it
      // outlives the object it describes unless this sweep derives it.
      stubDb({
        id: 'a1',
        sellerId: 'user_1',
        previewUrl: 'https://cdn.spawnforge.ai/assets/user_1/a1/preview/old-thumb.png',
        assetFileUrl: 'https://cdn.spawnforge.ai/assets/user_1/a1/file/old-model.glb',
      });
      mockUploadToR2
        .mockResolvedValueOnce({
          url: 'https://cdn.spawnforge.ai/assets/user_1/a1/preview/new-thumb.png',
          key: 'assets/user_1/a1/preview/new-thumb.png',
        })
        .mockResolvedValueOnce({
          url: 'https://cdn.spawnforge.ai/assets/user_1/a1/file/new-model.glb',
          key: 'assets/user_1/a1/file/new-model.glb',
        });

      const form = new FormData();
      form.set('preview', new File(['imgdata'], 'new-thumb.png', { type: 'image/png' }));
      form.set('asset', new File(['modeldata'], 'new-model.glb', { type: 'model/gltf-binary' }));
      const res = await postForm(form);

      expect(res.status).toBe(200);
      expect(mockDeleteManyFromR2).toHaveBeenCalledWith([
        'assets/user_1/a1/preview/old-thumb.png',
        'assets/user_1/a1/preview/old-thumb.png.status.json',
        'assets/user_1/a1/file/old-model.glb',
        'assets/user_1/a1/file/old-model.glb.status.json',
      ]);
    });

    it('does NOT delete when the re-upload overwrites the same key', async () => {
      // Same filename means PutObject already replaced the object in place —
      // deleting that key would destroy the upload we just made.
      stubDb({
        id: 'a1',
        sellerId: 'user_1',
        previewUrl: 'https://cdn.spawnforge.ai/assets/user_1/a1/preview/thumb.png',
      });
      mockUploadToR2.mockResolvedValue({
        url: 'https://cdn.spawnforge.ai/assets/user_1/a1/preview/thumb.png',
        key: 'assets/user_1/a1/preview/thumb.png',
      });

      const res = await postFile(
        'preview',
        new File(['imgdata'], 'thumb.png', { type: 'image/png' })
      );

      expect(res.status).toBe(200);
      expect(mockDeleteManyFromR2).not.toHaveBeenCalled();
    });

    it('does not delete a stored URL pointing at another seller key', async () => {
      // previewUrl is seller-writable via the asset PATCH route.
      stubDb({
        id: 'a1',
        sellerId: 'user_1',
        previewUrl: 'https://cdn.spawnforge.ai/assets/victim/a9/preview/paid.png',
      });
      mockUploadToR2.mockResolvedValue({
        url: 'https://cdn.spawnforge.ai/assets/user_1/a1/preview/thumb.png',
        key: 'assets/user_1/a1/preview/thumb.png',
      });

      const res = await postFile(
        'preview',
        new File(['imgdata'], 'thumb.png', { type: 'image/png' })
      );

      expect(res.status).toBe(200);
      expect(mockDeleteManyFromR2).not.toHaveBeenCalled();
    });

    it('still succeeds when the superseded-object sweep reports a failure', async () => {
      stubDb({
        id: 'a1',
        sellerId: 'user_1',
        assetFileUrl: 'https://cdn.spawnforge.ai/assets/user_1/a1/file/old-model.glb',
      });
      mockUploadToR2.mockResolvedValue({
        url: 'https://cdn.spawnforge.ai/assets/user_1/a1/file/new-model.glb',
        key: 'assets/user_1/a1/file/new-model.glb',
      });
      mockDeleteManyFromR2.mockResolvedValue({
        requested: 1,
        deleted: 0,
        failedKeys: ['assets/user_1/a1/file/old-model.glb'],
        errors: ['R2 unavailable'],
        truncated: false,
      });

      const res = await postFile(
        'asset',
        new File(['modeldata'], 'new-model.glb', { type: 'model/gltf-binary' })
      );
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.uploaded.asset).toContain('new-model.glb');
      expect(mockCaptureMessage).toHaveBeenCalledWith(
        expect.stringContaining('assets/user_1/a1/file/old-model.glb'),
        'error',
      );
    });

    it('does not sweep when the asset had no previous object', async () => {
      stubDb({ id: 'a1', sellerId: 'user_1', assetFileUrl: null });
      mockUploadToR2.mockResolvedValue({
        url: 'https://cdn.spawnforge.ai/assets/user_1/a1/file/model.glb',
        key: 'assets/user_1/a1/file/model.glb',
      });

      const res = await postFile(
        'asset',
        new File(['modeldata'], 'model.glb', { type: 'model/gltf-binary' })
      );

      expect(res.status).toBe(200);
      expect(mockDeleteManyFromR2).not.toHaveBeenCalled();
    });
  });
});
