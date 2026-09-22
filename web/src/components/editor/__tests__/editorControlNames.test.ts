// @vitest-environment node
/**
 * Every colour, range and select control in the editor has an accessible
 * name (#9677, acceptance criterion 1).
 *
 * The E2E axe audit only sees controls that are rendered when it runs, and
 * most editor controls are behind a toggle: a post-processing effect that is
 * off, a spot-only light setting, a collapsed material section. So this suite
 * reads the JSX instead of the DOM (see `controlNameScan.ts`) and fails on any
 * `<input type="color">`, `<input type="range">` or `<select>` under
 * `src/components/editor/` that nothing names, rendered or not.
 *
 * The first block proves the scanner can tell named from unnamed on synthetic
 * sources — without it, "every control is named" could be a scanner that
 * never finds a problem (lessons-learned #11 / #16).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { scanControls, type ControlFinding } from './controlNameScan';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EDITOR_DIR = path.resolve(HERE, '..');
const WEB_ROOT = path.resolve(EDITOR_DIR, '../../..');

/** Wrap a JSX fragment in a component so it parses as a real module. */
function component(jsx: string, preamble = ''): string {
  return `import { useId } from 'react';\nexport function Panel() {\n${preamble}\n  return (<div>${jsx}</div>);\n}\n`;
}

function only(findings: ControlFinding[]): ControlFinding {
  expect(findings).toHaveLength(1);
  return findings[0];
}

describe('scanControls — synthetic sources', () => {
  it('flags an unnamed colour input, range input and select', () => {
    const findings = scanControls(
      'x.tsx',
      component(`
        <label>Color</label><input type="color" value="#fff" />
        <label>Size</label><input type="range" min={0} max={1} />
        <label>Mode</label><select value="a"><option>a</option></select>
      `),
    );
    expect(findings.map((f) => [f.kind, f.namedBy])).toEqual([
      ['input[type=color]', null],
      ['input[type=range]', null],
      ['select', null],
    ]);
  });

  it('ignores inputs that are not colour or range', () => {
    const findings = scanControls(
      'x.tsx',
      component('<input type="text" /><input type="number" /><input type="checkbox" /><input />'),
    );
    expect(findings).toEqual([]);
  });

  it('reads the type through a conditional expression', () => {
    const f = only(scanControls('x.tsx', component(`<input type={isColor ? 'color' : 'text'} />`, 'const isColor = true;')));
    expect(f.kind).toBe('input[type=color]');
    expect(f.namedBy).toBeNull();
  });

  it('accepts a literal or expression aria-label, and aria-labelledby', () => {
    const findings = scanControls(
      'x.tsx',
      component(`
        <input type="color" aria-label="Fog color" />
        <input type="range" aria-label={\`\${axis} offset\`} />
        <select aria-labelledby={headingId}><option>a</option></select>
      `, 'const axis = "X"; const headingId = useId();'),
    );
    expect(findings.map((f) => f.namedBy)).toEqual(['aria-label', 'aria-label', 'aria-labelledby']);
  });

  it('does not accept an empty, undefined or boolean aria-label', () => {
    const findings = scanControls(
      'x.tsx',
      component(`
        <input type="color" aria-label="" />
        <input type="color" aria-label={undefined} />
        <input type="color" aria-label />
        <input type="color" aria-label={null} />
      `),
    );
    expect(findings.map((f) => f.namedBy)).toEqual([null, null, null, null]);
  });

  it('does not accept title or placeholder as a name', () => {
    const f = only(scanControls('x.tsx', component('<input type="range" title="Volume" placeholder="Volume" />')));
    expect(f.namedBy).toBeNull();
  });

  it('pairs an id with a label htmlFor in the same component', () => {
    const f = only(
      scanControls(
        'x.tsx',
        component(
          '<label htmlFor={fogId}>Fog</label><input id={fogId} type="color" />',
          'const fogId = useId();',
        ),
      ),
    );
    expect(f).toMatchObject({ namedBy: 'label[for]', literalId: false });
  });

  it('pairs helper-call ids by source text', () => {
    const f = only(
      scanControls(
        'x.tsx',
        component(
          `<label htmlFor={fieldId('fog-color')}>Fog</label><input id={fieldId( 'fog-color' )} type="color" />`,
          'const base = useId(); const fieldId = (k: string) => `${base}-${k}`;',
        ),
      ),
    );
    expect(f.namedBy).toBe('label[for]');
  });

  it('does not pair an id with a label pointing somewhere else', () => {
    const f = only(
      scanControls(
        'x.tsx',
        component(
          '<label htmlFor={otherId}>Fog</label><input id={fogId} type="color" />',
          'const fogId = useId(); const otherId = useId();',
        ),
      ),
    );
    expect(f.namedBy).toBeNull();
  });

  it('does not pair an id with a label in a different top-level component', () => {
    const src =
      `export function A() { return <label htmlFor={id}>Fog</label>; }\n` +
      `export function B({ id }: { id: string }) { return <input id={id} type="range" />; }\n`;
    expect(only(scanControls('x.tsx', src)).namedBy).toBeNull();
  });

  it('accepts a wrapping label only when it has text of its own', () => {
    const findings = scanControls(
      'x.tsx',
      component(`
        <label>Volume <input type="range" /></label>
        <label>{name}<select><option>a</option></select></label>
        <label><input type="color" /></label>
      `, 'const name = "Mode";'),
    );
    expect(findings.map((f) => f.namedBy)).toEqual(['wrapping label', 'wrapping label', null]);
  });

  it('reports a string-literal id pairing', () => {
    const f = only(
      scanControls('x.tsx', component('<label htmlFor="fog">Fog</label><input id="fog" type="color" />')),
    );
    expect(f).toMatchObject({ namedBy: 'label[for]', literalId: true });
  });

  it('reports 1-based source lines', () => {
    const src = component('\n<input type="color" />');
    const f = only(scanControls('x.tsx', src));
    const expectedLine = src.split('\n').findIndex((l) => l.includes('type="color"')) + 1;
    expect(f.line).toBe(expectedLine);
  });
});

/** Every non-test TSX source under src/components/editor/. */
function editorSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === '__fixtures__') continue;
      editorSources(full, out);
    } else if (entry.endsWith('.tsx') && !entry.endsWith('.test.tsx') && !entry.endsWith('.stories.tsx')) {
      out.push(full);
    }
  }
  return out;
}

const files = editorSources(EDITOR_DIR);
const findings: ControlFinding[] = files.flatMap((file) =>
  scanControls(path.relative(WEB_ROOT, file).split(path.sep).join('/'), readFileSync(file, 'utf8')),
);

function listing(items: ControlFinding[]): string {
  return items.map((f) => `  ${f.file}:${f.line} ${f.kind}`).join('\n');
}

describe('editor colour/range/select controls (#9677)', () => {
  it('walks the editor tree and finds its controls', () => {
    // A walk that finds nothing would pass the naming check vacuously
    // (lessons-learned #9). SceneSettings is the file the issue was raised
    // against; if the scan cannot see its ~40 controls it is not scanning.
    expect(files.length).toBeGreaterThan(50);
    const sceneSettings = findings.filter((f) => f.file === 'src/components/editor/SceneSettings.tsx');
    expect(sceneSettings.length).toBeGreaterThanOrEqual(40);
    const kinds = new Set(findings.map((f) => f.kind));
    expect([...kinds].sort()).toEqual(['input[type=color]', 'input[type=range]', 'select']);
  });

  it('gives every control an accessible name', () => {
    const unnamed = findings.filter((f) => f.namedBy === null);
    expect(
      unnamed,
      `Unnamed editor controls — add a <label htmlFor> pointing at a useId() id, or an aria-label:\n${listing(unnamed)}`,
    ).toEqual([]);
  });

  it('never pairs a control with its label through a hard-coded id', () => {
    // Editor panels can mount more than once, and a literal id then repeats:
    // the second <label for> resolves to the first panel's control. useId()
    // is unique per mount.
    const literal = findings.filter((f) => f.literalId);
    expect(literal, `Controls labelled through a string-literal id — use useId():\n${listing(literal)}`).toEqual([]);
  });
});
