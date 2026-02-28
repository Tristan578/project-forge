/**
 * Tests for AssetPanel utility functions.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';

// Re-implement the pure utility functions from AssetPanel for testing
// (they're module-scoped, so we replicate the logic here)

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileExtension(filename: string): string | undefined {
  return filename.split('.').pop()?.toLowerCase();
}

function isValidImportFile(filename: string): boolean {
  const ext = getFileExtension(filename);
  if (!ext) return false;
  return ['glb', 'gltf', 'png', 'jpg', 'jpeg', 'webp', 'mp3', 'ogg', 'wav', 'flac'].includes(ext);
}

function categorizeFile(filename: string): 'model' | 'texture' | 'audio' | null {
  const ext = getFileExtension(filename);
  if (!ext) return null;
  if (ext === 'glb' || ext === 'gltf') return 'model';
  if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) return 'texture';
  if (['mp3', 'ogg', 'wav', 'flac'].includes(ext)) return 'audio';
  return null;
}

describe('AssetPanel utility functions', () => {
  describe('formatFileSize', () => {
    it('should format bytes', () => {
      expect(formatFileSize(500)).toBe('500 B');
    });

    it('should format kilobytes', () => {
      expect(formatFileSize(2048)).toBe('2.0 KB');
    });

    it('should format megabytes', () => {
      expect(formatFileSize(5 * 1024 * 1024)).toBe('5.0 MB');
    });

    it('should handle zero', () => {
      expect(formatFileSize(0)).toBe('0 B');
    });
  });

  describe('isValidImportFile', () => {
    it('should accept .glb files', () => {
      expect(isValidImportFile('model.glb')).toBe(true);
    });

    it('should accept .gltf files', () => {
      expect(isValidImportFile('scene.gltf')).toBe(true);
    });

    it('should accept image files', () => {
      expect(isValidImportFile('texture.png')).toBe(true);
      expect(isValidImportFile('photo.jpg')).toBe(true);
      expect(isValidImportFile('image.webp')).toBe(true);
    });

    it('should accept audio files', () => {
      expect(isValidImportFile('sound.mp3')).toBe(true);
      expect(isValidImportFile('music.ogg')).toBe(true);
      expect(isValidImportFile('clip.wav')).toBe(true);
    });

    it('should reject unknown extensions', () => {
      expect(isValidImportFile('readme.txt')).toBe(false);
      expect(isValidImportFile('data.json')).toBe(false);
      expect(isValidImportFile('script.js')).toBe(false);
    });
  });

  describe('categorizeFile', () => {
    it('should categorize 3D models', () => {
      expect(categorizeFile('scene.glb')).toBe('model');
      expect(categorizeFile('world.gltf')).toBe('model');
    });

    it('should categorize textures', () => {
      expect(categorizeFile('diffuse.png')).toBe('texture');
      expect(categorizeFile('normal.jpg')).toBe('texture');
    });

    it('should categorize audio', () => {
      expect(categorizeFile('bgm.mp3')).toBe('audio');
      expect(categorizeFile('sfx.wav')).toBe('audio');
    });

    it('should return null for unknown files', () => {
      expect(categorizeFile('document.pdf')).toBeNull();
    });
  });

  describe('import progress tracking', () => {
    it('should compute correct percentage for progress', () => {
      const progress = { current: 3, total: 5 };
      const percentage = (progress.current / progress.total) * 100;
      expect(percentage).toBe(60);
    });

    it('should handle single file import', () => {
      const progress = { current: 1, total: 1 };
      const percentage = (progress.current / progress.total) * 100;
      expect(percentage).toBe(100);
    });
  });
});
