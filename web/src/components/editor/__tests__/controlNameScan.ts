/**
 * Static accessible-name scan for the editor's colour, range and select
 * controls (#9677).
 *
 * axe only audits what is in the DOM when it runs. Most editor controls sit
 * behind a toggle — a disabled post-processing effect, an unselected light
 * type, a collapsed section — so an E2E axe pass sees a fraction of them and a
 * regression in an unrendered branch ships green. This scan reads the JSX
 * instead, so every `<input type="color">`, `<input type="range">` and
 * `<select>` under `src/components/editor/` is checked whether or not a test
 * happens to render it.
 *
 * A control counts as named when it carries one of:
 *   - a non-empty `aria-label` or `aria-labelledby`;
 *   - an `id` that a `<label htmlFor>` in the same top-level declaration
 *     points at (compared as source text, so `id={ids.color}` pairs with
 *     `htmlFor={ids.color}`);
 *   - a wrapping `<label>` that has text of its own.
 *
 * `title` and `placeholder` are deliberately NOT accepted: axe tolerates them,
 * but a tooltip is not a label, and accepting it would let the scan pass
 * controls a screen reader announces only on hover-equivalent paths.
 *
 * The runtime half of the guarantee — that the id pairing actually resolves
 * in a rendered tree — is covered by the jest-axe suites for SceneSettings,
 * LightInspector and MaterialInspector.
 */

import ts from 'typescript';

/** The control shapes axe's `label` and `select-name` rules flag. */
export type ControlKind = 'input[type=color]' | 'input[type=range]' | 'select';

/** How a control gets its accessible name. */
export type NamedBy = 'aria-label' | 'aria-labelledby' | 'label[for]' | 'wrapping label';

/** One colour/range/select control found in a source file. */
export interface ControlFinding {
  file: string;
  /** 1-based line of the control's opening tag. */
  line: number;
  kind: ControlKind;
  /** How the control is named, or null when nothing names it. */
  namedBy: NamedBy | null;
  /**
   * True when the control is paired with its label through a string-literal
   * `id`. Editor panels mount more than once (desktop dock plus compact
   * drawer, several inspectors of one type), so a literal id duplicates and
   * the second `<label for>` resolves to the first panel's control.
   */
  literalId: boolean;
}

type Opening = ts.JsxOpeningElement | ts.JsxSelfClosingElement;

function isOpening(node: ts.Node): node is Opening {
  return ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node);
}

function tagName(node: Opening, sf: ts.SourceFile): string {
  return node.tagName.getText(sf);
}

function findAttr(node: Opening, name: string, sf: ts.SourceFile): ts.JsxAttribute | undefined {
  for (const prop of node.attributes.properties) {
    if (ts.isJsxAttribute(prop) && prop.name.getText(sf) === name) return prop;
  }
  return undefined;
}

/** Every string literal reachable in an attribute value, e.g. both arms of a ternary. */
function literalStrings(expr: ts.Node): string[] {
  const out: string[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) out.push(n.text);
    ts.forEachChild(n, visit);
  };
  visit(expr);
  return out;
}

/**
 * Whether an attribute carries a usable value. A bare boolean attribute, an
 * empty string, `{undefined}` or `{null}` does not name anything.
 */
function hasValue(attr: ts.JsxAttribute | undefined): boolean {
  if (!attr || !attr.initializer) return false;
  const init = attr.initializer;
  if (ts.isStringLiteral(init)) return init.text.trim().length > 0;
  if (ts.isJsxExpression(init)) {
    const expr = init.expression;
    if (!expr) return false;
    if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
      return expr.text.trim().length > 0;
    }
    if (expr.kind === ts.SyntaxKind.NullKeyword) return false;
    if (ts.isIdentifier(expr) && expr.text === 'undefined') return false;
    return true;
  }
  return false;
}

/** Comparable key for an `id` / `htmlFor` value; source text with whitespace removed. */
function valueKey(attr: ts.JsxAttribute, sf: ts.SourceFile): string | null {
  const init = attr.initializer;
  if (!init) return null;
  if (ts.isStringLiteral(init)) return `"${init.text}"`;
  if (ts.isJsxExpression(init) && init.expression) {
    const expr = init.expression;
    if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return `"${expr.text}"`;
    return expr.getText(sf).replace(/\s+/g, '');
  }
  return null;
}

function isLiteralValue(attr: ts.JsxAttribute): boolean {
  const init = attr.initializer;
  if (!init) return false;
  if (ts.isStringLiteral(init)) return true;
  return (
    ts.isJsxExpression(init) &&
    !!init.expression &&
    (ts.isStringLiteral(init.expression) || ts.isNoSubstitutionTemplateLiteral(init.expression))
  );
}

/** The statement directly under the SourceFile that contains `node`. */
function topLevelStatement(node: ts.Node): ts.Node {
  let cur = node;
  while (cur.parent && !ts.isSourceFile(cur.parent)) cur = cur.parent;
  return cur;
}

/** Whether a `<label>` element has text of its own besides `exclude`'s subtree. */
function labelHasText(label: ts.JsxElement, exclude: ts.Node): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found || n === exclude) return;
    if (ts.isJsxText(n) && n.text.trim().length > 0) {
      found = true;
      return;
    }
    if (ts.isJsxExpression(n) && n.expression && !ts.isJsxElement(n.expression) && !ts.isJsxSelfClosingElement(n.expression)) {
      // `{name}` / `{t('label')}` / `{`${axis} value`}` render text.
      if (!(ts.isIdentifier(n.expression) && n.expression.text === 'undefined')) {
        found = true;
        return;
      }
    }
    ts.forEachChild(n, visit);
  };
  for (const child of label.children) visit(child);
  return found;
}

function wrappingLabel(control: Opening, sf: ts.SourceFile): ts.JsxElement | null {
  // For a JsxOpeningElement the element itself is the parent; start above it.
  const self: ts.Node = ts.isJsxOpeningElement(control) ? control.parent : control;
  let cur: ts.Node | undefined = self.parent;
  while (cur && !ts.isSourceFile(cur)) {
    if (ts.isJsxElement(cur) && tagName(cur.openingElement, sf) === 'label') return cur;
    // Stop at a function boundary: a label in an outer component does not
    // wrap a control rendered by a callback that runs elsewhere.
    if (ts.isFunctionLike(cur) && !ts.isArrowFunction(cur)) break;
    cur = cur.parent;
  }
  return null;
}

function controlKind(node: Opening, sf: ts.SourceFile): ControlKind | null {
  const tag = tagName(node, sf);
  if (tag === 'select') return 'select';
  if (tag !== 'input') return null;
  const typeAttr = findAttr(node, 'type', sf);
  if (!typeAttr?.initializer) return null;
  const values = literalStrings(typeAttr.initializer);
  if (values.includes('color')) return 'input[type=color]';
  if (values.includes('range')) return 'input[type=range]';
  return null;
}

/**
 * Scan one TSX source for colour/range/select controls and how each is named.
 * @param file Path used in findings (repo-relative for readable failures).
 * @param text The TSX source.
 * @returns One finding per control, in source order.
 */
export function scanControls(file: string, text: string): ControlFinding[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  // Pass 1: every `<label htmlFor>` key, grouped by top-level declaration.
  const labelKeys = new Map<ts.Node, Set<string>>();
  const collectLabels = (n: ts.Node): void => {
    if (isOpening(n) && tagName(n, sf) === 'label') {
      const htmlFor = findAttr(n, 'htmlFor', sf);
      const key = htmlFor ? valueKey(htmlFor, sf) : null;
      if (key) {
        const scope = topLevelStatement(n);
        let keys = labelKeys.get(scope);
        if (!keys) {
          keys = new Set();
          labelKeys.set(scope, keys);
        }
        keys.add(key);
      }
    }
    ts.forEachChild(n, collectLabels);
  };
  collectLabels(sf);

  // Pass 2: every control, and the first mechanism that names it.
  const findings: ControlFinding[] = [];
  const visit = (n: ts.Node): void => {
    if (isOpening(n)) {
      const kind = controlKind(n, sf);
      if (kind) {
        let namedBy: NamedBy | null = null;
        let literalId = false;
        if (hasValue(findAttr(n, 'aria-label', sf))) namedBy = 'aria-label';
        else if (hasValue(findAttr(n, 'aria-labelledby', sf))) namedBy = 'aria-labelledby';
        if (!namedBy) {
          const idAttr = findAttr(n, 'id', sf);
          const key = idAttr ? valueKey(idAttr, sf) : null;
          if (idAttr && key && labelKeys.get(topLevelStatement(n))?.has(key)) {
            namedBy = 'label[for]';
            literalId = isLiteralValue(idAttr);
          }
        }
        if (!namedBy) {
          const label = wrappingLabel(n, sf);
          const controlNode = ts.isJsxOpeningElement(n) ? n.parent : n;
          if (label && labelHasText(label, controlNode)) namedBy = 'wrapping label';
        }
        const { line } = sf.getLineAndCharacterOfPosition(n.getStart(sf));
        findings.push({ file, line: line + 1, kind, namedBy, literalId });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return findings;
}
