// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { generateLoadingHtml, generateLoadingScript } from './loadingScreen';

describe('generateLoadingHtml', () => {
  it('should generate loading HTML with bar style', () => {
    const html = generateLoadingHtml({
      backgroundColor: '#000000',
      progressBarColor: '#6366f1',
      progressStyle: 'bar',
    });

    expect(html).toContain('id="loading-screen"');
    expect(html).toContain('background: #000000');
    expect(html).toContain('progress-bar-container');
  });

  it('should generate loading HTML with spinner style', () => {
    const html = generateLoadingHtml({
      backgroundColor: '#1a1a1a',
      progressBarColor: '#3b82f6',
      progressStyle: 'spinner',
    });

    expect(html).toContain('spinner');
    expect(html).not.toContain('progress-bar-container');
  });

  it('should include title and subtitle when provided', () => {
    const html = generateLoadingHtml({
      backgroundColor: '#000000',
      progressBarColor: '#6366f1',
      progressStyle: 'bar',
      title: 'My Game',
      subtitle: 'Loading...',
    });

    expect(html).toContain('My Game');
    expect(html).toContain('Loading...');
  });

  it('should escape HTML in title and subtitle', () => {
    const html = generateLoadingHtml({
      backgroundColor: '#000000',
      progressBarColor: '#6366f1',
      progressStyle: 'bar',
      title: '<script>alert("xss")</script>',
    });

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('should escape ampersands in title', () => {
    const html = generateLoadingHtml({
      backgroundColor: '#000000',
      progressBarColor: '#6366f1',
      progressStyle: 'bar',
      title: 'Cats & Dogs',
    });
    expect(html).toContain('Cats &amp; Dogs');
    expect(html).not.toContain('Cats & Dogs');
  });

  it('should escape double quotes in subtitle', () => {
    const html = generateLoadingHtml({
      backgroundColor: '#000000',
      progressBarColor: '#6366f1',
      progressStyle: 'spinner',
      subtitle: '"Quoted"',
    });
    expect(html).toContain('&quot;Quoted&quot;');
  });

  it('should escape single quotes in title', () => {
    const html = generateLoadingHtml({
      backgroundColor: '#000000',
      progressBarColor: '#6366f1',
      progressStyle: 'bar',
      title: "It's a game",
    });
    expect(html).toContain('&#039;');
  });

  it('should omit title HTML when title is not provided', () => {
    const html = generateLoadingHtml({
      backgroundColor: '#000000',
      progressBarColor: '#6366f1',
      progressStyle: 'bar',
    });
    expect(html).not.toContain('<h1');
  });

  it('should omit subtitle HTML when subtitle is not provided', () => {
    const html = generateLoadingHtml({
      backgroundColor: '#000000',
      progressBarColor: '#6366f1',
      progressStyle: 'bar',
    });
    expect(html).not.toContain('<p style');
  });

  it('should embed logo img when logoDataUrl is provided', () => {
    const logoUrl = 'data:image/png;base64,iVBORw0KGgo=';
    const html = generateLoadingHtml({
      backgroundColor: '#000000',
      progressBarColor: '#6366f1',
      progressStyle: 'bar',
      logoDataUrl: logoUrl,
    });
    expect(html).toContain('<img');
    expect(html).toContain(logoUrl);
    expect(html).toContain('alt="Game Logo"');
  });

  it('should not include img tag when logoDataUrl is omitted', () => {
    const html = generateLoadingHtml({
      backgroundColor: '#000000',
      progressBarColor: '#6366f1',
      progressStyle: 'bar',
    });
    expect(html).not.toContain('<img');
  });

  it('should use the progressBarColor in the bar style CSS', () => {
    const color = '#ff5733';
    const html = generateLoadingHtml({
      backgroundColor: '#000000',
      progressBarColor: color,
      progressStyle: 'bar',
    });
    expect(html).toContain(color);
  });

  it('should use the progressBarColor in the spinner style CSS', () => {
    const color = '#00ff00';
    const html = generateLoadingHtml({
      backgroundColor: '#ffffff',
      progressBarColor: color,
      progressStyle: 'spinner',
    });
    expect(html).toContain(color);
  });

  it('should use the progressBarColor in the dots style CSS', () => {
    const color = '#aabbcc';
    const html = generateLoadingHtml({
      backgroundColor: '#ffffff',
      progressBarColor: color,
      progressStyle: 'dots',
    });
    expect(html).toContain(color);
  });

  it('should support dots style', () => {
    const html = generateLoadingHtml({
      backgroundColor: '#18181b',
      progressBarColor: '#eab308',
      progressStyle: 'dots',
    });

    expect(html).toContain('dots');
    expect(html).toContain('dot');
  });

  it('should support none style', () => {
    const html = generateLoadingHtml({
      backgroundColor: '#ffffff',
      progressBarColor: '#000000',
      progressStyle: 'none',
    });

    expect(html).toContain('id="loading-screen"');
    expect(html).not.toContain('progress-bar');
    expect(html).not.toContain('spinner');
    expect(html).not.toContain('dots');
  });

  it('none style should not output progress bar or spinner HTML elements', () => {
    const html = generateLoadingHtml({
      backgroundColor: '#000000',
      progressBarColor: '#ffffff',
      progressStyle: 'none',
    });
    // The `none` style has no progress HTML at all — only the base CSS with .progress-text
    // class is still included in <style>, but no element renders it
    expect(html).not.toContain('progress-bar-container');
    expect(html).not.toContain('class="spinner"');
    expect(html).not.toContain('class="dots"');
  });

  it('should include fixed positioning for overlay', () => {
    const html = generateLoadingHtml({
      backgroundColor: '#000000',
      progressBarColor: '#6366f1',
      progressStyle: 'bar',
    });
    expect(html).toContain('position: fixed');
    expect(html).toContain('inset: 0');
  });

  it('should include z-index 9999 for loading screen', () => {
    const html = generateLoadingHtml({
      backgroundColor: '#000000',
      progressBarColor: '#6366f1',
      progressStyle: 'bar',
    });
    expect(html).toContain('z-index: 9999');
  });

  it('should include fade transition', () => {
    const html = generateLoadingHtml({
      backgroundColor: '#000000',
      progressBarColor: '#6366f1',
      progressStyle: 'bar',
    });
    expect(html).toContain('transition: opacity');
  });

  it('bar style includes progress-percent span', () => {
    const html = generateLoadingHtml({
      backgroundColor: '#000000',
      progressBarColor: '#6366f1',
      progressStyle: 'bar',
    });
    expect(html).toContain('id="progress-percent"');
  });

  it('spinner style includes spin animation', () => {
    const html = generateLoadingHtml({
      backgroundColor: '#000000',
      progressBarColor: '#3b82f6',
      progressStyle: 'spinner',
    });
    expect(html).toContain('@keyframes spin');
  });

  it('dots style includes bounce animation', () => {
    const html = generateLoadingHtml({
      backgroundColor: '#000000',
      progressBarColor: '#eab308',
      progressStyle: 'dots',
    });
    expect(html).toContain('@keyframes bounce');
  });
});

describe('generateLoadingScript', () => {
  it('should generate progress update script for bar style', () => {
    const script = generateLoadingScript('bar');

    expect(script).toContain('updateProgress');
    expect(script).toContain('progress-percent');
  });

  it('bar script simulates progressive loading up to 90%', () => {
    const script = generateLoadingScript('bar');
    expect(script).toContain('progress > 90');
    expect(script).toContain('setInterval');
  });

  it('bar script calls updateProgress(100) on engine ready', () => {
    const script = generateLoadingScript('bar');
    expect(script).toContain('updateProgress(100)');
    expect(script).toContain("forge:engine-ready");
  });

  it('bar script clears progress interval on engine ready', () => {
    const script = generateLoadingScript('bar');
    expect(script).toContain('clearInterval');
  });

  it('bar script fades out loading screen after engine ready', () => {
    const script = generateLoadingScript('bar');
    expect(script).toContain("getElementById('loading-screen')");
    expect(script).toContain("opacity = '0'");
  });

  it('should generate simple hide script for other styles', () => {
    const script = generateLoadingScript('spinner');

    expect(script).toContain('forge:engine-ready');
    expect(script).not.toContain('updateProgress');
  });

  it('dots style produces the simple hide script', () => {
    const script = generateLoadingScript('dots');
    expect(script).toContain("forge:engine-ready");
    expect(script).not.toContain('setInterval');
  });

  it('none style produces the simple hide script', () => {
    const script = generateLoadingScript('none');
    expect(script).toContain("forge:engine-ready");
    expect(script).not.toContain('setInterval');
  });

  it('simple hide script removes loading screen element after fade', () => {
    const script = generateLoadingScript('spinner');
    expect(script).toContain("getElementById('loading-screen')");
    expect(script).toContain('.remove()');
  });
});

// ── logo data URL security (Fix 2) ───────────────────────────────────────────

describe('generateLoadingHtml: logoDataUrl security', () => {
  it('throws when logoDataUrl is a javascript: URI', () => {
    expect(() =>
      generateLoadingHtml({
        backgroundColor: '#000000',
        progressBarColor: '#6366f1',
        progressStyle: 'bar',
        logoDataUrl: 'javascript:alert(1)',
      }),
    ).toThrow('Invalid logo data URL');
  });

  it('throws when logoDataUrl contains an attribute breakout payload', () => {
    expect(() =>
      generateLoadingHtml({
        backgroundColor: '#000000',
        progressBarColor: '#6366f1',
        progressStyle: 'bar',
        logoDataUrl: 'data:text/html,<script>alert(1)</script>',
      }),
    ).toThrow('Invalid logo data URL');
  });

  it('throws when logoDataUrl is a plain http URL', () => {
    expect(() =>
      generateLoadingHtml({
        backgroundColor: '#000000',
        progressBarColor: '#6366f1',
        progressStyle: 'bar',
        logoDataUrl: 'https://evil.com/img.png',
      }),
    ).toThrow('Invalid logo data URL');
  });

  it('accepts data:image/png URLs', () => {
    expect(() =>
      generateLoadingHtml({
        backgroundColor: '#000000',
        progressBarColor: '#6366f1',
        progressStyle: 'bar',
        logoDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      }),
    ).not.toThrow();
  });

  it('accepts data:image/jpeg URLs', () => {
    expect(() =>
      generateLoadingHtml({
        backgroundColor: '#000000',
        progressBarColor: '#6366f1',
        progressStyle: 'bar',
        logoDataUrl: 'data:image/jpeg;base64,/9j/4AAQ=',
      }),
    ).not.toThrow();
  });

  it('accepts data:image/svg+xml URLs', () => {
    expect(() =>
      generateLoadingHtml({
        backgroundColor: '#000000',
        progressBarColor: '#6366f1',
        progressStyle: 'bar',
        logoDataUrl: 'data:image/svg+xml;base64,PHN2Zy8+',
      }),
    ).not.toThrow();
  });

  it('escapes double-quote in logoDataUrl to prevent attribute breakout', () => {
    const logoDataUrl = 'data:image/png;base64,abc" onload="alert(1)';
    const html = generateLoadingHtml({
      backgroundColor: '#000000',
      progressBarColor: '#6366f1',
      progressStyle: 'bar',
      logoDataUrl,
    });
    expect(html).not.toContain('" onload="alert(1)');
    expect(html).toContain('&quot;');
  });

  it('does not include img tag when logoDataUrl is undefined', () => {
    const html = generateLoadingHtml({
      backgroundColor: '#000000',
      progressBarColor: '#6366f1',
      progressStyle: 'bar',
    });
    expect(html).not.toContain('<img');
  });
});