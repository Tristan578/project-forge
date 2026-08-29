import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

function customProperties(css: string): Set<string> {
  return new Set(Array.from(css.matchAll(/--dv-[a-z0-9-]+/g), match => match[0]));
}

describe('dockview CSS custom-property contract', () => {
  it('only authors properties consumed by the installed dockview stylesheet', () => {
    const authoredCss = readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf8');
    const dockviewCss = readFileSync(
      require.resolve('dockview/dist/styles/dockview.css'),
      'utf8',
    );
    const authored = customProperties(authoredCss);
    const consumed = customProperties(dockviewCss);

    expect(authored.size).toBeGreaterThan(0);
    expect([...authored].filter(property => !consumed.has(property))).toEqual([]);
  });
});
