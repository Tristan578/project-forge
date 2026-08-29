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

const localPlugin = {
  rules: {
    'no-hardcoded-primitives': noHardcodedPrimitives,
    'no-empty-test-assertion': noEmptyTestAssertion,
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
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
