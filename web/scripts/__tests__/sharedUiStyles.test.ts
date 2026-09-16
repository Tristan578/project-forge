/** Production CSS must include utilities declared in the shared UI package. */
// @vitest-environment node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';
import { expect, it } from 'vitest';

it('emits all InlineAlert severity backgrounds and borders for the web app', async () => {
  const webRoot = path.resolve(__dirname, '../..');
  const cssPath = path.join(webRoot, 'src/app/globals.css');
  const result = await postcss([tailwindcss({ base: webRoot })]).process(
    await readFile(cssPath, 'utf8'), { from: cssPath },
  );
  const declarations: string[] = [];
  result.root.walkDecls((declaration) => {
    declarations.push((declaration.prop + ':' + declaration.value).replace(/\s/g, ''));
  });
  for (const token of ['--sf-warning', '--sf-destructive', '--sf-accent']) {
    expect(declarations).toContain(
      'background-color:color-mix(insrgb,var(' + token + ')12%,var(--sf-bg-surface))',
    );
    expect(declarations).toContain(
      'border-color:color-mix(insrgb,var(' + token + ')40%,transparent)',
    );
  }
});
