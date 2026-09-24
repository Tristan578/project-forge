/**
 * Static accessible-name scan for the editor's colour, range and select
 * controls, and for the `<label for>` pairings that name them (#9677).
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
 *     `htmlFor={ids.color}`), where the label renders — and points at that
 *     id — whenever the control renders;
 *   - a wrapping `<label>` that has text of its own.
 *
 * `title` and `placeholder` are deliberately NOT accepted: axe tolerates them,
 * but a tooltip is not a label, and accepting it would let the scan pass
 * controls a screen reader announces only on hover-equivalent paths.
 *
 * The opposite direction is checked too (`scanLabels`): HTML requires a
 * label's `for` to be the id of a labelable element in the same tree, so a
 * `<label htmlFor>` must not point at a control that renders only some of the
 * time. `<label htmlFor={id}>` beside `{finite && <input id={id} />}` names
 * nothing whenever `finite` is false. The fix is to point the label only when
 * the control is there — `htmlFor={finite ? id : undefined}` — which this scan
 * recognises.
 *
 * "Renders whenever" is judged from render guards (see `renderGuards`): the
 * `cond ? a : b`, `cond && a`, `cond || a`, `cond ?? a`, `if` and `switch`
 * arms an element sits in, plus each callback body (a `.map` row renders zero
 * or more times). Guards are compared by source text, so two guards match
 * only when their conditions are spelled identically. That is deliberately
 * conservative: a pairing the scan cannot prove is reported, not assumed.
 * What it cannot see: an early `return` that renders the label without the
 * control. The runtime half of the guarantee — that pairings resolve in a
 * rendered tree — is covered by the jest-axe suites for SceneSettings,
 * LightInspector and MaterialInspector, which also walk every `label[for]`.
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

/**
 * Why a `<label htmlFor>` can end up naming nothing:
 * - `no-target`: no element in the same top-level declaration carries the id;
 * - `not-labelable`: only elements HTML cannot label (a `<div>`, a hidden
 *   input) carry it;
 * - `conditional-target`: a labelable element carries it, but only under a
 *   render guard the label's `for` is not under, so in some state the label
 *   points at nothing.
 */
export type LabelProblem = 'no-target' | 'not-labelable' | 'conditional-target';

/** One `<label htmlFor>` found in a source file. */
export interface LabelFinding {
  file: string;
  /** 1-based line of the label's opening tag. */
  line: number;
  /** Source text of the `htmlFor` value. */
  htmlFor: string;
  /** What is wrong with the pairing, or null when the target always renders with it. */
  problem: LabelProblem | null;
}

type Opening = ts.JsxOpeningElement | ts.JsxSelfClosingElement;

/** One id a `<label htmlFor>` can point at, and the guards it points under. */
interface LabelArm {
  key: string;
  guards: Set<string>;
}

/** An element carrying an `id`, and the guards it renders under. */
interface IdHolder {
  key: string;
  guards: Set<string>;
  labelable: boolean;
}

/** Intrinsic elements HTML lets a `<label>` name (the "labelable" category). */
const LABELABLE_TAGS = new Set(['button', 'input', 'meter', 'output', 'progress', 'select', 'textarea']);

function isOpening(node: ts.Node): node is Opening {
  return ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node);
}

function tagName(node: Opening, sf: ts.SourceFile): string {
  return node.tagName.getText(sf);
}

/** The whole element for an opening tag: the JsxElement, or the self-closing tag itself. */
function elementOf(node: Opening): ts.Node {
  return ts.isJsxOpeningElement(node) ? node.parent : node;
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

function unparen(expr: ts.Expression): ts.Expression {
  let cur = expr;
  while (ts.isParenthesizedExpression(cur)) cur = cur.expression;
  return cur;
}

/** `undefined`, `null` or an empty string: a value that sets no id / no `for`. */
function isNothing(expr: ts.Expression): boolean {
  if (expr.kind === ts.SyntaxKind.NullKeyword) return true;
  if (ts.isIdentifier(expr) && expr.text === 'undefined') return true;
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return expr.text.trim().length === 0;
  return false;
}

/** Source text with whitespace removed, so formatting never splits a match. */
function compact(node: ts.Node, sf: ts.SourceFile): string {
  return node.getText(sf).replace(/\s+/g, '');
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
    return !isNothing(unparen(expr));
  }
  return false;
}

/** Comparable key for an id expression: a quoted literal, or compacted source text. */
function exprKey(expr: ts.Expression, sf: ts.SourceFile): string {
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return `"${expr.text}"`;
  return compact(expr, sf);
}

/** Comparable key for an `id` value, or null when it sets no id. */
function valueKey(attr: ts.JsxAttribute, sf: ts.SourceFile): string | null {
  const init = attr.initializer;
  if (!init) return null;
  if (ts.isStringLiteral(init)) return init.text.trim() ? `"${init.text}"` : null;
  if (ts.isJsxExpression(init) && init.expression) {
    const expr = unparen(init.expression);
    return isNothing(expr) ? null : exprKey(expr, sf);
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

/**
 * The render guards `node` sits under, as comparable strings: every
 * conditional arm (`cond ? a : b`, `cond && a`, `cond || a`, `cond ?? a`),
 * `if` / `switch` branch and callback body between it and the file root.
 * Conditions are keyed by compacted source text; callbacks by position, since
 * two callbacks are never the same render pass.
 */
function renderGuards(node: ts.Node, sf: ts.SourceFile): Set<string> {
  const guards = new Set<string>();
  let child = node;
  let parent = node.parent;
  while (parent && !ts.isSourceFile(parent)) {
    if (ts.isConditionalExpression(parent)) {
      if (child === parent.whenTrue) guards.add(`true:${compact(parent.condition, sf)}`);
      else if (child === parent.whenFalse) guards.add(`false:${compact(parent.condition, sf)}`);
    } else if (ts.isBinaryExpression(parent) && child === parent.right) {
      const op = parent.operatorToken.kind;
      if (op === ts.SyntaxKind.AmpersandAmpersandToken) guards.add(`true:${compact(parent.left, sf)}`);
      else if (op === ts.SyntaxKind.BarBarToken) guards.add(`false:${compact(parent.left, sf)}`);
      else if (op === ts.SyntaxKind.QuestionQuestionToken) guards.add(`nullish:${compact(parent.left, sf)}`);
    } else if (ts.isIfStatement(parent)) {
      if (child === parent.thenStatement) guards.add(`true:${compact(parent.expression, sf)}`);
      else if (child === parent.elseStatement) guards.add(`false:${compact(parent.expression, sf)}`);
    } else if (ts.isCaseClause(parent) || ts.isDefaultClause(parent)) {
      const subject = compact(parent.parent.parent.expression, sf);
      guards.add(ts.isCaseClause(parent) ? `case:${subject}=${compact(parent.expression, sf)}` : `default:${subject}`);
    } else if (ts.isFunctionLike(parent)) {
      guards.add(`fn:${parent.getStart(sf)}`);
    }
    child = parent;
    parent = parent.parent;
  }
  return guards;
}

function isSubset(a: Set<string>, b: Set<string>): boolean {
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

/**
 * The ids a `<label htmlFor>` points at, each with the guards it points under:
 * the label's own render guards, plus the arm of a `cond ? id : undefined`
 * value. An arm that sets no `for` is dropped — the label then names nothing,
 * which is valid HTML.
 */
function labelArms(label: Opening, htmlFor: ts.JsxAttribute, sf: ts.SourceFile): LabelArm[] {
  const base = renderGuards(elementOf(label), sf);
  const init = htmlFor.initializer;
  if (!init) return [];
  if (ts.isStringLiteral(init)) return init.text.trim() ? [{ key: `"${init.text}"`, guards: base }] : [];
  if (!ts.isJsxExpression(init) || !init.expression) return [];
  const expr = unparen(init.expression);
  if (ts.isConditionalExpression(expr)) {
    const cond = compact(expr.condition, sf);
    const arms: LabelArm[] = [];
    for (const [value, arm] of [[expr.whenTrue, 'true'], [expr.whenFalse, 'false']] as const) {
      const v = unparen(value);
      if (isNothing(v)) continue;
      arms.push({ key: exprKey(v, sf), guards: new Set([...base, `${arm}:${cond}`]) });
    }
    return arms;
  }
  return isNothing(expr) ? [] : [{ key: exprKey(expr, sf), guards: base }];
}

/** Whether HTML can label this element. A component is trusted to forward its `id`. */
function isLabelable(node: Opening, sf: ts.SourceFile): boolean {
  const tag = tagName(node, sf);
  if (!/^[a-z][\w-]*$/.test(tag)) return true;
  if (!LABELABLE_TAGS.has(tag)) return false;
  if (tag !== 'input') return true;
  const typeAttr = findAttr(node, 'type', sf);
  return !(typeAttr?.initializer && literalStrings(typeAttr.initializer).includes('hidden'));
}

/** Every `<label htmlFor>` and every `id`-carrying element, grouped by top-level declaration. */
function collectPairings(sf: ts.SourceFile): {
  labels: { node: Opening; htmlFor: ts.JsxAttribute; arms: LabelArm[] }[];
  labelArmsByScope: Map<ts.Node, LabelArm[]>;
  holdersByScope: Map<ts.Node, IdHolder[]>;
} {
  const labels: { node: Opening; htmlFor: ts.JsxAttribute; arms: LabelArm[] }[] = [];
  const labelArmsByScope = new Map<ts.Node, LabelArm[]>();
  const holdersByScope = new Map<ts.Node, IdHolder[]>();
  const push = <T>(map: Map<ts.Node, T[]>, scope: ts.Node, item: T): void => {
    const list = map.get(scope);
    if (list) list.push(item);
    else map.set(scope, [item]);
  };
  const visit = (n: ts.Node): void => {
    if (isOpening(n)) {
      const scope = topLevelStatement(n);
      if (tagName(n, sf) === 'label') {
        const htmlFor = findAttr(n, 'htmlFor', sf);
        if (htmlFor) {
          const arms = labelArms(n, htmlFor, sf);
          labels.push({ node: n, htmlFor, arms });
          for (const arm of arms) push(labelArmsByScope, scope, arm);
        }
      }
      const idAttr = findAttr(n, 'id', sf);
      const key = idAttr ? valueKey(idAttr, sf) : null;
      if (key) {
        push(holdersByScope, scope, {
          key,
          guards: renderGuards(elementOf(n), sf),
          labelable: isLabelable(n, sf),
        });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { labels, labelArmsByScope, holdersByScope };
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
  let cur: ts.Node | undefined = elementOf(control).parent;
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

function lineOf(node: ts.Node, sf: ts.SourceFile): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

/**
 * Scan one TSX source for colour/range/select controls and how each is named.
 * @param file Path used in findings (repo-relative for readable failures).
 * @param text The TSX source.
 * @returns One finding per control, in source order.
 */
export function scanControls(file: string, text: string): ControlFinding[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const { labelArmsByScope } = collectPairings(sf);

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
          const controlGuards = renderGuards(elementOf(n), sf);
          // The label must be there, pointing at this id, whenever the
          // control is: its guards are a subset of the control's.
          const paired = (labelArmsByScope.get(topLevelStatement(n)) ?? []).some(
            (arm) => arm.key === key && isSubset(arm.guards, controlGuards),
          );
          if (idAttr && key && paired) {
            namedBy = 'label[for]';
            literalId = isLiteralValue(idAttr);
          }
        }
        if (!namedBy) {
          const label = wrappingLabel(n, sf);
          if (label && labelHasText(label, elementOf(n))) namedBy = 'wrapping label';
        }
        findings.push({ file, line: lineOf(n, sf), kind, namedBy, literalId });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return findings;
}

/**
 * Scan one TSX source for `<label htmlFor>` elements and whether each one's
 * target renders whenever the label points at it.
 * @param file Path used in findings (repo-relative for readable failures).
 * @param text The TSX source.
 * @returns One finding per `<label htmlFor>`, in source order.
 */
export function scanLabels(file: string, text: string): LabelFinding[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const { labels, holdersByScope } = collectPairings(sf);

  return labels.map(({ node, htmlFor, arms }) => {
    const holders = holdersByScope.get(topLevelStatement(node)) ?? [];
    let problem: LabelProblem | null = null;
    for (const arm of arms) {
      const matching = holders.filter((h) => h.key === arm.key);
      const labelable = matching.filter((h) => h.labelable);
      if (matching.length === 0) problem = 'no-target';
      else if (labelable.length === 0) problem = 'not-labelable';
      // Some labelable holder must render whenever the label points at it:
      // its guards are a subset of the arm's.
      else if (!labelable.some((h) => isSubset(h.guards, arm.guards))) problem = 'conditional-target';
      if (problem) break;
    }
    const value = htmlFor.initializer;
    const htmlForText = value && ts.isJsxExpression(value) && value.expression ? value.expression.getText(sf) : (value?.getText(sf) ?? '');
    return { file, line: lineOf(node, sf), htmlFor: htmlForText, problem };
  });
}
