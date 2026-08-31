import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Local plugin: detect hardcoded Tailwind color classes that should use design tokens.
// Pattern: bg-zinc-800, text-gray-300, border-slate-500, etc.
// These should be replaced with CSS custom property references (e.g., bg-[var(--sf-bg-surface)]).
const HARDCODED_COLOR_RE =
  /\b(?:bg|text|border|ring|outline|shadow|divide|from|via|to|placeholder|decoration|accent|caret|fill|stroke)-(?:zinc|gray|slate|stone|neutral|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|100|200|300|400|500|600|700|800|900|950)\b/g;

const noHardcodedPrimitives = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Disallow hardcoded Tailwind color scale classes; use design token CSS vars instead' },
    schema: [],
  },
  create(context) {
    function check(node, value) {
      // Reset lastIndex since the regex has the global flag.
      HARDCODED_COLOR_RE.lastIndex = 0;
      let match;
      while ((match = HARDCODED_COLOR_RE.exec(value)) !== null) {
        context.report({
          node,
          message: `Hardcoded Tailwind color '${match[0]}' — use a CSS custom property (e.g., bg-[var(--sf-bg-surface)]) or semantic token class instead.`,
        });
      }
    }
    return {
      // className="bg-zinc-800 ..."
      JSXAttribute(node) {
        if (
          node.name.name === 'className' &&
          node.value?.type === 'Literal' &&
          typeof node.value.value === 'string'
        ) {
          check(node.value, node.value.value);
        }
      },
      // Template literals only in className-related contexts:
      // className={`...`}, cn(`...`), clsx(`...`), cva(`...`), twMerge(`...`)
      TemplateLiteral(node) {
        const parent = node.parent;
        const isClassNameExpr =
          // className={`...`}
          (parent?.type === 'JSXExpressionContainer' &&
            parent.parent?.type === 'JSXAttribute' &&
            parent.parent.name?.name === 'className') ||
          // cn(`...`), clsx(`...`), cva(`...`), twMerge(`...`)
          (parent?.type === 'CallExpression' &&
            parent.callee?.type === 'Identifier' &&
            /^(cn|clsx|cva|twMerge)$/.test(parent.callee.name));
        if (!isClassNameExpr) return;
        for (const quasi of node.quasis) {
          check(quasi, quasi.value.raw);
        }
      },
    };
  },
};

// Local plugin: flag it()/test() bodies with no expect() assertion anywhere
// in their subtree — a test that renders/acts and asserts nothing reports
// green on behaviour it never exercises (PF-9448 / #9448).
const TEST_CALL_NAMES = new Set(['it', 'test']);

function calleeIsTestCall(callee) {
  if (!callee) return false;
  if (callee.type === 'Identifier') return TEST_CALL_NAMES.has(callee.name);
  if (callee.type === 'MemberExpression') {
    // it.only(...), it.skip(...), it.concurrent(...), it.each(...), and
    // combinations like it.concurrent.only(...).
    if (callee.object.type === 'Identifier' && TEST_CALL_NAMES.has(callee.object.name)) return true;
    return calleeIsTestCall(callee.object);
  }
  if (callee.type === 'CallExpression') {
    // it.each([...])('name', fn) — the outer call's callee is the
    // it.each([...]) CallExpression itself.
    return calleeIsTestCall(callee.callee);
  }
  return false;
}

function calleeHasModifier(callee, modifier) {
  if (!callee) return false;
  if (callee.type === 'MemberExpression') {
    if (callee.property.type === 'Identifier' && callee.property.name === modifier) return true;
    return calleeHasModifier(callee.object, modifier);
  }
  if (callee.type === 'CallExpression') return calleeHasModifier(callee.callee, modifier);
  return false;
}

function containsExpectCall(node, seen) {
  if (!node || typeof node !== 'object' || seen.has(node)) return false;
  seen.add(node);
  if (node.type === 'Identifier' && node.name === 'expect') return true;
  for (const key in node) {
    if (key === 'parent' || key === 'loc' || key === 'range') continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === 'object' && typeof item.type === 'string' && containsExpectCall(item, seen)) {
          return true;
        }
      }
    } else if (value && typeof value === 'object' && typeof value.type === 'string') {
      if (containsExpectCall(value, seen)) return true;
    }
  }
  return false;
}

const noEmptyTestAssertion = {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow it()/test() bodies with no expect() assertion (PF-9448)' },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        if (!calleeIsTestCall(node.callee)) return;
        // .todo(...) tests take no callback — nothing to check.
        if (calleeHasModifier(node.callee, 'todo')) return;
        const fn = node.arguments.find(
          (a) => a.type === 'FunctionExpression' || a.type === 'ArrowFunctionExpression',
        );
        if (!fn) return; // dynamic/referenced callback — can't statically analyze
        if (!containsExpectCall(fn.body, new Set())) {
          context.report({
            node,
            message:
              'Test has no expect() assertion — it will report green without exercising the behaviour it claims to test. Add an assertion or delete the test (PF-9448).',
          });
        }
      },
    };
  },
};

/**
 * Files allowed to index the dialogue tree map directly (PF-1151 / #9241).
 *
 * SINGLE SOURCE OF TRUTH for this boundary's exemptions. The same rule is
 * enforced twice — here, against the AST as you type, and by the source scan in
 * `src/stores/__tests__/dialogueTreeAccess.test.ts`, against text in CI. Two
 * mechanisms with two independently-maintained exemption lists is precisely how
 * they come to disagree about what is allowed, so this array is PINNED by that
 * suite: edit it here and the suite fails until the scan's scope is reconciled
 * with it.
 *
 * Each entry, and why:
 *  - `dialogueStore.ts` implements `getTree`, which cannot be written in terms
 *    of itself. Exempt so writing the accessor never trips the rule the
 *    accessor exists to enforce. (The scan exempts the same file, by path.)
 *  - Test directories and `*.{test,spec}.*` build and index tree maps as
 *    fixtures — the scanner's own corpus deliberately contains the unsafe
 *    shape. The scan skips these by walking around them.
 *
 * One asymmetry is deliberate and stated rather than reconciled: the scan also
 * skips `*.d.ts`, which is NOT exempt here. A declaration file holds no
 * executable expression, so this rule can never fire in one — the asymmetry is
 * provably inert, and narrowing the rule to match would only add a glob nobody
 * can trip.
 */
const DIALOGUE_TREE_INDEX_EXEMPT = [
  'src/stores/dialogueStore.ts',
  'src/**/__tests__/**',
  'src/**/test/**',
  'src/**/*.{test,spec}.{ts,tsx}',
];

/**
 * `dialogueTrees` is keyed by ids drawn from persisted JSON, generated content
 * and the chat handlers, so `"__proto__"`, `"constructor"` and `"toString"` are
 * all reachable keys. A bare `dialogueTrees[id]` answers with something off
 * `Object.prototype` for each of them: truthy, so every `if (!tree) return`
 * guard passes, and then `tree.nodes.find(...)` throws. That took down the
 * play-mode overlay and the editor panel (PF-1144), and both call sites looked
 * completely ordinary — which is why review is not a reliable gate for this
 * shape and a mechanical one is.
 *
 * AST rather than the scan's regex, on purpose. It sees `state.dialogueTrees[id]`
 * and `get().dialogueTrees[id]` as one shape, and — unlike a text match — does
 * NOT fire on `{ ...state.dialogueTrees, [treeId]: updated }`, where the
 * computed key belongs to an object literal and is perfectly safe. The two
 * mechanisms stay complementary rather than redundant: the scan catches the
 * literal form in every file it walks, including ones ESLint may not lint; this
 * catches it in the editor, and sees through a member chain the regex cannot.
 * Neither sees a fully dynamic alias (`const m = trees; m[id]`); the store's own
 * `Object.hasOwn` guard remains the authority.
 */
const noBareDialogueTreeIndex = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow computed reads of the dialogueTrees map; use getTree(trees, id) (PF-1151)',
    },
    schema: [],
  },
  create(context) {
    const MESSAGE =
      'Do not index `dialogueTrees` directly — for the ids "__proto__", "constructor" and '
      + '"toString" this resolves an INHERITED property, which is truthy, so `if (!tree)` passes '
      + 'and the next read throws (PF-1144). Use `getTree(trees, id)`, which gates on Object.hasOwn.';
    return {
      MemberExpression(node) {
        if (!node.computed) return;
        const obj = node.object;
        // `dialogueTrees[id]`
        const bare = obj.type === 'Identifier' && obj.name === 'dialogueTrees';
        // `state.dialogueTrees[id]`, `get().dialogueTrees[id]`, `a.b.dialogueTrees[id]`
        const throughMember =
          obj.type === 'MemberExpression'
          && !obj.computed
          && obj.property.type === 'Identifier'
          && obj.property.name === 'dialogueTrees';
        if (bare || throughMember) {
          context.report({ node, message: MESSAGE });
        }
      },
    };
  },
};

const localPlugin = {
  rules: {
    'no-hardcoded-primitives': noHardcodedPrimitives,
    'no-empty-test-assertion': noEmptyTestAssertion,
    'no-bare-dialogue-tree-index': noBareDialogueTreeIndex,
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // TYPE-AWARE LINTING (#8938). eslint-config-next/typescript wires the TS
    // parser but not a program, so type-aware rules were silently inert. Turning
    // projectService on is what makes the rule below able to see that an
    // expression is a Promise at all.
    //
    // no-floating-promises exists because the single highest-frequency historical
    // bug in this repo was a missing `await` on `rateLimitPublicRoute()`, which
    // did not fail, did not log, and simply skipped the rate limit. Nothing
    // mechanical stopped it recurring; documentation alone had not.
    //
    // WHAT `void` MEANS HERE. `void f()` is the deliberate marker for "this
    // promise is not awaited on purpose". It is only honest when f() CANNOT
    // reject -- in this codebase that means a store action or fetcher whose
    // entire body sits inside try/catch and reports failure into state, or a
    // promise that resolves unconditionally. Every `void` added with this rule
    // was checked against that bar. If a call CAN reject, attach real handling
    // (see the clipboard, pointer-lock, audio-resume and dynamic-import call
    // sites) -- `void` there would only convert a visible unhandled rejection
    // into an invisible one, which is the bug this rule is meant to catch.
    //
    // prefer-nullish-coalescing (the `||` vs `??` half of #8938) is a separate
    // 245-finding sweep and lands on its own.
    files: ['src/**/*.{ts,tsx}', 'scripts/**/*.ts'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
      }],
    },
  },
  {
    // Design token enforcement (DS-F: Frontend Consolidation #8130).
    // Currently 'off' — ~3988 violations across the codebase. Enable per-directory
    // as files are migrated to CSS custom property tokens. Target: 'warn' then 'error'.
    // Excludes test files since they may legitimately reference Tailwind classes.
    files: ['src/**/*.tsx'],
    ignores: ['src/**/*.{test,spec}.tsx'],
    plugins: { 'spawnforge': localPlugin },
    rules: {
      'spawnforge/no-hardcoded-primitives': 'off',
    },
  },
  {
    files: ['src/app/api/**/route.ts'],
    rules: {
      'no-restricted-imports': ['warn', {
        paths: [{
          name: '@/lib/auth/api-auth',
          importNames: ['authenticateRequest'],
          message: 'Use withApiMiddleware from @/lib/api/middleware instead of authenticateRequest directly.',
        }],
      }],
    },
  },
  {
    // Dialogue tree map access (PF-1151 / #9241). A DEDICATED rule name rather
    // than another `no-restricted-syntax` entry: flat config resolves rules by
    // name, so a third `no-restricted-syntax` block overlapping `src/**` would
    // replace — not merge with — the getDb block's entry below and silently
    // disable it. `ignores` carries the exemptions; the rule itself needs no
    // path logic.
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    ignores: DIALOGUE_TREE_INDEX_EXEMPT,
    plugins: { spawnforge: localPlugin },
    rules: {
      'spawnforge/no-bare-dialogue-tree-index': 'error',
    },
  },
  {
    // DB resilience: flag `const db = getDb()` pattern outside client.ts (#8240).
    // All DB operations should go through queryWithResilience() for circuit
    // breaker protection. The pattern `const db = getDb()` followed by `db.select/insert/update/delete`
    // bypasses retry/circuit breaker. Correct usage: queryWithResilience(() => getDb().select()...)
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    ignores: [
      'src/lib/db/client.ts',
      'src/lib/db/__tests__/**',
      'src/lib/monitoring/**',
      'src/**/*.{test,spec}.{ts,tsx}',
    ],
    rules: {
      'no-restricted-syntax': ['warn',
        {
          selector: "VariableDeclarator[init.callee.name='getDb']",
          message: 'Do not assign getDb() to a variable — this bypasses automatic retries and circuit-breaker recovery for DB outages. Wrap with queryWithResilience(() => getDb().select()...) instead. If multiple queries share a db ref inside a queryWithResilience callback, add eslint-disable-next-line.',
        },
      ],
    },
  },
  {
    files: ['src/**/*.{test,spec}.{ts,tsx,js,jsx}'],
    plugins: { spawnforge: localPlugin },
    rules: {
      'spawnforge/no-empty-test-assertion': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.object.name=/^(?:it|test|describe)$/][callee.property.name=/^(?:skip|only)$/]",
          message: 'Do not use .skip/.only in tests.',
        },
        {
          selector: "CallExpression[callee.name=/^(?:xit|xtest|xdescribe)$/]",
          message: 'Do not disable tests with x-prefixed helpers.',
        },
        {
          selector: "CallExpression[callee.object.name='xit'][callee.property.name='each']",
          message: 'Do not disable tests with x-prefixed helpers.',
        },
        {
          selector: "CallExpression[callee.property.name=/^(toMatchSnapshot|toMatchInlineSnapshot|toThrowErrorMatchingSnapshot)$/]",
          message: 'Snapshot assertions are not allowed; assert explicit behavior.',
        },
        {
          selector: "CallExpression[callee.name='setTimeout']",
          message: 'Avoid setTimeout sleeps in tests; use vi.waitFor() or fake timers.',
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated WASM bindings
    "public/engine-pkg/**",
    "public/engine-pkg-webgl2/**",
    "public/engine-pkg-webgpu/**",
    "public/engine-pkg-webgl2-runtime/**",
    "public/engine-pkg-webgpu-runtime/**",
    // Test coverage output
    "coverage/**",
    // k6 load test scripts (k6 runtime, not Node.js)
    "load-tests/**",
  ]),
]);

export default eslintConfig;
