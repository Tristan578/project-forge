// @vitest-environment jsdom
/**
 * Tests for export expansion features:
 * - Embed export format with postMessage bridge
 * - itch.io manifest generation
 * - Embed code snippet generation
 * - Export presets (embed preset)
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';
import {
  generatePostMessageBridge,
  generateEmbedSnippet,
  generateResponsiveEmbedSnippet,
} from '../embedGenerator';
import { EXPORT_PRESETS, type ExportFormat } from '../presets';

describe('embedGenerator', () => {
  describe('generatePostMessageBridge', () => {
    it('should generate a postMessage bridge script', () => {
      const script = generatePostMessageBridge();
      expect(script).toContain('window.parent.postMessage');
      expect(script).toContain("source: 'forge-game'");
    });

    it('should detect iframe embedding', () => {
      const script = generatePostMessageBridge();
      expect(script).toContain('window.self !== window.top');
    });

    it('should listen for engine ready event', () => {
      const script = generatePostMessageBridge();
      expect(script).toContain("'forge:engine-ready'");
      expect(script).toContain("sendToParent('ready'");
    });

    it('should report resize events', () => {
      const script = generatePostMessageBridge();
      expect(script).toContain("'resize'");
      expect(script).toContain('window.innerWidth');
    });

    it('should listen for parent messages', () => {
      const script = generatePostMessageBridge();
      expect(script).toContain("source !== 'forge-host'");
    });

    it('should report errors to parent', () => {
      const script = generatePostMessageBridge();
      expect(script).toContain("sendToParent('error'");
    });
  });

  describe('generateEmbedSnippet', () => {
    it('should generate an iframe tag with dimensions', () => {
      const snippet = generateEmbedSnippet('My Game', 960, 540);
      expect(snippet).toContain('<iframe');
      expect(snippet).toContain('width="960"');
      expect(snippet).toContain('height="540"');
      expect(snippet).toContain('title="My Game"');
    });

    it('should include sandbox attributes', () => {
      const snippet = generateEmbedSnippet('Test', 800, 600);
      expect(snippet).toContain('sandbox="allow-scripts allow-same-origin allow-popups"');
    });

    it('should include allow attributes for gamepad and fullscreen', () => {
      const snippet = generateEmbedSnippet('Test', 800, 600);
      expect(snippet).toContain('allow="autoplay; gamepad; fullscreen"');
    });

    it('should set frameborder to 0', () => {
      const snippet = generateEmbedSnippet('Test', 800, 600);
      expect(snippet).toContain('frameborder="0"');
    });

    it('should escape HTML entities in title', () => {
      const snippet = generateEmbedSnippet('Game "Alpha" & <Beta>', 800, 600);
      expect(snippet).toContain('&quot;Alpha&quot;');
      expect(snippet).toContain('&amp;');
      expect(snippet).toContain('&lt;Beta&gt;');
    });
  });

  describe('generateResponsiveEmbedSnippet', () => {
    it('should use aspect-ratio container', () => {
      const snippet = generateResponsiveEmbedSnippet('My Game');
      expect(snippet).toContain('aspect-ratio: 16/9');
    });

    it('should make iframe fill container', () => {
      const snippet = generateResponsiveEmbedSnippet('My Game');
      expect(snippet).toContain('width: 100%');
      expect(snippet).toContain('height: 100%');
    });

    it('should include title', () => {
      const snippet = generateResponsiveEmbedSnippet('Cool Game');
      expect(snippet).toContain('title="Cool Game"');
    });
  });
});

describe('Export Presets', () => {
  it('should include embed preset', () => {
    expect(EXPORT_PRESETS.embed).toBeDefined();
    expect(EXPORT_PRESETS.embed.format).toBe('embed');
    expect(EXPORT_PRESETS.embed.name).toBe('Embed');
  });

  it('should have 7 presets total', () => {
    expect(Object.keys(EXPORT_PRESETS)).toHaveLength(7);
  });

  it('embed preset should include correct description', () => {
    expect(EXPORT_PRESETS.embed.description).toContain('Iframe');
  });

  it('all presets should have valid format', () => {
    const validFormats: ExportFormat[] = ['single-html', 'zip', 'pwa', 'embed'];
    for (const preset of Object.values(EXPORT_PRESETS)) {
      expect(validFormats).toContain(preset.format);
    }
  });

  it('all presets should have loading screen config', () => {
    for (const preset of Object.values(EXPORT_PRESETS)) {
      expect(preset.loadingScreen).toBeDefined();
      expect(preset.loadingScreen.backgroundColor).toBeTruthy();
      expect(preset.loadingScreen.progressStyle).toBeTruthy();
    }
  });

  it('itch-io preset should use zip format', () => {
    expect(EXPORT_PRESETS['itch-io'].format).toBe('zip');
  });

  it('pwa-mobile preset should use pwa format', () => {
    expect(EXPORT_PRESETS['pwa-mobile'].format).toBe('pwa');
  });
});