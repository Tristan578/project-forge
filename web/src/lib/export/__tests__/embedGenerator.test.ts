import { describe, it, expect } from 'vitest';
import {
  generatePostMessageBridge,
  generateEmbedSnippet,
  generateResponsiveEmbedSnippet,
} from '../embedGenerator';

describe('generatePostMessageBridge', () => {
  it('should return a non-empty script string', () => {
    const bridge = generatePostMessageBridge();
    expect(bridge.length).toBeGreaterThan(100);
  });

  it('should contain postMessage calls', () => {
    const bridge = generatePostMessageBridge();
    expect(bridge).toContain('postMessage');
    expect(bridge).toContain('forge-game');
  });

  it('should handle loading, ready, resize, and error events', () => {
    const bridge = generatePostMessageBridge();
    expect(bridge).toContain("'loading'");
    expect(bridge).toContain("'ready'");
    expect(bridge).toContain("'resize'");
    expect(bridge).toContain("'error'");
  });

  it('should listen for parent commands', () => {
    const bridge = generatePostMessageBridge();
    expect(bridge).toContain('forge-host');
    expect(bridge).toContain('pause');
    expect(bridge).toContain('resume');
    expect(bridge).toContain('mute');
  });

  it('should only activate when embedded', () => {
    const bridge = generatePostMessageBridge();
    expect(bridge).toContain('window.self !== window.top');
  });
});

describe('generateEmbedSnippet', () => {
  it('should generate an iframe with correct attributes', () => {
    const html = generateEmbedSnippet('My Game', 800, 600);

    expect(html).toContain('<iframe');
    expect(html).toContain('src="game.html"');
    expect(html).toContain('title="My Game"');
    expect(html).toContain('width="800"');
    expect(html).toContain('height="600"');
    expect(html).toContain('allowfullscreen');
  });

  it('should include sandbox attributes', () => {
    const html = generateEmbedSnippet('Test', 640, 480);
    expect(html).toContain('sandbox="allow-scripts allow-same-origin allow-popups"');
  });

  it('should escape HTML special characters in title', () => {
    const html = generateEmbedSnippet('Game "with" <special> & chars', 640, 480);

    expect(html).toContain('&quot;');
    expect(html).toContain('&lt;');
    expect(html).toContain('&gt;');
    expect(html).toContain('&amp;');
    expect(html).not.toContain('"with"');
  });
});

describe('generateResponsiveEmbedSnippet', () => {
  it('should generate a responsive container with 16:9 aspect ratio', () => {
    const html = generateResponsiveEmbedSnippet('Responsive Game');

    expect(html).toContain('aspect-ratio: 16/9');
    expect(html).toContain('width: 100%');
    expect(html).toContain('height: 100%');
  });

  it('should contain nested iframe', () => {
    const html = generateResponsiveEmbedSnippet('Test');

    expect(html).toContain('<div');
    expect(html).toContain('<iframe');
    expect(html).toContain('</iframe>');
    expect(html).toContain('</div>');
  });

  it('should use absolute positioning for iframe', () => {
    const html = generateResponsiveEmbedSnippet('Test');
    expect(html).toContain('position: absolute');
    expect(html).toContain('inset: 0');
  });

  it('should escape title', () => {
    const html = generateResponsiveEmbedSnippet('Game & "Fun"');
    expect(html).toContain('&amp;');
    expect(html).toContain('&quot;');
  });
});
