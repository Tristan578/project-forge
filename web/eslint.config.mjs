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

const localPlugin = {
  rules: {
    'no-hardcoded-primitives': noHardcodedPrimitives,
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
    files: ['src/**/*.{test,spec}.{ts,tsx,js,jsx}'],
    rules: {
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
  ]),
]);

export default eslintConfig;
