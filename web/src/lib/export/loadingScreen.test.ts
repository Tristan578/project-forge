import { describe, it, expect } from 'vitest';
import { generateLoadingHtml, generateLoadingScript } from './loadingScreen';

describe('loadingScreen', () => {
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

  it('should generate progress update script for bar style', () => {
    const script = generateLoadingScript('bar');

    expect(script).toContain('updateProgress');
    expect(script).toContain('progress-percent');
  });

  it('should generate simple hide script for other styles', () => {
    const script = generateLoadingScript('spinner');

    expect(script).toContain('forge:engine-ready');
    expect(script).not.toContain('updateProgress');
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
});
