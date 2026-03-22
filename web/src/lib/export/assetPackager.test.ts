import { describe, it, expect, vi, beforeEach } from 'vitest';
import { packageAssets } from './assetPackager';
import type { AssetMetadata } from '@/stores/editorStore';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Stub compressTexture so tests run in Node (no Canvas API).
// The real function is exercised in browser-level tests only.
vi.mock('@/lib/export/textureCompression', () => ({
  COMPRESSION_PRESETS: {
    balanced: { format: 'webp', quality: 85, maxWidth: 2048, maxHeight: 2048, generateMipmaps: false },
  },
  compressTexture: vi.fn(),
}));

import { compressTexture } from '@/lib/export/textureCompression';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function createAsset(
  id: string,
  name: string,
  kind: 'gltf_model' | 'texture' | 'audio',
  data?: ArrayBuffer,
): AssetMetadata & { data?: ArrayBuffer } {
  return {
    id,
    name,
    kind,
    fileSize: data?.byteLength || 0,
    source: { type: 'upload', filename: name },
    data,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Basic packaging (no compression)
// ---------------------------------------------------------------------------

describe('assetPackager', () => {
  describe('packageAssets (no compression)', () => {
    it('returns empty package for no assets', async () => {
      const result = await packageAssets({});
      expect(result.assets).toEqual([]);
      expect(result.manifest).toEqual({});
      expect(result.totalSize).toBe(0);
    });

    it('filters out assets without data', async () => {
      const assets: Record<string, AssetMetadata & { data?: ArrayBuffer }> = {
        asset1: createAsset('asset1', 'texture.png', 'texture'),
        asset2: createAsset('asset2', 'model.glb', 'gltf_model', new ArrayBuffer(1024)),
      };
      const result = await packageAssets(assets);
      expect(result.assets.length).toBe(1);
      expect(result.assets[0].id).toBe('asset2');
    });

    it('generates filenames with ID and extension', async () => {
      const assets: Record<string, AssetMetadata & { data?: ArrayBuffer }> = {
        asset1: createAsset('asset1', 'texture.png', 'texture', new ArrayBuffer(100)),
      };
      const result = await packageAssets(assets);
      expect(result.assets[0].filename).toBe('asset1.png');
    });

    it('resolves MIME types for image extensions', async () => {
      const assets: Record<string, AssetMetadata & { data?: ArrayBuffer }> = {
        png: createAsset('png', 'test.png', 'texture', new ArrayBuffer(10)),
        jpg: createAsset('jpg', 'test.jpg', 'texture', new ArrayBuffer(10)),
        jpeg: createAsset('jpeg', 'test.jpeg', 'texture', new ArrayBuffer(10)),
        webp: createAsset('webp', 'test.webp', 'texture', new ArrayBuffer(10)),
      };
      const result = await packageAssets(assets);
      expect(result.assets.find((a) => a.id === 'png')?.mimeType).toBe('image/png');
      expect(result.assets.find((a) => a.id === 'jpg')?.mimeType).toBe('image/jpeg');
      expect(result.assets.find((a) => a.id === 'jpeg')?.mimeType).toBe('image/jpeg');
      expect(result.assets.find((a) => a.id === 'webp')?.mimeType).toBe('image/webp');
    });

    it('resolves MIME types for model extensions', async () => {
      const assets: Record<string, AssetMetadata & { data?: ArrayBuffer }> = {
        glb: createAsset('glb', 'model.glb', 'gltf_model', new ArrayBuffer(10)),
        gltf: createAsset('gltf', 'model.gltf', 'gltf_model', new ArrayBuffer(10)),
      };
      const result = await packageAssets(assets);
      expect(result.assets.find((a) => a.id === 'glb')?.mimeType).toBe('model/gltf-binary');
      expect(result.assets.find((a) => a.id === 'gltf')?.mimeType).toBe('model/gltf+json');
    });

    it('resolves MIME types for audio extensions', async () => {
      const assets: Record<string, AssetMetadata & { data?: ArrayBuffer }> = {
        mp3: createAsset('mp3', 'sound.mp3', 'audio', new ArrayBuffer(10)),
        ogg: createAsset('ogg', 'sound.ogg', 'audio', new ArrayBuffer(10)),
        wav: createAsset('wav', 'sound.wav', 'audio', new ArrayBuffer(10)),
        flac: createAsset('flac', 'sound.flac', 'audio', new ArrayBuffer(10)),
      };
      const result = await packageAssets(assets);
      expect(result.assets.find((a) => a.id === 'mp3')?.mimeType).toBe('audio/mpeg');
      expect(result.assets.find((a) => a.id === 'ogg')?.mimeType).toBe('audio/ogg');
      expect(result.assets.find((a) => a.id === 'wav')?.mimeType).toBe('audio/wav');
      expect(result.assets.find((a) => a.id === 'flac')?.mimeType).toBe('audio/flac');
    });

    it('handles unknown extensions with generic MIME type', async () => {
      const assets: Record<string, AssetMetadata & { data?: ArrayBuffer }> = {
        unknown: createAsset('unknown', 'file.xyz', 'texture', new ArrayBuffer(10)),
      };
      const result = await packageAssets(assets);
      expect(result.assets[0].mimeType).toBe('application/octet-stream');
    });

    it('handles files without extension', async () => {
      const assets: Record<string, AssetMetadata & { data?: ArrayBuffer }> = {
        noext: createAsset('noext', 'file', 'texture', new ArrayBuffer(10)),
      };
      const result = await packageAssets(assets);
      // Note: split('.').pop() on "file" returns "file", not ""
      expect(result.assets[0].filename).toBe('noext.file');
      expect(result.assets[0].mimeType).toBe('application/octet-stream');
    });

    it('calculates total size correctly', async () => {
      const assets: Record<string, AssetMetadata & { data?: ArrayBuffer }> = {
        asset1: createAsset('asset1', 'file1.png', 'texture', new ArrayBuffer(1024)),
        asset2: createAsset('asset2', 'file2.glb', 'gltf_model', new ArrayBuffer(2048)),
        asset3: createAsset('asset3', 'file3.mp3', 'audio', new ArrayBuffer(512)),
      };
      const result = await packageAssets(assets);
      expect(result.totalSize).toBe(1024 + 2048 + 512);
    });

    it('builds manifest mapping IDs to filenames', async () => {
      const assets: Record<string, AssetMetadata & { data?: ArrayBuffer }> = {
        asset1: createAsset('asset1', 'texture.png', 'texture', new ArrayBuffer(100)),
        asset2: createAsset('asset2', 'model.glb', 'gltf_model', new ArrayBuffer(200)),
      };
      const result = await packageAssets(assets);
      expect(result.manifest).toEqual({
        asset1: 'asset1.png',
        asset2: 'asset2.glb',
      });
    });

    it('preserves ArrayBuffer data in packaged assets', async () => {
      const buffer = new ArrayBuffer(100);
      const assets: Record<string, AssetMetadata & { data?: ArrayBuffer }> = {
        asset1: createAsset('asset1', 'file.png', 'texture', buffer),
      };
      const result = await packageAssets(assets);
      expect(result.assets[0].data).toBe(buffer);
    });

    it('does not call compressTexture when compress=false (default)', async () => {
      const assets: Record<string, AssetMetadata & { data?: ArrayBuffer }> = {
        asset1: createAsset('asset1', 'texture.png', 'texture', new ArrayBuffer(100)),
      };
      await packageAssets(assets);
      expect(compressTexture).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Compression enabled
  // -------------------------------------------------------------------------

  describe('packageAssets (compress=true)', () => {
    it('calls compressTexture for image assets', async () => {
      const smallerBuffer = new ArrayBuffer(50);
      vi.mocked(compressTexture).mockResolvedValue({
        data: new Blob([smallerBuffer], { type: 'image/webp' }),
        format: 'image/webp',
        originalSize: 100,
        compressedSize: 50,
        ratio: 0.5,
      });

      const assets: Record<string, AssetMetadata & { data?: ArrayBuffer }> = {
        asset1: createAsset('asset1', 'texture.png', 'texture', new ArrayBuffer(100)),
      };
      await packageAssets(assets, { compress: true });
      expect(compressTexture).toHaveBeenCalledOnce();
    });

    it('does not call compressTexture for non-image assets', async () => {
      const assets: Record<string, AssetMetadata & { data?: ArrayBuffer }> = {
        audio: createAsset('audio', 'sound.mp3', 'audio', new ArrayBuffer(100)),
        model: createAsset('model', 'model.glb', 'gltf_model', new ArrayBuffer(200)),
      };
      await packageAssets(assets, { compress: true });
      expect(compressTexture).not.toHaveBeenCalled();
    });

    it('uses compressed data when compressed result is smaller', async () => {
      const compressedBuffer = new ArrayBuffer(40);
      vi.mocked(compressTexture).mockResolvedValue({
        data: new Blob([compressedBuffer], { type: 'image/webp' }),
        format: 'image/webp',
        originalSize: 100,
        compressedSize: 40,
        ratio: 0.4,
      });

      const assets: Record<string, AssetMetadata & { data?: ArrayBuffer }> = {
        asset1: createAsset('asset1', 'texture.jpg', 'texture', new ArrayBuffer(100)),
      };
      const result = await packageAssets(assets, { compress: true });
      expect(result.assets[0].mimeType).toBe('image/webp');
      expect(result.assets[0].filename).toBe('asset1.webp');
      expect(result.totalSize).toBe(40);
    });

    it('keeps original data when compressed result is not smaller', async () => {
      const largerBuffer = new ArrayBuffer(200);
      vi.mocked(compressTexture).mockResolvedValue({
        data: new Blob([largerBuffer], { type: 'image/webp' }),
        format: 'image/webp',
        originalSize: 100,
        compressedSize: 200,
        ratio: 2.0,
      });

      const originalBuffer = new ArrayBuffer(100);
      const assets: Record<string, AssetMetadata & { data?: ArrayBuffer }> = {
        asset1: createAsset('asset1', 'texture.png', 'texture', originalBuffer),
      };
      const result = await packageAssets(assets, { compress: true });
      expect(result.assets[0].data).toBe(originalBuffer);
      expect(result.assets[0].mimeType).toBe('image/png');
    });

    it('falls back to original data when compressTexture throws', async () => {
      vi.mocked(compressTexture).mockRejectedValue(new Error('Canvas not available'));

      const originalBuffer = new ArrayBuffer(100);
      const assets: Record<string, AssetMetadata & { data?: ArrayBuffer }> = {
        asset1: createAsset('asset1', 'texture.png', 'texture', originalBuffer),
      };
      const result = await packageAssets(assets, { compress: true });
      expect(result.assets[0].data).toBe(originalBuffer);
      expect(result.assets[0].mimeType).toBe('image/png');
    });

    it('preserves PNG format for PNG assets (transparency)', async () => {
      const smallerBuffer = new ArrayBuffer(50);
      vi.mocked(compressTexture).mockResolvedValue({
        data: new Blob([smallerBuffer], { type: 'image/png' }),
        format: 'image/png',
        originalSize: 100,
        compressedSize: 50,
        ratio: 0.5,
      });

      const assets: Record<string, AssetMetadata & { data?: ArrayBuffer }> = {
        asset1: createAsset('asset1', 'sprite.png', 'texture', new ArrayBuffer(100)),
      };
      const result = await packageAssets(assets, { compress: true });
      // Config passed should use png format for PNG input
      const callArgs = vi.mocked(compressTexture).mock.calls[0];
      expect(callArgs[1].format).toBe('png');
      expect(result.assets[0].mimeType).toBe('image/png');
    });

    it('accepts a custom compressionConfig override', async () => {
      const smallerBuffer = new ArrayBuffer(30);
      vi.mocked(compressTexture).mockResolvedValue({
        data: new Blob([smallerBuffer], { type: 'image/webp' }),
        format: 'image/webp',
        originalSize: 100,
        compressedSize: 30,
        ratio: 0.3,
      });

      const customConfig = {
        format: 'webp' as const,
        quality: 60,
        maxWidth: 512,
        maxHeight: 512,
        generateMipmaps: false,
      };

      const assets: Record<string, AssetMetadata & { data?: ArrayBuffer }> = {
        asset1: createAsset('asset1', 'texture.jpg', 'texture', new ArrayBuffer(100)),
      };
      await packageAssets(assets, { compress: true, compressionConfig: customConfig });
      const callArgs = vi.mocked(compressTexture).mock.calls[0];
      expect(callArgs[1]).toEqual(customConfig);
    });
  });
});
