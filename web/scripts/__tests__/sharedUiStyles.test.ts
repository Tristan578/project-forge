/** Production CSS must contain the shared Button's interaction utilities. */
// @vitest-environment node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';
import { expect, it } from 'vitest';

it('emits shared Button outline, pressed and disabled styles', async () => {
  const webRoot = path.resolve(__dirname, '../..');
  const cssPath = path.join(webRoot, 'src/app/globals.css');
  const result = await postcss([tailwindcss({ base: webRoot })]).process(
    await readFile(cssPath, 'utf8'), { from: cssPath },
  );
  const rules = new Map<string, string[]>();
  result.root.walkRules((rule) => {
    const declarations: string[] = [];
    rule.walkDecls((declaration) => {
      declarations.push((declaration.prop + ':' + declaration.value).replace(/\s/g, ''));
    });
    const selector = rule.selector.replaceAll('\\', '');
    rules.set(selector, [...(rules.get(selector) ?? []), ...declarations]);
  });
  expect(rules.get('.disabled:pointer-events-none:disabled')).toContain('pointer-events:none');
  expect(rules.get('.disabled:shadow-none:disabled')).toContain('--tw-shadow:0 0 #0000'.replace(/\s/g, ''));
  expect(rules.get('.active:scale-[0.97]:active')).toContain('scale:0.97');
  expect(rules.get('.shadow-[0_1px_2px_rgba(0,0,0,0.2)]')).toContain('--tw-shadow:01px2pxvar(--tw-shadow-color,rgba(0,0,0,0.2))');
  expect(rules.get('.focus-visible:ring-2:focus-visible')).toContain('--tw-ring-shadow:var(--tw-ring-inset,)000calc(2px+var(--tw-ring-offset-width))var(--tw-ring-color,currentcolor)');
});
