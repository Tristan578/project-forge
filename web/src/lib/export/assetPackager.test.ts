import { describe, it, expect } from 'vitest';
import { packageAssets } from './assetPackager';
import type { AssetMetadata } from '@/stores/editorStore';

// Helper to create valid AssetMetadata
function createAsset(
  id: string,
  name: string,
  kind: 'gltf_model' | 'texture' | 'audio',
  data?: ArrayBuffer
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

describe('assetPackager', () => {
  describe('packageAssets', () => {
    it('returns empty package for no assets', () => {
      const result = packageAssets({});
      expect(result.assets).toEqual([]);
      expect(result.manifest).toEqual({});
      expect(result.totalSize).toBe(0);
    });

    it('filters out assets without data', () => {
      const assets: Record<string, AssetMetadata & { data?: ArrayBuffer }> = {
        asset1: createAsset('asset1', 'texture.png', 'texture'),
        asset2: createAsset('asset2', 'model.glb', 'gltf_model', new ArrayBuffer(1024)),
      };
      const result = packageAssets(assets);
      expect(result.assets.length).toBe(1);
      expect(result.assets[0].id).toBe('asset2');
    });

    it('generates filenames with ID and extension', () => {
      const assets: Record<string, AssetMetadata & { data?: ArrayBuffer }> = {
        asset1: createAsset('asset1', 'texture.png', 'texture', new ArrayBuffer(100)),
      };
      const result = packageAssets(assets);
      expect(result.assets[0].filename).toBe('asset1.png');
    });

    it('resolves MIME types for image extensions', () => {
      const assets: Record<string, AssetMetadata & { data?: ArrayBuffer }> = {
        png: createAsset('png', 'test.png', 'texture', new ArrayBuffer(10)),
        jpg: createAsset('jpg', 'test.jpg', 'texture', new ArrayBuffer(10)),
        jpeg: createAsset('jpeg', 'test.jpeg', 'texture', new ArrayBuffer(10)),
        webp: createAsset('webp', 'test.webp', 'texture', new ArrayBuffer(10)),
      };
      const result = packageAssets(assets);
      expect(result.assets.find((a) => a.id === 'png')?.mimeType).toBe('image/png');
      expect(result.assets.find((a) => a.id === 'jpg')?.mimeType).toBe('image/jpeg');
      expect(result.assets.find((a) => a.id === 'jpeg')?.mimeType).toBe('image/jpeg');
      expect(result.assets.find((a) => a.id === 'webp')?.mimeType).toBe('image/webp');
    });

    it('resolves MIME types for model extensions', () => {
      const assets: Record<string, AssetMetadata & { data?: ArrayBuffer }> = {
        glb: createAsset('glb', 'model.glb', 'gltf_model', new ArrayBuffer(10)),
        gltf: createAsset('gltf', 'model.gltf', 'gltf_model', new ArrayBuffer(10)),
      };
      const result = packageAssets(assets);
      expect(result.assets.find((a) => a.id === 'glb')?.mimeType).toBe('model/gltf-binary');
      expect(result.assets.find((a) => a.id === 'gltf')?.mimeType).toBe('model/gltf+json');
    });

    it('resolves MIME types for audio extensions', () => {
      const assets: Record<string, AssetMetadata & { data?: ArrayBuffer }> = {
        mp3: createAsset('mp3', 'sound.mp3', 'audio', new ArrayBuffer(10)),
        ogg: createAsset('ogg', 'sound.ogg', 'audio', new ArrayBuffer(10)),
        wav: createAsset('wav', 'sound.wav', 'audio', new ArrayBuffer(10)),
        flac: createAsset('flac', 'sound.flac', 'audio', new ArrayBuffer(10)),
      };
      const result = packageAssets(assets);
      expect(result.assets.find((a) => a.id === 'mp3')?.mimeType).toBe('audio/mpeg');
      expect(result.assets.find((a) => a.id === 'ogg')?.mimeType).toBe('audio/ogg');
      expect(result.assets.find((a) => a.id === 'wav')?.mimeType).toBe('audio/wav');
      expect(result.assets.find((a) => a.id === 'flac')?.mimeType).toBe('audio/flac');
    });

    it('handles unknown extensions with generic MIME type', () => {
      const assets: Record<string, AssetMetadata & { data?: ArrayBuffer }> = {
        unknown: createAsset('unknown', 'file.xyz', 'texture', new ArrayBuffer(10)),
      };
      const result = packageAssets(assets);
      expect(result.assets[0].mimeType).toBe('application/octet-stream');
    });

    it('handles files without extension', () => {
      const assets: Record<string, AssetMetadata & { data?: ArrayBuffer }> = {
        noext: createAsset('noext', 'file', 'texture', new ArrayBuffer(10)),
      };
      const result = packageAssets(assets);
      // Note: split('.').pop() on "file" returns "file", not ""
      expect(result.assets[0].filename).toBe('noext.file');
      expect(result.assets[0].mimeType).toBe('application/octet-stream');
    });

    it('calculates total size correctly', () => {
      const assets: Record<string, AssetMetadata & { data?: ArrayBuffer }> = {
        asset1: createAsset('asset1', 'file1.png', 'texture', new ArrayBuffer(1024)),
        asset2: createAsset('asset2', 'file2.glb', 'gltf_model', new ArrayBuffer(2048)),
        asset3: createAsset('asset3', 'file3.mp3', 'audio', new ArrayBuffer(512)),
      };
      const result = packageAssets(assets);
      expect(result.totalSize).toBe(1024 + 2048 + 512);
    });

    it('builds manifest mapping IDs to filenames', () => {
      const assets: Record<string, AssetMetadata & { data?: ArrayBuffer }> = {
        asset1: createAsset('asset1', 'texture.png', 'texture', new ArrayBuffer(100)),
        asset2: createAsset('asset2', 'model.glb', 'gltf_model', new ArrayBuffer(200)),
      };
      const result = packageAssets(assets);
      expect(result.manifest).toEqual({
        asset1: 'asset1.png',
        asset2: 'asset2.glb',
      });
    });

    it('preserves ArrayBuffer data in packaged assets', () => {
      const buffer = new ArrayBuffer(100);
      const assets: Record<string, AssetMetadata & { data?: ArrayBuffer }> = {
        asset1: createAsset('asset1', 'file.png', 'texture', buffer),
      };
      const result = packageAssets(assets);
      expect(result.assets[0].data).toBe(buffer);
    });
  });
});
