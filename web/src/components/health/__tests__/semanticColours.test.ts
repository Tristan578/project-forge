// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const palette = /(?:bg|text|border|ring|fill|stroke|from|via|to)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]+|(?:bg|text|border|ring|fill|stroke)-(?:white|black)\b|(?:bg|text|border|ring|fill|stroke)-\[(?:#|rgb|hsl)/g;

describe('health and docs semantic colour guard', () => {
  it.each(['src/components/health/ServiceStatusCard.tsx', 'src/components/docs/DocsPage.tsx'])('%s has no literal palette colours', (file) => {
    const source = readFileSync(resolve(process.cwd(), file), 'utf8');
    expect(source.match(palette)).toBeNull();
  });
  it.each(['dark:bg-zinc-800', 'hover:text-blue-400', 'border-white', 'text-[#fff]', 'ring-[rgb(1,2,3)]'])('rejects %s', (fixture) => {
    expect(fixture.match(palette)).not.toBeNull();
  });
  it('allows semantic colours with state and opacity modifiers', () => {
    expect('hover:bg-[var(--sf-bg-elevated)]/50 text-[var(--sf-text)]'.match(palette)).toBeNull();
  });
});
