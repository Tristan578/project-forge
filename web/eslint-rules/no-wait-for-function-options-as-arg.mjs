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
 * `as` / `satisfies`) with a `timeout` or `polling` key. Those are the only
 * `WaitForFunctionOptions` keys, and a page function that genuinely wants an
 * argument with one of those names can pass it third-position-safe as
 * `waitForFunction(fn, { timeout }, {})` — rare enough not to special-case.
 *
 * NOT reported: a second argument that is an identifier holding options
 * (`waitForFunction(fn, opts)`). Whether `opts` is an arg or options is a type
 * question this syntactic rule cannot answer; write the options inline.
 *
 * The fix inserts `undefined, ` so the object lands in the options slot.
 * Tests: `e2e/lib/__tests__/noWaitForFunctionOptionsAsArg.test.ts`.
 */

const OPTION_KEYS = new Set(['timeout', 'polling']);

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
