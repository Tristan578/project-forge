import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('globals.css reduced-motion', () => {
  const css = readFileSync(resolve(__dirname, '../globals.css'), 'utf-8');

  it('contains prefers-reduced-motion media query', () => {
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('reduces animation-duration for non-essential elements', () => {
    expect(css).toContain('animation-duration: 0.01ms !important');
  });

  it('reduces transition-duration for non-essential elements', () => {
    expect(css).toContain('transition-duration: 0.01ms !important');
  });

  it('exempts progressbar elements from reduced motion', () => {
    expect(css).toContain(':not([role="progressbar"])');
  });

  it('exempts data-essential-animation elements from reduced motion', () => {
    expect(css).toContain(':not([data-essential-animation])');
  });
});
