/**
 * Test helpers that prove a component is built from the design system: its
 * controls come from `@spawnforge/ui`, and every colour it names is a
 * `var(--sf-*)` theme token rather than a fixed palette value.
 *
 * Both halves exist because each covers what the other cannot. A DOM walk only
 * sees the branches a test renders, so a colour hardcoded in an unrendered
 * branch goes unnoticed; the source scan covers every branch. The source scan
 * cannot tell a library `<Button>` from a look-alike, so the primitive tags
 * cover that in the rendered DOM.
 */
import { createElement, type ComponentType } from 'react';

/** The attribute each tagged primitive adds to the element it renders. */
export const PRIMITIVE_ATTR = 'data-sf-primitive';

/** The primitives `tagUiPrimitives` wraps. */
export const TAGGED_PRIMITIVES = ['Button', 'Input', 'Select', 'Progress', 'Label', 'InlineAlert'] as const;

/**
 * Wrap the design-library primitives so each one marks the element it renders
 * with `data-sf-primitive="<Name>"`. Call it from a `vi.mock` factory:
 *
 *   vi.mock('@spawnforge/ui', async (importOriginal) =>
 *     (await import('@/test/utils/designSystemAudit')).tagUiPrimitives(await importOriginal()));
 *
 * Each wrapper renders the real library component. Every primitive listed in
 * TAGGED_PRIMITIVES spreads its remaining props onto its root element (the
 * native button, input, select or label, or the progressbar and alert div), so
 * the attribute lands on the element a role or label query returns. React 19
 * passes `ref` as an ordinary prop, so refs reach the library component too.
 */
export function tagUiPrimitives<T>(actual: T): T {
  const lib = actual as Record<string, unknown>;
  const out: Record<string, unknown> = { ...lib };
  for (const name of TAGGED_PRIMITIVES) {
    const Component = lib[name] as ComponentType<Record<string, unknown>> | undefined;
    if (!Component) throw new Error(`@spawnforge/ui no longer exports ${name}; update TAGGED_PRIMITIVES`);
    const Tagged = (props: Record<string, unknown>) => createElement(Component, { ...props, [PRIMITIVE_ATTR]: name });
    Tagged.displayName = `Tagged(${name})`;
    out[name] = Tagged;
  }
  return out as T;
}

const PALETTES = [
  'slate', 'gray', 'zinc', 'neutral', 'stone', 'red', 'orange', 'amber',
  'yellow', 'lime', 'green', 'emerald', 'teal', 'cyan', 'sky', 'blue',
  'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose', 'white', 'black',
];
const UTILITIES = [
  'bg', 'text', 'border', 'ring', 'fill', 'stroke', 'from', 'via', 'to',
  'outline', 'divide', 'placeholder', 'shadow', 'accent', 'caret', 'decoration',
];

/** A Tailwind palette colour class, e.g. `text-gray-400`, `hover:bg-blue-500/50`, `text-white`. */
const PALETTE_CLASS = new RegExp(
  `(?:^|[\\s"'\`:])(?:${UTILITIES.join('|')})-(?:${PALETTES.join('|')})` +
    `(?:-\\d{2,3})?(?:/\\d{1,3})?(?![\\w-])`,
);

/** A colour written as a string literal: `'#4ade80'`, `"rgb(…"`, `` `hsl(…` ``, `'oklch(…'`. */
const QUOTED_COLOUR = /['"`](?:#[0-9a-fA-F]{3,8}['"`]|(?:rgba?|hsla?|oklch)\()/;

/** A raw form control or button element in JSX, where a library primitive exists. */
const RAW_CONTROL = /<(?:button|input|select|textarea|progress)\b/;

/**
 * Lines are skipped only by their LEADING token (`//`, `/*`, `*`, `{/*`). A
 * className or JSX element cannot start a line that way, so this cannot hide a
 * real class; it spares prose that names the literal it replaced.
 */
function codeLines(source: string): Array<readonly [number, string]> {
  const lines = source.split('\n').map((line, i) => [i + 1, line] as const);
  if (lines.length < 2) throw new Error('designSystemAudit: source is empty — the scan would pass vacuously');
  return lines.filter(([, line]) => {
    const t = line.trimStart();
    return !(t.startsWith('//') || t.startsWith('/*') || t.startsWith('*') || t.startsWith('{/*'));
  });
}

/** Every code line that names a colour without a `var(--sf-*)` token, as `line: text`. */
export function findColourLiterals(source: string): string[] {
  return codeLines(source)
    .filter(([, line]) => PALETTE_CLASS.test(line) || QUOTED_COLOUR.test(line))
    .map(([n, line]) => `${n}: ${line.trim()}`);
}

/** Every code line that renders a raw `<button>`/`<input>`/`<select>`/`<textarea>`/`<progress>`. */
export function findRawControls(source: string): string[] {
  return codeLines(source)
    .filter(([, line]) => RAW_CONTROL.test(line))
    .map(([n, line]) => `${n}: ${line.trim()}`);
}

/** Every interactive control, and every progressbar, under `root`, in document order. */
export function controlsIn(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('button, input, select, textarea, [role="progressbar"]'));
}

/** The library primitive a control must come from, by its tag or role. */
export function expectedPrimitive(el: Element): string {
  if (el.getAttribute('role') === 'progressbar') return 'Progress';
  switch (el.tagName) {
    case 'BUTTON':
      return 'Button';
    case 'INPUT':
      return 'Input';
    case 'SELECT':
      return 'Select';
    default:
      return `<no primitive for ${el.tagName.toLowerCase()}>`;
  }
}

/**
 * True when the control keeps a 44px minimum height at the base (mobile)
 * breakpoint: it carries `min-h-[44px]` and no other unprefixed `min-h-*` that
 * would override it. jsdom has no layout, so this is the class that produces
 * the height, not a measured height.
 */
export function hasMobileTouchTarget(el: Element): boolean {
  const base = Array.from(el.classList).filter((c) => c.startsWith('min-h-'));
  return base.length === 1 && base[0] === 'min-h-[44px]';
}
