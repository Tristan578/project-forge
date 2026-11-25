/**
 * spawnforge/no-wait-for-function-options-as-arg — Playwright's
 * `waitForFunction(pageFunction, arg?, options?)` takes OPTIONS THIRD.
 *
 *     await page.waitForFunction(() => ready(), { timeout: 90_000 });
 *
 * reads like a 90s wait and is not one. The object is `arg` — handed to the page
 * function, which ignores it — and the wait falls back to `use.actionTimeout`
 * (`E2E_ACTION_TIMEOUT_MS`, 10s in `playwright.config.ts`). Nothing fails until
 * a slow page needs the time the line appears to grant, and then the error says
 * `Timeout 10000ms exceeded` at a line that asked for something else. That is
 * how `EditorPage.loadPage()`'s 90s-then-40s cold-start fallback turned out to be
 * 10s-then-10s.
 *
 * Reported shape: exactly two arguments, the second an object literal (through
 * `as` / `satisfies`) with a `timeout`, `polling` or `signal` key — the keys of
 * `PageWaitForFunctionOptions` (`Locator.waitForFunction` takes `timeout` and
 * `signal`) — AND a page function that cannot read its
 * argument: an inline function with no parameters (a `function` expression
 * must not reference `arguments` either), or a string, which Playwright
 * evaluates as an expression and never hands an argument.
 *
 * That second condition is what makes the report certain and the fix safe.
 * `waitForFunction(({ timeout }) => elapsed() > timeout, { timeout: 100 })` is
 * VALID Playwright: the predicate reads the object it was given, and moving it
 * to the options slot would hand the predicate `undefined`. Whether a page
 * function that takes a parameter meant its object as data or as options is a
 * question of intent this rule cannot answer, so such calls are not reported.
 *
 * NOT reported either: a page function passed by reference
 * (`waitForFunction(isReady, { timeout })`) — its parameters are not visible
 * here — and a second argument that is an identifier holding options
 * (`waitForFunction(fn, opts)`), which is a type question. Write the page
 * function and the options inline.
 *
 * The fix inserts `undefined, ` so the object lands in the options slot. It is
 * only offered where the page function provably ignores its argument, so it
 * cannot change what the page function sees.
 * Tests: `e2e/lib/__tests__/noWaitForFunctionOptionsAsArg.test.ts`.
 */

const OPTION_KEYS = new Set(['timeout', 'polling', 'signal']);

const MESSAGE =
  'waitForFunction(fn, { timeout }) passes the options as the page function\'s ARGUMENT — the timeout is ignored and the wait uses actionTimeout (10s). Options go third: waitForFunction(fn, undefined, { timeout }).';

function unwrap(node) {
  let current = node;
  while (current && (current.type === 'TSAsExpression' || current.type === 'TSSatisfiesExpression')) {
    current = current.expression;
  }
  return current;
}

function keyName(property) {
  if (property.type !== 'Property' || property.computed) return null;
  if (property.key.type === 'Identifier') return property.key.name;
  if (property.key.type === 'Literal' && typeof property.key.value === 'string') return property.key.value;
  return null;
}

function isWaitForFunctionCallee(callee) {
  if (callee.type === 'Identifier') return callee.name === 'waitForFunction';
  return (
    callee.type === 'MemberExpression'
    && !callee.computed
    && callee.property.type === 'Identifier'
    && callee.property.name === 'waitForFunction'
  );
}

/**
 * True only when the page function provably cannot read the `arg` Playwright
 * passes it. Anything this cannot decide returns false, so the rule stays
 * silent rather than report — or autofix — a call that may be correct.
 */
function pageFunctionIgnoresArg(node, sourceCode) {
  const fn = unwrap(node);
  if (!fn) return false;
  // A string page function is evaluated as an expression; it receives no arg.
  if (fn.type === 'Literal' && typeof fn.value === 'string') return true;
  if (fn.type === 'TemplateLiteral') return true;
  // An arrow has no `arguments` of its own, so no parameters means no arg.
  if (fn.type === 'ArrowFunctionExpression') return fn.params.length === 0;
  if (fn.type === 'FunctionExpression') {
    if (fn.params.length !== 0) return false;
    const argumentsVar = sourceCode.getScope(fn).set.get('arguments');
    return !argumentsVar || argumentsVar.references.length === 0;
  }
  return false;
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow passing Playwright waitForFunction options in the `arg` position',
    },
    fixable: 'code',
    schema: [],
    messages: { optionsAsArg: MESSAGE },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (node.arguments.length !== 2) return;
        if (!isWaitForFunctionCallee(node.callee)) return;
        const second = node.arguments[1];
        const object = unwrap(second);
        if (object?.type !== 'ObjectExpression') return;
        const hasOptionKey = object.properties.some((p) => OPTION_KEYS.has(keyName(p)));
        if (!hasOptionKey) return;
        if (!pageFunctionIgnoresArg(node.arguments[0], context.sourceCode)) return;
        context.report({
          node: second,
          messageId: 'optionsAsArg',
          fix: (fixer) => fixer.insertTextBefore(second, 'undefined, '),
        });
      },
    };
  },
};

export default rule;
