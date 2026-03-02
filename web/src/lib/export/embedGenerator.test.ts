import { describe, it, expect } from 'vitest';
import {
  generatePostMessageBridge,
  generateEmbedSnippet,
  generateResponsiveEmbedSnippet,
} from './embedGenerator';

describe('embedGenerator', () => {
  describe('generatePostMessageBridge', () => {
    it('should return non-empty script', () => {
      const bridge = generatePostMessageBridge();
      expect(bridge.length).toBeGreaterThan(0);
    });

    it('should check for iframe embedding', () => {
      const bridge = generatePostMessageBridge();
      expect(bridge).toContain('window.self !== window.top');
    });

    it('should send loading event', () => {
      const bridge = generatePostMessageBridge();
      expect(bridge).toContain("sendToParent('loading')");
    });

    it('should send ready event on engine ready', () => {
      const bridge = generatePostMessageBridge();
      expect(bridge).toContain('forge:engine-ready');
      expect(bridge).toContain("sendToParent('ready'");
    });

    it('should send resize events', () => {
      const bridge = generatePostMessageBridge();
      expect(bridge).toContain("sendToParent('resize'");
      expect(bridge).toContain('window.innerWidth');
      expect(bridge).toContain('window.innerHeight');
    });

    it('should listen for parent commands', () => {
      const bridge = generatePostMessageBridge();
      expect(bridge).toContain('forge-host');
      expect(bridge).toContain('pause');
      expect(bridge).toContain('resume');
      expect(bridge).toContain('mute');
    });

    it('should report errors to parent', () => {
      const bridge = generatePostMessageBridge();
      expect(bridge).toContain("sendToParent('error'");
    });

    it('should use postMessage with forge-game source', () => {
      const bridge = generatePostMessageBridge();
      expect(bridge).toContain("source: 'forge-game'");
    });

    it('should be wrapped in IIFE', () => {
      const bridge = generatePostMessageBridge();
      expect(bridge).toContain('(function()');
    });
  });

  describe('generateEmbedSnippet', () => {
    it('should generate iframe HTML', () => {
      const html = generateEmbedSnippet('My Game', 800, 600);
      expect(html).toContain('<iframe');
      expect(html).toContain('</iframe>');
    });

    it('should set correct dimensions', () => {
      const html = generateEmbedSnippet('My Game', 1280, 720);
      expect(html).toContain('width="1280"');
      expect(html).toContain('height="720"');
    });

    it('should set title attribute', () => {
      const html = generateEmbedSnippet('Cool Game', 800, 600);
      expect(html).toContain('title="Cool Game"');
    });

    it('should escape HTML in title', () => {
      const html = generateEmbedSnippet('Game "v2" <beta>', 800, 600);
      expect(html).toContain('&quot;v2&quot;');
      expect(html).toContain('&lt;beta&gt;');
      expect(html).not.toContain('"v2"');
    });

    it('should include sandbox attributes', () => {
      const html = generateEmbedSnippet('Test', 800, 600);
      expect(html).toContain('sandbox="allow-scripts allow-same-origin allow-popups"');
    });

    it('should include allow attributes', () => {
      const html = generateEmbedSnippet('Test', 800, 600);
      expect(html).toContain('allow="autoplay; gamepad; fullscreen"');
    });

    it('should include allowfullscreen', () => {
      const html = generateEmbedSnippet('Test', 800, 600);
      expect(html).toContain('allowfullscreen');
    });

    it('should reference game.html', () => {
      const html = generateEmbedSnippet('Test', 800, 600);
      expect(html).toContain('src="game.html"');
    });
  });

  describe('generateResponsiveEmbedSnippet', () => {
    it('should generate responsive wrapper div', () => {
      const html = generateResponsiveEmbedSnippet('My Game');
      expect(html).toContain('aspect-ratio: 16/9');
      expect(html).toContain('width: 100%');
    });

    it('should include absolutely positioned iframe', () => {
      const html = generateResponsiveEmbedSnippet('My Game');
      expect(html).toContain('position: absolute');
      expect(html).toContain('inset: 0');
      expect(html).toContain('width: 100%');
      expect(html).toContain('height: 100%');
    });

    it('should set title', () => {
      const html = generateResponsiveEmbedSnippet('Cool Game');
      expect(html).toContain('title="Cool Game"');
    });

    it('should escape HTML in title', () => {
      const html = generateResponsiveEmbedSnippet('Game & "Stuff"');
      expect(html).toContain('&amp;');
      expect(html).toContain('&quot;');
    });

    it('should include sandbox and allow attributes', () => {
      const html = generateResponsiveEmbedSnippet('Test');
      expect(html).toContain('sandbox=');
      expect(html).toContain('allow=');
      expect(html).toContain('allowfullscreen');
    });
  });
});
