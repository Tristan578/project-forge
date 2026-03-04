import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

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
    // Test coverage output
    "coverage/**",
  ]),
]);

export default eslintConfig;
